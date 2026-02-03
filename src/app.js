// Backend API ottimizzato per app mobile/web:
// - Upstream: ViaggiaTreno (RFI) + LeFrecce
// - Output: JSON normalizzati e pronti per UI
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

// ============================================================================
// Config
// ============================================================================
const VT_BASE_URL = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const VT_BOARD_BASE_URL = 'http://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno';
const LEFRECCE_BASE_URL = 'https://www.lefrecce.it/Channels.Website.BFF.WEB';
const ITALO_STATION_BASE_URL = 'https://italoinviaggio.italotreno.com/api/RicercaStazioneService';
const ITALO_TRAIN_BASE_URL = 'https://italoinviaggio.italotreno.com/api/RicercaTrenoService';

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 5 * 60 * 1000);
const CACHE_MAX_ENTRIES = Number(process.env.CACHE_MAX_ENTRIES || 2000);
const TRAIN_STATUS_TTL_MS = Number(process.env.TRAIN_STATUS_TTL_MS || 30 * 1000);
const TRAIN_SEARCH_TTL_MS = Number(process.env.TRAIN_SEARCH_TTL_MS || 10 * 60 * 1000);
const TRAIN_SNAPSHOT_TTL_MS = Number(process.env.TRAIN_SNAPSHOT_TTL_MS || 30 * 1000);
const ITALO_STATUS_TTL_MS = Number(process.env.ITALO_STATUS_TTL_MS || 30 * 1000);
const ITALO_LAST_KNOWN_TTL_MS = Number(process.env.ITALO_LAST_KNOWN_TTL_MS || 12 * 60 * 60 * 1000);
const NEWS_TTL_MS = Number(process.env.NEWS_TTL_MS || 60 * 1000);
const STATION_BOARD_TTL_MS = Number(process.env.STATION_BOARD_TTL_MS || 30 * 1000);
const STATION_DEPARTURES_TTL_MS = Number(process.env.STATION_DEPARTURES_TTL_MS || 30 * 1000);
const STATION_ARRIVALS_TTL_MS = Number(process.env.STATION_ARRIVALS_TTL_MS || 30 * 1000);
const ITALO_BOARD_TTL_MS = Number(process.env.ITALO_BOARD_TTL_MS || 30 * 1000);
const RATE_LIMIT_ENABLED = process.env.RATE_LIMIT_ENABLED !== '0';
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 120);
const RATE_LIMIT_HEAVY_MAX = Number(process.env.RATE_LIMIT_HEAVY_MAX || 30);
const RATE_LIMIT_MAX_ENTRIES = Number(process.env.RATE_LIMIT_MAX_ENTRIES || 10000);
const SECURITY_HEADERS_ENABLED = process.env.SECURITY_HEADERS_ENABLED !== '0';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'Europe/Rome';
const ENABLE_RAW_UPSTREAM = process.env.ENABLE_RAW_UPSTREAM === '1';
const ENABLE_DEBUG_RAW = process.env.ENABLE_DEBUG_RAW === '1';
const EXPOSE_ERRORS = process.env.EXPOSE_ERRORS === '1';
const ITALO_SOFT_TIMEOUT_MS = Number(process.env.ITALO_SOFT_TIMEOUT_MS || 200);

if (TRUST_PROXY) app.set('trust proxy', 1);

// ============================================================================
// CORS (come versione precedente)
// ============================================================================
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);
      if (CORS_ORIGINS.length === 0) return callback(null, true);
      if (CORS_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin non permessa'), false);
    },
  })
);

app.use((req, res, next) => {
  if (!SECURITY_HEADERS_ENABLED) return next();
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'no-referrer');
  res.set('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  res.set('Cross-Origin-Resource-Policy', 'cross-origin');
  next();
});

app.use(express.json({ limit: '100kb' }));
app.disable('x-powered-by');

// ============================================================================
// Netlify path normalization
// ============================================================================
app.use((req, _res, next) => {
  const NETLIFY_PREFIX = '/.netlify/functions/api';
  if (req.path && req.path.startsWith(NETLIFY_PREFIX)) {
    req.url = req.url.replace(NETLIFY_PREFIX, '');
  }
  if (!req.url.startsWith('/api/')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }
  next();
});

// ============================================================================
// Cache
// ============================================================================
const cache = new Map();
const inflight = new Map();

function cacheGet(key) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function cacheSet(key, value, ttlMs = CACHE_TTL_MS) {
  // Evita crescita illimitata della cache (funzioni serverless possono restare "warm").
  if (cache.has(key)) cache.delete(key); // refresh LRU order
  while (cache.size >= CACHE_MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey == null) break;
    cache.delete(oldestKey);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

async function withSingleFlight(key, work) {
  if (inflight.has(key)) return inflight.get(key);
  const promise = (async () => {
    try {
      return await work();
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, promise);
  return promise;
}

async function cacheGetOrSet(key, ttlMs, work) {
  const cached = cacheGet(key);
  if (cached != null) return cached;
  return withSingleFlight(key, async () => {
    const cachedAgain = cacheGet(key);
    if (cachedAgain != null) return cachedAgain;
    const value = await work();
    if (value != null) return cacheSet(key, value, ttlMs);
    return value;
  });
}

// ============================================================================
// Rate limiting (in-memory, per IP)
// ============================================================================
const rateLimitStore = new Map();

function getClientIp(req) {
  if (TRUST_PROXY) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) return String(forwarded).split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
}

function rateLimit({ max, windowMs, keyPrefix }) {
  return (req, res, next) => {
    if (!RATE_LIMIT_ENABLED) return next();
    const ip = getClientIp(req);
    const key = `${keyPrefix}:${ip}`;
    const now = Date.now();
    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      rateLimitStore.set(key, entry);
    }

    entry.count += 1;

    if (rateLimitStore.size > RATE_LIMIT_MAX_ENTRIES) {
      const oldestKey = rateLimitStore.keys().next().value;
      if (oldestKey != null) rateLimitStore.delete(oldestKey);
    }

    const remaining = Math.max(0, max - entry.count);
    res.set('X-RateLimit-Limit', String(max));
    res.set('X-RateLimit-Remaining', String(remaining));
    res.set('X-RateLimit-Reset', String(Math.ceil(entry.resetAt / 1000)));

    if (entry.count > max) {
      return res.status(429).json({ ok: false, error: 'Troppi tentativi, riprova più tardi.' });
    }

    return next();
  };
}

const rateLimitStandard = rateLimit({ max: RATE_LIMIT_MAX, windowMs: RATE_LIMIT_WINDOW_MS, keyPrefix: 'rl:std' });
const rateLimitHeavy = rateLimit({ max: RATE_LIMIT_HEAVY_MAX, windowMs: RATE_LIMIT_WINDOW_MS, keyPrefix: 'rl:heavy' });

// ============================================================================
// Station DB (canonica) - si ragiona sempre per codici stazione (RFI)
// ============================================================================
const stationList = [];
const stationsById = new Map(); // id -> { id, name, ... }
const stationIdByKey = new Map(); // normalizedName -> id
const stationTokensIndex = []; // { id, tokens:Set<string> }
const lefrecceIdByStationId = new Map(); // stationId -> lefrecceId (number)
const stationIdByLefrecceId = new Map(); // lefrecceId -> stationId
const italoCodeByStationId = new Map(); // stationId -> italoCode
const stationIdByItaloCode = new Map(); // italoCode -> stationId

function normalizeStationNameKey(value) {
  const raw = value == null ? '' : String(value);
  if (!raw) return '';
  return raw
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[.']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function addStationNameVariant(id, name) {
  const key = normalizeStationNameKey(name);
  if (!key) return;
  if (!stationIdByKey.has(key)) stationIdByKey.set(key, id);
}

function expandCommonStationAbbreviations(name) {
  const raw = name != null ? String(name).trim() : '';
  if (!raw) return '';
  const letter = 'A-Za-zÀ-ÿ';
  return raw
    .replace(/\bC\.?\s*T\.?\b/gi, 'Chianciano Terme')
    .replace(/\bP\.?\s*TA\.?\b/gi, 'Porta')
    .replace(/\bP\.?\s*LE\.?\b/gi, 'Piazzale')
    .replace(/\bP\.?\s*ZZA\.?\b/gi, 'Piazza')
    .replace(/\bC\.?\s*LE\.?\b/gi, 'Centrale')
    // Gestisci anche casi attaccati tipo "S.M.Novella"
    .replace(new RegExp(`\\bS\\.?\\s*M\\.?(?=[${letter}])`, 'gi'), 'Santa Maria ')
    .replace(/\bS\.?\s*M\.?\b/gi, 'Santa Maria')
    .replace(/\bS\.?\s*TA\.?\b/gi, 'Santa')
    .replace(/\bS\.?\s*TO\.?\b/gi, 'Santo')
    .replace(/\s+/g, ' ')
    .trim();
}

function addStationNameVariants(id, name) {
  const base = name != null ? String(name).trim() : '';
  if (!base) return;
  addStationNameVariant(id, base);

  const variants = new Set([base]);
  // Espandi abbreviazioni "S." sia verso "San" che "Santa" per migliorare il match con VT.
  if (/\bS\.\s+[A-Za-zÀ-ÿ]/.test(base)) {
    variants.add(base.replace(/\bS\.\s+/g, 'San '));
    variants.add(base.replace(/\bS\.\s+/g, 'Santa '));
  }

  for (const v of Array.from(variants)) {
    const expanded = expandCommonStationAbbreviations(v);
    if (expanded && expanded !== v) variants.add(expanded);
  }

  for (const v of variants) {
    if (v && v !== base) addStationNameVariant(id, v);
  }
}

try {
  // Preferisci `require` per garantire l'inclusione nel bundle Netlify Functions.
  // (La lettura via fs può fallire in produzione se il file non viene incluso automaticamente.)
  let list = null;
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    list = require('../stazioni.json');
  } catch {
    list = null;
  }
  if (!Array.isArray(list)) {
    const candidates = [
      path.join(__dirname, '..', 'stazioni.json'),
      path.resolve(process.cwd(), 'stazioni.json'),
    ];
    let loaded = null;
    for (const p of candidates) {
      try {
        const raw = fs.readFileSync(p, 'utf8');
        loaded = JSON.parse(raw);
        break;
      } catch {
        // try next
      }
    }
    list = loaded;
  }
  if (Array.isArray(list)) {
    list
      .filter((s) => s && (s.viaggiatrenoId || s.id))
      .forEach((s) => {
        const rawId = s.viaggiatrenoId ?? s.id;
        const id = rawId != null ? String(rawId).trim().toUpperCase() : '';
        if (!id) return;
        const rawName = s.nome ?? s.name;
        const name = rawName != null ? String(rawName).trim() : null;
        const lefrecceId = s.lefrecceId != null ? Number(s.lefrecceId) : null;
        const rawItalo = s.italoId ?? s.italoCode;
        const italoCode =
          rawItalo != null && String(rawItalo).trim() ? String(rawItalo).trim().toUpperCase() : null;
        const rec = {
          ...s,
          id,
          name,
          lefrecceId: Number.isFinite(lefrecceId) ? lefrecceId : null,
          italoCode,
          viaggiatrenoId: id,
          nome: name,
          italoId: italoCode,
        };
        stationList.push(rec);
        if (!stationsById.has(id)) stationsById.set(id, rec);
        if (name) {
          addStationNameVariants(id, name);
        }
        if (Number.isFinite(rec.lefrecceId)) {
          if (!lefrecceIdByStationId.has(id)) lefrecceIdByStationId.set(id, rec.lefrecceId);
          if (!stationIdByLefrecceId.has(rec.lefrecceId)) stationIdByLefrecceId.set(rec.lefrecceId, id);
        }
        if (rec.italoCode && !italoCodeByStationId.has(id)) {
          italoCodeByStationId.set(id, rec.italoCode);
          if (!stationIdByItaloCode.has(rec.italoCode)) stationIdByItaloCode.set(rec.italoCode, id);
        }
      });

    stationList.forEach((s) => {
      const key = normalizeStationNameKey(s.name);
      const tokens = new Set(key ? key.split(' ').filter(Boolean) : []);
      stationTokensIndex.push({ id: s.id, tokens });
    });
  }
} catch (err) {
  console.warn('⚠️ Impossibile caricare stazioni.json:', err.message);
}

function stationRefFromId(idRaw) {
  // ⚠️ Deprecated: non usare in output API (non deve esporre id/lefrecceId)
  const id = idRaw ? String(idRaw).trim().toUpperCase() : '';
  const rec = id ? stationsById.get(id) : null;
  return rec && rec.name ? String(rec.name) : null;
}

function resolveStationIdByName(nameRaw) {
  const name = nameRaw == null ? '' : String(nameRaw).trim();
  if (!name) return null;
  // Se è già un codice stazione
  if (/^[A-Z]\d{5}$/.test(name.toUpperCase())) return name.toUpperCase();

  const key = normalizeStationNameKey(name);
  if (!key) return null;
  const direct = stationIdByKey.get(key);
  if (direct) return direct;

  // Fallback: token match (utile per abbreviazioni tipo "S. M. Novella")
  const qTokens = key.split(' ').filter(Boolean);
  if (!qTokens.length) return null;

  let best = { id: null, score: 0, tokenHits: 0 };
  for (const entry of stationTokensIndex) {
    let hits = 0;
    for (const t of qTokens) {
      if (entry.tokens.has(t)) hits += 1;
    }
    if (hits === 0) continue;
    const score = hits / qTokens.length;
    if (score > best.score || (score === best.score && hits > best.tokenHits)) {
      best = { id: entry.id, score, tokenHits: hits };
    }
  }

  // Soglia: almeno 2 token match o match completo se query corta
  if (best.id && (best.tokenHits >= 2 || best.score === 1)) return best.id;
  return null;
}

function stationRefFromName(nameRaw) {
  const id = resolveStationIdByName(nameRaw);
  return stationRefFromId(id);
}

function stationNameById(idRaw) {
  const id = idRaw ? String(idRaw).trim().toUpperCase() : '';
  const rec = id ? stationsById.get(id) : null;
  return rec && rec.name ? String(rec.name) : null;
}

function italoCodeByStationIdOrNull(idRaw) {
  const id = idRaw ? String(idRaw).trim().toUpperCase() : '';
  return id ? italoCodeByStationId.get(id) || null : null;
}

function stationNameByItaloCode(italoCodeRaw) {
  const code = italoCodeRaw != null ? String(italoCodeRaw).trim().toUpperCase() : '';
  if (!code) return null;
  const id = stationIdByItaloCode.get(code);
  return id ? stationNameById(id) : null;
}

function stationPublicNameFromIdOrName(value) {
  const s = value == null ? '' : String(value).trim();
  if (!s) return null;
  const looksLikeStationCode = /^[A-Z]\d{5}$/.test(s.toUpperCase());
  const byId = stationNameById(s);
  if (byId) return byId;
  if (looksLikeStationCode) return null; // non esporre codici Sxxxxx se non mappati
  const byName = stationRefFromName(s);
  if (byName) return byName;
  return s || null;
}

function italoStationNameFromCodeOrName(codeRaw, nameRaw) {
  const byCode = stationNameByItaloCode(codeRaw);
  if (byCode) return byCode;
  if (nameRaw == null) return null;
  const trimmed = String(nameRaw).trim();
  return trimmed || null;
}

function resolveStationCodeOrNull(stationCodeRaw, stationNameRaw) {
  const code = stationCodeRaw ? String(stationCodeRaw).trim().toUpperCase() : '';
  if (code) return code;
  const id = resolveStationIdByName(stationNameRaw);
  return id ? String(id).trim().toUpperCase() : null;
}

// ============================================================================
// Time helpers
// ============================================================================
let IT_TIME_FORMATTER = null;
function getItTimeFormatter() {
  if (IT_TIME_FORMATTER) return IT_TIME_FORMATTER;
  try {
    IT_TIME_FORMATTER = new Intl.DateTimeFormat('it-IT', {
      timeZone: APP_TIME_ZONE,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  } catch {
    IT_TIME_FORMATTER = null;
  }
  return IT_TIME_FORMATTER;
}

function formatHHmmFromMs(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = getItTimeFormatter();
  if (!fmt) return d.toISOString().slice(11, 16);
  return fmt.format(d);
}

function formatHHmmFromIso(iso) {
  const ms = Date.parse(String(iso || ''));
  return Number.isNaN(ms) ? null : formatHHmmFromMs(ms);
}

function formatYYYYMMDDFromIso(iso) {
  const ms = Date.parse(String(iso || ''));
  return Number.isNaN(ms) ? null : formatYYYYMMDDFromMs(ms);
}

let IT_DATE_FORMATTER = null;
function getItDateFormatter() {
  if (IT_DATE_FORMATTER) return IT_DATE_FORMATTER;
  try {
    IT_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
      timeZone: APP_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    IT_DATE_FORMATTER = null;
  }
  return IT_DATE_FORMATTER;
}

function formatYYYYMMDDFromMs(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = getItDateFormatter();
  if (fmt) return fmt.format(d);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let IT_DATE_IT_FORMATTER = null;
function getItDateItFormatter() {
  if (IT_DATE_IT_FORMATTER) return IT_DATE_IT_FORMATTER;
  try {
    IT_DATE_IT_FORMATTER = new Intl.DateTimeFormat('it-IT', {
      timeZone: APP_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  } catch {
    IT_DATE_IT_FORMATTER = null;
  }
  return IT_DATE_IT_FORMATTER;
}

function formatDateItalianFromMs(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const fmt = getItDateItFormatter();
  if (fmt) return fmt.format(d);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${day}/${m}/${y}`;
}

let APP_TZ_PARTS_FORMATTER = null;
function getAppTzPartsFormatter() {
  if (APP_TZ_PARTS_FORMATTER) return APP_TZ_PARTS_FORMATTER;
  try {
    APP_TZ_PARTS_FORMATTER = new Intl.DateTimeFormat('en-US', {
      timeZone: APP_TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
      hourCycle: 'h23',
    });
  } catch {
    APP_TZ_PARTS_FORMATTER = null;
  }
  return APP_TZ_PARTS_FORMATTER;
}

function getAppTimeZoneOffsetMs(utcMs) {
  const fmt = getAppTzPartsFormatter();
  if (!fmt) return 0;
  const d = new Date(utcMs);
  if (Number.isNaN(d.getTime())) return 0;
  const parts = fmt.formatToParts(d);
  const bag = {};
  for (const p of parts) {
    if (p.type === 'literal') continue;
    bag[p.type] = p.value;
  }
  const year = Number(bag.year);
  const month = Number(bag.month);
  const day = Number(bag.day);
  const hour = Number(bag.hour);
  const minute = Number(bag.minute);
  const second = Number(bag.second);
  if (![year, month, day, hour, minute, second].every(Number.isFinite)) return 0;
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  return asUtc - utcMs;
}

function appTzMidnightMsFromYMD(year, month, day) {
  if (![year, month, day].every(Number.isFinite)) return null;
  const utcMid = Date.UTC(year, month - 1, day, 0, 0, 0, 0);
  if (Number.isNaN(utcMid)) return null;
  let candidate = utcMid;
  for (let i = 0; i < 3; i += 1) {
    const offset = getAppTimeZoneOffsetMs(candidate);
    const next = utcMid - offset;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - candidate) < 1000) return next;
    candidate = next;
  }
  return candidate;
}

function parseIsoDateToLocalMidnightMs(isoDate) {
  const s = String(isoDate || '').trim();
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  return appTzMidnightMsFromYMD(year, month, day);
}

function toLocalDayStartMs(ms) {
  if (ms == null) return null;
  const iso = formatYYYYMMDDFromMs(ms);
  if (!iso) return null;
  return parseIsoDateToLocalMidnightMs(iso);
}

function addDaysFromLocalDayStartMs(dayStartMs, days) {
  if (!Number.isFinite(dayStartMs) || !Number.isFinite(days)) return null;
  const iso = formatYYYYMMDDFromMs(dayStartMs);
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (![year, month, day].every(Number.isFinite)) return null;

  // Aggiungi giorni in modo deterministico (UTC noon -> evita edge case DST).
  const base = new Date(Date.UTC(year, month - 1, day, 12, 0, 0, 0));
  if (Number.isNaN(base.getTime())) return null;
  base.setUTCDate(base.getUTCDate() + days);
  const y2 = base.getUTCFullYear();
  const m2 = base.getUTCMonth() + 1;
  const d2 = base.getUTCDate();
  return appTzMidnightMsFromYMD(y2, m2, d2);
}

function buildCoveredDaysFromRange(startMs, endMs) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return [];
  const startDay = toLocalDayStartMs(startMs);
  const endDay = toLocalDayStartMs(endMs);
  if (!Number.isFinite(startDay) || !Number.isFinite(endDay)) return [];
  if (endDay < startDay) return [];

  const days = [];
  let cur = startDay;
  for (let i = 0; i < 10 && cur <= endDay; i += 1) {
    days.push({ data: formatYYYYMMDDFromMs(cur), timestamp: cur });
    const next = addDaysFromLocalDayStartMs(cur, 1);
    if (!Number.isFinite(next) || next === cur) break;
    cur = next;
  }
  return days.filter((d) => d && d.data && Number.isFinite(d.timestamp));
}

function extractStopTimesMs(fermata) {
  const arr = fermata?.orari?.arrivo || null;
  const dep = fermata?.orari?.partenza || null;
  const cand = [
    arr?.programmato,
    arr?.reale,
    arr?.probabile,
    dep?.programmato,
    dep?.reale,
    dep?.probabile,
  ];
  return cand.filter((n) => typeof n === 'number' && Number.isFinite(n));
}

function buildFermatePerGiorno(fermate, allowedDayStarts = null) {
  const allow = Array.isArray(allowedDayStarts) && allowedDayStarts.length ? new Set(allowedDayStarts) : null;
  const map = new Map(); // dayStartMs -> Set<idx>

  for (let i = 0; i < (Array.isArray(fermate) ? fermate.length : 0); i += 1) {
    const times = extractStopTimesMs(fermate[i]);
    const days = new Set();
    for (const ms of times) {
      const ds = toLocalDayStartMs(ms);
      if (!Number.isFinite(ds)) continue;
      if (allow && !allow.has(ds)) continue;
      days.add(ds);
    }
    for (const ds of days) {
      if (!map.has(ds)) map.set(ds, new Set());
      map.get(ds).add(i);
    }
  }

  return Array.from(map.entries())
    .map(([timestamp, set]) => ({
      data: formatYYYYMMDDFromMs(timestamp),
      timestamp,
      indiciFermate: Array.from(set).sort((a, b) => a - b),
    }))
    .filter((x) => x && x.data && Number.isFinite(x.timestamp) && Array.isArray(x.indiciFermate))
    .sort((a, b) => Number(a.timestamp) - Number(b.timestamp));
}

function normalizeTrainTypeCode(code) {
  const c = String(code || '').trim().toUpperCase();
  if (!c || c === '?') return '?';
  if (c === 'ICN') return 'ICN';
  if (c === 'ES') return 'ES';
  if (c === 'EC') return 'EC';
  if (c === 'EN') return 'EN';
  if (c === 'METRO') return 'MET';
  if (c === 'RE' || c === 'R' || c === 'RV' || c === 'REG' || c === 'REX') return 'REG';
  if (c === 'FR' || c === 'FA' || c === 'FB' || c === 'IC') return c;
  return c;
}

function trainTypeNameFromCode(code) {
  const c = normalizeTrainTypeCode(code);
  if (c === 'FR') return 'Frecciarossa';
  if (c === 'FA') return 'Frecciargento';
  if (c === 'FB') return 'Frecciabianca';
  if (c === 'IC') return 'InterCity';
  if (c === 'ICN') return 'InterCity Notte';
  if (c === 'EC') return 'EuroCity';
  if (c === 'EN') return 'EuroNight';
  if (c === 'ES') return 'EuroStar';
  if (c === 'REG') return 'Regionale';
  if (c === 'ITA') return 'Italo';
  if (c === 'MET') return 'Metropolitana';
  return null;
}

function trainTypeInfoFromCode(code) {
  const sigla = normalizeTrainTypeCode(code);
  const siglaFinal = sigla === 'FR' || sigla === 'FA' || sigla === 'ITA' ? `${sigla} AV` : sigla;
  return { sigla: siglaFinal, nome: trainTypeNameFromCode(sigla) };
}

function formatTrainStatusLabel(status) {
  const s = String(status || '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'in viaggio') return 'In viaggio';
  if (s === 'in stazione') return 'In stazione';
  if (s === 'soppresso') return 'Soppresso';
  if (s === 'parzialmente soppresso' || s === 'parzialmente_soppresso') return 'Parzialmente soppresso';
  if (s === 'deviato') return 'Deviato';
  if (s === 'variato') return 'Variato';
  if (s === 'programmato') return 'Pianificato';
  if (s === 'regolare') return 'Regolare';
  if (s === 'concluso') return 'Concluso';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function toTrainNumberValue(value) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const s = value != null ? String(value).trim() : '';
  return s || null;
}

function buildTrainStatusCacheKey({
  trainNumber,
  originCodeHint,
  originNameHint,
  serviceDateHint,
  technicalHint,
  choiceHint,
  epochMsHint,
  debug,
}) {
  const originNameKey = originNameHint ? normalizeStationNameKey(originNameHint) : '';
  const epochPart = Number.isFinite(epochMsHint) ? String(epochMsHint) : '';
  return [
    'train-status',
    trainNumber || '',
    originCodeHint || '',
    originNameKey,
    serviceDateHint || '',
    technicalHint || '',
    choiceHint ?? '',
    epochPart,
    debug ? '1' : '0',
  ].join('|');
}

function buildModelResponse({
  dataRiferimento,
  dateDisponibili,
  compagnia,
  numeroTreno,
  tipoTreno,
  tratta,
  orari,
  statoTreno,
  fermate,
}) {
  const tipoTrenoPayload = tipoTreno
    ? {
        categoria: tipoTreno.sigla ?? null,
        nomeCat: tipoTreno.nome ?? null,
        compagnia: tipoTreno.compagnia ?? null,
      }
    : { categoria: null, nomeCat: null, compagnia: null };
  const fermateList = Array.isArray(fermate) ? fermate : [];
  const fermatePulite = fermateList.map((f) => ({
    stazione: f?.stazione ?? null,
    tipoFermata: f?.tipoFermata ?? null,
    statoFermata: f?.statoFermata ?? null,
    tipoFermataRfi: f?.tipoFermataRfi ?? null,
    orari: {
      arrivo: {
        deltaMinuti: f?.orari?.arrivo?.deltaMinuti ?? null,
        hhmm: {
          programmato: f?.orari?.arrivo?.hhmm?.programmato ?? null,
          reale: f?.orari?.arrivo?.hhmm?.reale ?? null,
          probabile: f?.orari?.arrivo?.hhmm?.probabile ?? null,
        },
      },
      partenza: {
        deltaMinuti: f?.orari?.partenza?.deltaMinuti ?? null,
        hhmm: {
          programmato: f?.orari?.partenza?.hhmm?.programmato ?? null,
          reale: f?.orari?.partenza?.hhmm?.reale ?? null,
          probabile: f?.orari?.partenza?.hhmm?.probabile ?? null,
        },
      },
    },
    binari: {
      arrivo: {
        programmato: f?.binari?.arrivo?.programmato ?? null,
        reale: f?.binari?.arrivo?.reale ?? null,
      },
      partenza: {
        programmato: f?.binari?.partenza?.programmato ?? null,
        reale: f?.binari?.partenza?.reale ?? null,
      },
    },
    ...(f?.carrozzaExecutive ? { carrozzaExecutive: f.carrozzaExecutive } : {}),
  }));
  const dateDisponibiliList = Array.isArray(dateDisponibili) ? dateDisponibili : [];
  return {
    ok: true,
    dataRiferimento,
    dateDisponibili: dateDisponibiliList,
    compagnia,
    numeroTreno: toTrainNumberValue(numeroTreno),
    tipoTreno: tipoTrenoPayload,
    tratta: {
      stazionePartenzaZero: tratta?.origine ?? null,
      orarioPartenzaZero: orari?.partenza?.programmato ?? null,
      stazioneArrivoZero: tratta?.destinazione ?? null,
      orarioArrivoZero: orari?.arrivo?.programmato ?? null,
    },
    statoTreno: {
      deltaTempo: statoTreno?.deltaTempo ?? null,
      stato: statoTreno?.stato ?? null,
      statoServizio: statoTreno?.statoServizio ?? null,
      statoServizioRaw: statoTreno?.statoServizioRaw ?? null,
      statoServizioRfi: statoTreno?.statoServizioRfi ?? null,
      stazioneCorrente: statoTreno?.stazioneCorrente ?? null,
      stazioneSuccessiva: statoTreno?.stazioneSuccessiva ?? null,
      stazionePrecedente: statoTreno?.stazionePrecedente ?? null,
      infoIR: statoTreno?.infoIR ?? null,
      messaggiRfi: statoTreno?.messaggiRfi ?? null,
    },
    fermate: {
      totali: fermatePulite.length,
      fermate: fermatePulite,
    },
  };
}

function attachCorrispondenza(payload, rfiFound, italoFound) {
  const corrispondenza = {
    rfi: { trovato: !!rfiFound },
    italo: { trovato: !!italoFound },
  };
  if (rfiFound && italoFound) {
    corrispondenza.messaggio = 'Trovati treni sia RFI che Italo con lo stesso numero';
  }
  return { ...payload, corrispondenza };
}

function parseExecutivePositionFromText(text) {
  const s = String(text || '').toLowerCase();
  if (!s) return null;
  if (s.includes('coda')) return 'coda';
  if (s.includes('testa')) return 'testa';
  return null;
}

function flipHeadTail(pos) {
  if (pos === 'coda') return 'testa';
  if (pos === 'testa') return 'coda';
  return null;
}

function decodeHtmlEntities(input) {
  const s = String(input || '');
  if (!s) return '';
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, num) => String.fromCodePoint(parseInt(num, 10)));
}

function parseInfomobilitaTicker(html) {
  const input = String(html || '');
  const items = [];
  const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = liRegex.exec(input)) !== null) {
    const raw = match[1] || '';
    const text = decodeHtmlEntities(raw.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
      .replace(/\s+/g, ' ')
      .trim();
    if (text) items.push(text);
  }
  if (items.length) return items;
  const fallback = decodeHtmlEntities(input.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  return fallback;
}

function extractTextLinesFromHtml(html) {
  const decoded = decodeHtmlEntities(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p\s*>/gi, '\n')
      .replace(/<\/li\s*>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
  );
  return decoded
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function mergeInfoHeadings(lines) {
  const merged = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const next = lines[i + 1];
    if (/^(Aggiornamento|Inizio evento|Fine evento|Conclusione evento|Ripresa)\b/i.test(line) && next) {
      merged.push(`${line}: ${next}`);
      i += 1;
      continue;
    }
    merged.push(line);
  }
  return merged;
}

function summarizeInfomobilitaLines(lines) {
  if (!lines || !lines.length) return null;
  const merged = mergeInfoHeadings(lines);
  const deduped = [];
  const seen = new Set();
  for (const line of merged) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(line);
  }
  if (!deduped.length) return null;

  const summary = [deduped[0]];
  const keywordRegex =
    /(ritard|cancell|limitaz|bus|instrad|sospes|interrott|regolar|circolaz|ripres|guast|danneggi|lavor|manuten)/i;
  for (let i = 1; i < deduped.length && summary.length < 3; i += 1) {
    if (keywordRegex.test(deduped[i])) summary.push(deduped[i]);
  }
  if (summary.length < 2 && deduped.length > 1) summary.push(deduped[1]);
  if (summary.length < 3) {
    for (let i = 1; i < deduped.length && summary.length < 3; i += 1) {
      if (!summary.includes(deduped[i])) summary.push(deduped[i]);
    }
  }

  let text = summary.join('\n');
  const maxChars = 700;
  if (text.length > maxChars) text = `${text.slice(0, maxChars - 3).trimEnd()}...`;
  return text;
}

function parseInfomobilitaRSS(html) {
  const input = String(html || '');
  const items = [];
  const liRegex = /<li[^>]*class="[^"]*editModeCollapsibleElement[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let match;
  while ((match = liRegex.exec(input)) !== null) {
    const chunk = match[1] || '';
    const titleMatch = chunk.match(/<a[^>]*class="([^"]*headingNewsAccordion[^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    const titleHtml = titleMatch ? titleMatch[2] : '';
    const title = decodeHtmlEntities(titleHtml.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const headingClasses = titleMatch ? titleMatch[1] : '';

    const dateMatch = chunk.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i);
    const date = dateMatch
      ? decodeHtmlEntities(dateMatch[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
      : null;

    const infoMatch = chunk.match(/<div[^>]*class="([^"]*info-text[^"]*)"[^>]*>([\s\S]*?)<\/div>/i);
    const infoClasses = infoMatch ? infoMatch[1] : '';
    const infoHtml = infoMatch ? infoMatch[2] : '';
    const lines = extractTextLinesFromHtml(infoHtml);
    const text = summarizeInfomobilitaLines(lines);
    const inEvidenza =
      /(?:^|\s)inEvidenza(?:\s|$)/i.test(headingClasses) ||
      /(?:^|\s)inEvidenza(?:\s|$)/i.test(infoClasses);

    if (title || text) {
      items.push({
        title: title || null,
        date,
        text: text || null,
        inEvidenza: !!inEvidenza,
      });
    }
  }

  if (items.length) return items;

  const fallback = extractTextLinesFromHtml(input);
  return fallback.map((line) => ({
    title: null,
    date: null,
    text: summarizeInfomobilitaLines([line]) || line,
    inEvidenza: false,
  }));
}

function encodeDateString(when = 'now') {
  const baseDate = when === 'now' ? new Date() : new Date(when);
  return encodeURIComponent(baseDate.toString());
}

function toIsoOrNow(when = 'now') {
  const d = when === 'now' ? new Date() : new Date(when);
  const ms = d.getTime();
  return Number.isNaN(ms) ? new Date().toISOString() : d.toISOString();
}

function parseEpochMsOrSeconds(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > 1e11 && n < 1e13) return n; // epoch ms
  if (n > 1e9 && n < 1e10) return n * 1000; // epoch seconds
  return null;
}

function parseBool(val, defaultVal = false) {
  if (val === undefined || val === null) return defaultVal;
  if (typeof val === 'boolean') return val;
  const s = String(val).toLowerCase().trim();
  if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(s)) return false;
  return defaultVal;
}

function normalizeErrorMessage(err) {
  if (EXPOSE_ERRORS) return err?.message || 'Errore interno';
  if (err?.status) return `Errore upstream (${err.status})`;
  return 'Errore interno';
}

function promiseWithTimeout(promise, timeoutMs) {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return promise.then((value) => ({ value, timedOut: false }));
  }
  let timer = null;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ value: null, timedOut: true }), timeoutMs);
  });
  return Promise.race([
    promise.then((value) => ({ value, timedOut: false })),
    timeout,
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function setCacheHeaders(res, ttlMs, swrMs = null) {
  const ttl = Math.max(0, Math.floor(Number(ttlMs) / 1000));
  if (!Number.isFinite(ttl) || ttl <= 0) return;
  const swr = Math.max(0, Math.floor(Number(swrMs != null ? swrMs : ttlMs) / 1000));
  res.set('Cache-Control', `public, max-age=${ttl}, s-maxage=${ttl}, stale-while-revalidate=${swr}`);
}

// ============================================================================
// HTTP helpers (con header browser-like per evitare 403)
// ============================================================================
async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
      ...(options.headers || {}),
    };
    return await fetch(url, { ...options, headers, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, options = {}) {
  const resp = await fetchWithTimeout(url, options);
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status} per ${url}`);
    err.status = resp.status;
    throw err;
  }
  return resp.text();
}

async function fetchJson(url, options = {}) {
  const resp = await fetchWithTimeout(url, options);
  if (resp.status === 204) return null;
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status} per ${url}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

// ============================================================================
// Helpers: ViaggiaTreno station detail
// ============================================================================
async function fetchRegionId(stationCode) {
  const key = `vt:regione:${stationCode}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const regionId = (await fetchText(`${VT_BASE_URL}/regione/${encodeURIComponent(stationCode)}`)).trim();
  return cacheSet(key, regionId);
}

async function fetchStationDetail(stationCode, regionId) {
  const key = `vt:dettaglio:${stationCode}:${regionId}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const detail = await fetchJson(
    `${VT_BASE_URL}/dettaglioStazione/${encodeURIComponent(stationCode)}/${encodeURIComponent(regionId)}`
  );
  return cacheSet(key, detail);
}

// ============================================================================
// Helpers: Train kind (semantico)
// ============================================================================
function resolveTrainKind(...sources) {
  const hay = sources
    .filter(Boolean)
    .map((v) => String(v).toUpperCase())
    .join(' ');

  const pick = (code, category) => ({ codice: code, nome: code, categoria: category });

  if (/(INTERCITY\s*NOTTE|ICN)\b/.test(hay)) return pick('ICN', 'intercity');
  if (/(EURO\s*CITY|EUROCITY|(^|[^A-Z])EC(\s|$))/.test(hay)) return pick('EC', 'intercity');
  if (/(EURO\s*NIGHT|EURONIGHT|(^|[^A-Z])EN(\s|$))/.test(hay)) return pick('EN', 'intercity');
  if (/(FRECCIAROSSA|(^|[^A-Z])FR(\s|$))/.test(hay)) return pick('FR', 'high-speed');
  if (/(FRECCIARGENTO|(^|[^A-Z])FA(\s|$))/.test(hay)) return pick('FA', 'high-speed');
  if (/(FRECCIABIANCA|(^|[^A-Z])FB(\s|$))/.test(hay)) return pick('FB', 'intercity');
  if (/(ITALO|NTV|(^|[^A-Z])ITA(\s|$))/.test(hay)) return pick('ITA', 'high-speed');
  if (/(INTERCITY|(^|[^A-Z])IC(\s|$))/.test(hay)) return pick('IC', 'intercity');
  // Normalizza tutte le varianti "regionali" su REG (RV, R, REG, ...).
  if (/(REGIONALE\s+VELOCE|(^|[^A-Z])RV(\s|$))/.test(hay)) return pick('REG', 'regional');
  if (/(REGIONALE|(^|[^A-Z])REG(\s|$)|(^|[^A-Z])RE(\s|$)|(^|[^A-Z])R(\s|$))/.test(hay))
    return pick('REG', 'regional');
  if (/(^|[^A-Z])MET(\s|$)|METRO|METROPOLITANA/.test(hay)) return pick('MET', 'metro');
  if (/(BUS|SOSTITUTIVO)/.test(hay)) return pick('BUS', 'bus');
  return pick('?', 'unknown');
}

function resolveTrainKindFromNumber(trainNumberRaw) {
  const num = trainNumberRaw != null ? String(trainNumberRaw).trim() : '';
  if (!num) return null;
  if (num === '99122') return { codice: 'ES', nome: 'ES', categoria: 'high-speed' };
  return null;
}

function resolveTrainKindFromCliente(codiceClienteRaw, compNumeroTrenoRaw) {
  const codiceCliente = Number(codiceClienteRaw);
  if (!Number.isFinite(codiceCliente)) return null;
  const pick = (code, category) => ({ codice: code, nome: code, categoria: category });

  if (codiceCliente === 1) return pick('FR', 'high-speed');
  if (codiceCliente === 2) return pick('REG', 'regional');
  if (codiceCliente === 4) return pick('IC', 'intercity');
  if (codiceCliente === 18) return pick('REG', 'regional');
  if (codiceCliente === 63) return pick('REG', 'regional');
  if (codiceCliente === 64) return pick('REG', 'regional');
  return null;
}

function resolveCompanyCodeFromCliente(codiceClienteRaw) {
  const codiceCliente = Number(codiceClienteRaw);
  if (!Number.isFinite(codiceCliente)) return null;
  if (codiceCliente === 63) return 'TN';
  if (codiceCliente === 18) return 'TTX';
  if (codiceCliente === 1 || codiceCliente === 2 || codiceCliente === 4) return 'TI';
  if (codiceCliente === 64) return 'OBB';
  return null;
}

function resolveCompanyCodeFromCompNumeroTreno(compNumeroTrenoRaw) {
  const comp = String(compNumeroTrenoRaw || '').trim().toUpperCase();
  if (!comp) return null;
  if (/ITALO|NTV/.test(comp)) return 'NTV';
  if (/(^|[^A-Z])TN(\s|$)|TRENORD/.test(comp)) return 'TN';
  if (/TPER|TTPER|TTX/.test(comp)) return 'TTX';
  if (/OBB/.test(comp)) return 'OBB';
  if (/(^|[^A-Z])TI(\s|$)|TRENITALIA/.test(comp)) return 'TI';
  return null;
}

function resolveCompanyCode(compNumeroTrenoRaw, codiceClienteRaw) {
  const fromComp = resolveCompanyCodeFromCompNumeroTreno(compNumeroTrenoRaw);
  if (fromComp) return fromComp;
  return resolveCompanyCodeFromCliente(codiceClienteRaw);
}

// ============================================================================
// Helpers: platform / epoch
// ============================================================================
function normalizePlatformValue(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s || s === '0') return null;
  return s;
}

function pickFirstString(obj, keys) {
  for (const k of keys) {
    if (!k) continue;
    const v = normalizePlatformValue(obj && obj[k]);
    if (v) return v;
  }
  return null;
}

function buildPlatformsForDeparture(entry) {
  const binarioProgrammato = pickFirstString(entry, [
    'binarioProgrammatoPartenzaDescrizione',
    'binarioProgrammatoPartenzaCodice',
    'binarioProgrammato',
  ]);
  const binarioEffettivo = pickFirstString(entry, [
    'binarioEffettivoPartenzaDescrizione',
    'binarioEffettivoPartenzaCodice',
    'binarioEffettivo',
  ]);
  return { binarioProgrammato, binarioEffettivo };
}

function buildPlatformsForArrival(entry) {
  const binarioProgrammato = pickFirstString(entry, [
    'binarioProgrammatoArrivoDescrizione',
    'binarioProgrammatoArrivoCodice',
    'binarioProgrammato',
  ]);
  const binarioEffettivo = pickFirstString(entry, [
    'binarioEffettivoArrivoDescrizione',
    'binarioEffettivoArrivoCodice',
    'binarioEffettivo',
  ]);
  return { binarioProgrammato, binarioEffettivo };
}

function pickEpochMs(entry, keys) {
  for (const k of keys) {
    const v = entry && entry[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 1e11 && v < 1e13) return v;
    const n = Number(v);
    if (Number.isFinite(n) && n > 1e11 && n < 1e13) return n;
  }
  return null;
}

function mapDepartureEntry(entry) {
  const tipoTrenoRaw = resolveTrainKind(
    entry?.categoriaDescrizione,
    entry?.categoria,
    entry?.tipoTreno,
    entry?.compNumeroTreno
  );
  const clienteKind = resolveTrainKindFromCliente(entry?.codiceCliente, entry?.tipoTreno, entry?.compNumeroTreno);
  const numberKind = resolveTrainKindFromNumber(entry?.numeroTreno);
  const tipoTrenoFinal = numberKind || (tipoTrenoRaw.codice !== '?' ? tipoTrenoRaw : clienteKind || tipoTrenoRaw);
  const companyCode = resolveCompanyCodeFromCliente(entry?.codiceCliente);
  const tipoTreno = { ...trainTypeInfoFromCode(tipoTrenoFinal.codice), ...(companyCode ? { compagnia: companyCode } : {}) };
  // NB: su ViaggiaTreno "partenzaTreno" è spesso la partenza dal capolinea origine,
  // mentre "orarioPartenza" è l'evento (partenza) riferito alla stazione richiesta.
  const partenzaMs = pickEpochMs(entry, ['orarioPartenza', 'partenza', 'partenzaTreno', 'dataPartenzaTreno']);
  const { binarioProgrammato, binarioEffettivo } = buildPlatformsForDeparture(entry);
  const ritardo = parseDelayMinutes(entry?.ritardo) ?? 0;
  const circolante =
    typeof entry?.circolante === 'boolean'
      ? entry.circolante
      : entry?.soppresso != null
        ? !entry.soppresso
        : true;

  return {
    numeroTreno: entry && entry.numeroTreno != null ? String(entry.numeroTreno) : null,
    origine: stationPublicNameFromIdOrName(entry?.codOrigine) || stationPublicNameFromIdOrName(entry?.origine),
    destinazione:
      stationPublicNameFromIdOrName(entry?.codDestinazione) || stationPublicNameFromIdOrName(entry?.destinazione),
    orarioPartenza: partenzaMs,
    orarioPartenzaLeggibile: formatHHmmFromMs(partenzaMs),
    ritardo: Number.isFinite(ritardo) ? ritardo : null,
    binarioProgrammato,
    binarioEffettivo,
    arrivato: typeof entry?.arrivato === 'boolean' ? entry.arrivato : null,
    circolante: !!circolante,
    tipoTreno,
  };
}

function mapArrivalEntry(entry) {
  const tipoTrenoRaw = resolveTrainKind(
    entry?.categoriaDescrizione,
    entry?.categoria,
    entry?.tipoTreno,
    entry?.compNumeroTreno
  );
  const clienteKind = resolveTrainKindFromCliente(entry?.codiceCliente, entry?.tipoTreno, entry?.compNumeroTreno);
  const numberKind = resolveTrainKindFromNumber(entry?.numeroTreno);
  const tipoTrenoFinal = numberKind || (tipoTrenoRaw.codice !== '?' ? tipoTrenoRaw : clienteKind || tipoTrenoRaw);
  const companyCode = resolveCompanyCodeFromCliente(entry?.codiceCliente);
  const tipoTreno = { ...trainTypeInfoFromCode(tipoTrenoFinal.codice), ...(companyCode ? { compagnia: companyCode } : {}) };
  // NB: su ViaggiaTreno "arrivoTreno" può riferirsi al capolinea, mentre "orarioArrivo" è relativo alla stazione.
  const arrivoMs = pickEpochMs(entry, ['orarioArrivo', 'arrivo', 'arrivoTreno', 'dataArrivoTreno']);
  const { binarioProgrammato, binarioEffettivo } = buildPlatformsForArrival(entry);
  const ritardo = parseDelayMinutes(entry?.ritardo) ?? 0;
  const circolante =
    typeof entry?.circolante === 'boolean'
      ? entry.circolante
      : entry?.soppresso != null
        ? !entry.soppresso
        : true;

  return {
    numeroTreno: entry && entry.numeroTreno != null ? String(entry.numeroTreno) : null,
    origine: stationPublicNameFromIdOrName(entry?.codOrigine) || stationPublicNameFromIdOrName(entry?.origine),
    destinazione:
      stationPublicNameFromIdOrName(entry?.codDestinazione) || stationPublicNameFromIdOrName(entry?.destinazione),
    orarioArrivo: arrivoMs,
    orarioArrivoLeggibile: formatHHmmFromMs(arrivoMs),
    ritardo: Number.isFinite(ritardo) ? ritardo : null,
    binarioProgrammato,
    binarioEffettivo,
    arrivato: typeof entry?.arrivato === 'boolean' ? entry.arrivato : null,
    circolante: !!circolante,
    tipoTreno,
  };
}

function parseDelayMinutes(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/[-+]?\d+(?:[.,]\d+)?/);
  if (!m) return null;
  const n = Number(m[0].replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseWhenToMs(when = 'now') {
  if (when === 'now') return Date.now();
  const ms = Date.parse(String(when || ''));
  return Number.isNaN(ms) ? Date.now() : ms;
}

function shouldUseItaloNow(when = 'now') {
  if (when === 'now') return true;
  const whenMs = parseWhenToMs(when);
  const nowMs = Date.now();
  const whenDay = toLocalDayStartMs(whenMs);
  const nowDay = toLocalDayStartMs(nowMs);
  return Number.isFinite(whenDay) && Number.isFinite(nowDay) && whenDay === nowDay;
}

const ITALO_TIME_SHIFT_WINDOW_MS = 12 * 60 * 60 * 1000;
const ITALO_DAY_MS = 24 * 60 * 60 * 1000;

function parseItaloTimeMs(hhmm, referenceMs) {
  const s = String(hhmm || '').trim();
  const m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || !Number.isFinite(referenceMs)) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  const dayStart = toLocalDayStartMs(referenceMs);
  if (!Number.isFinite(dayStart)) return null;
  let candidate = dayStart + (hour * 60 + minute) * 60 * 1000;
  const diff = candidate - referenceMs;
  if (diff > ITALO_TIME_SHIFT_WINDOW_MS) candidate -= 24 * 60 * 60 * 1000;
  if (diff < -ITALO_TIME_SHIFT_WINDOW_MS) candidate += 24 * 60 * 60 * 1000;
  return candidate;
}

function alignItaloTimeMs(hhmm, referenceMs, minMs = null) {
  let candidate = parseItaloTimeMs(hhmm, referenceMs);
  if (candidate == null) return null;
  if (minMs != null && Number.isFinite(minMs)) {
    const diff = candidate - minMs;
    if (diff < -ITALO_TIME_SHIFT_WINDOW_MS) candidate += ITALO_DAY_MS;
    if (diff > ITALO_TIME_SHIFT_WINDOW_MS) candidate -= ITALO_DAY_MS;
  }
  return candidate;
}

async function fetchItaloStationBoard(italoCode) {
  const url = `${ITALO_STATION_BASE_URL}?CodiceStazione=${encodeURIComponent(italoCode)}`;
  return fetchJson(url);
}

async function fetchItaloTrainStatus(trainNumber) {
  const url = `${ITALO_TRAIN_BASE_URL}?TrainNumber=${encodeURIComponent(trainNumber)}`;
  return fetchJson(url);
}

function mapItaloRunningState(rawState) {
  const state = Number(rawState);
  if (state === 0) return 'programmato';
  if (state === 1) return 'in stazione';
  if (state === 2) return 'in viaggio';
  if (state === 3) return 'concluso';
  return null;
}

function mapItaloArrivalEntry(entry, stationName, referenceMs) {
  const scheduledMs =
    parseItaloTimeMs(entry?.OraPassaggio, referenceMs) ??
    parseItaloTimeMs(entry?.NuovoOrario, referenceMs);
  const ritardo = parseDelayMinutes(entry?.Ritardo) ?? 0;
  const binario = normalizePlatformValue(entry?.Binario);
  return {
    numeroTreno: entry?.Numero != null ? String(entry.Numero) : null,
    origine: italoStationNameFromCodeOrName(entry?.CodiceLocalita || entry?.LocationCode, entry?.DescrizioneLocalita),
    destinazione: stationName || null,
    orarioArrivo: scheduledMs,
    orarioArrivoLeggibile: formatHHmmFromMs(scheduledMs),
    ritardo: Number.isFinite(ritardo) ? ritardo : null,
    binarioProgrammato: binario,
    binarioEffettivo: null,
    arrivato: null,
    circolante: true,
    tipoTreno: { ...trainTypeInfoFromCode('ITA'), compagnia: 'NTV' },
  };
}

function mapItaloDepartureEntry(entry, stationName, referenceMs) {
  const scheduledMs =
    parseItaloTimeMs(entry?.OraPassaggio, referenceMs) ??
    parseItaloTimeMs(entry?.NuovoOrario, referenceMs);
  const ritardo = parseDelayMinutes(entry?.Ritardo) ?? 0;
  const binario = normalizePlatformValue(entry?.Binario);
  return {
    numeroTreno: entry?.Numero != null ? String(entry.Numero) : null,
    origine: stationName || null,
    destinazione: italoStationNameFromCodeOrName(entry?.CodiceLocalita || entry?.LocationCode, entry?.DescrizioneLocalita),
    orarioPartenza: scheduledMs,
    orarioPartenzaLeggibile: formatHHmmFromMs(scheduledMs),
    ritardo: Number.isFinite(ritardo) ? ritardo : null,
    binarioProgrammato: binario,
    binarioEffettivo: null,
    arrivato: null,
    circolante: true,
    tipoTreno: { ...trainTypeInfoFromCode('ITA'), compagnia: 'NTV' },
  };
}

function pickItaloStopKey(stop) {
  const num = Number(stop?.StationNumber);
  if (Number.isFinite(num)) return `num:${num}`;
  const code = stop?.LocationCode != null ? String(stop.LocationCode).trim() : '';
  const name = stop?.LocationDescription != null ? String(stop.LocationDescription).trim() : '';
  return `loc:${code || name}`;
}

function chooseBetterItaloStop(a, b) {
  const score = (stop) => {
    let points = 0;
    if (stop?.ActualArrivalTime) points += 2;
    if (stop?.ActualDepartureTime) points += 2;
    if (stop?.EstimatedArrivalTime) points += 1;
    if (stop?.EstimatedDepartureTime) points += 1;
    if (stop?.LocationDescription) points += 1;
    return points;
  };
  return score(b) > score(a) ? b : a;
}

function buildItaloStops(schedule, referenceMs) {
  const rawStops = [];
  if (schedule?.StazionePartenza) rawStops.push({ ...schedule.StazionePartenza, __source: 'origin' });
  if (Array.isArray(schedule?.StazioniFerme)) {
    schedule.StazioniFerme.forEach((stop) => rawStops.push({ ...stop, __source: 'stop' }));
  }
  if (Array.isArray(schedule?.StazioniNonFerme)) {
    schedule.StazioniNonFerme.forEach((stop) => rawStops.push({ ...stop, __source: 'pass' }));
  }

  const map = new Map();
  for (const stop of rawStops) {
    const key = pickItaloStopKey(stop);
    if (!map.has(key)) map.set(key, stop);
    else map.set(key, chooseBetterItaloStop(map.get(key), stop));
  }

  const ordered = Array.from(map.values()).sort((a, b) => {
    const na = Number(a?.StationNumber);
    const nb = Number(b?.StationNumber);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    if (Number.isFinite(na)) return -1;
    if (Number.isFinite(nb)) return 1;
    return 0;
  });

  const nowMs = referenceMs ?? Date.now();
  let rollingMs = parseItaloTimeMs(schedule?.DepartureDate, referenceMs) ?? referenceMs;
  const stops = ordered.map((stop, index) => {
    const isOrigin = index === 0;
    const isDestination = index === ordered.length - 1;

    const schedArrivoMs = isOrigin
      ? null
      : alignItaloTimeMs(stop?.EstimatedArrivalTime, rollingMs, rollingMs);
    const realArrivoMs = isOrigin
      ? null
      : alignItaloTimeMs(stop?.ActualArrivalTime, schedArrivoMs ?? rollingMs, schedArrivoMs ?? rollingMs);
    const refAfterArrivo = realArrivoMs ?? schedArrivoMs ?? rollingMs;
    const schedPartenzaMs = isDestination
      ? null
      : alignItaloTimeMs(stop?.EstimatedDepartureTime, refAfterArrivo, refAfterArrivo);
    const realPartenzaMs = isDestination
      ? null
      : alignItaloTimeMs(stop?.ActualDepartureTime, schedPartenzaMs ?? refAfterArrivo, schedPartenzaMs ?? refAfterArrivo);

    rollingMs = realPartenzaMs ?? schedPartenzaMs ?? realArrivoMs ?? schedArrivoMs ?? rollingMs;

    const binario = normalizePlatformValue(stop?.ActualArrivalPlatform);
    const arrivoFuture = realArrivoMs != null && realArrivoMs > nowMs + 60 * 1000;
    const partenzaFuture = realPartenzaMs != null && realPartenzaMs > nowMs + 60 * 1000;
    const effArrivoMs = arrivoFuture ? null : realArrivoMs;
    const effPartenzaMs = partenzaFuture ? null : realPartenzaMs;
    const probArrivoMs = arrivoFuture ? realArrivoMs : null;
    const probPartenzaMs = partenzaFuture ? realPartenzaMs : null;
    const delayArrivo =
      schedArrivoMs != null && effArrivoMs != null
        ? Math.round((effArrivoMs - schedArrivoMs) / 60000)
        : schedArrivoMs != null && probArrivoMs != null
          ? Math.round((probArrivoMs - schedArrivoMs) / 60000)
          : null;
    const delayPartenza =
      schedPartenzaMs != null && effPartenzaMs != null
        ? Math.round((effPartenzaMs - schedPartenzaMs) / 60000)
        : schedPartenzaMs != null && probPartenzaMs != null
          ? Math.round((probPartenzaMs - schedPartenzaMs) / 60000)
          : null;

    return {
      stazione: italoStationNameFromCodeOrName(stop?.LocationCode, stop?.LocationDescription),
      tipoFermata: isOrigin ? 'P' : isDestination ? 'A' : 'F',
      orari: {
        arrivo: {
          programmato: schedArrivoMs,
          reale: effArrivoMs,
          probabile: probArrivoMs,
          deltaMinuti: delayArrivo,
          hhmm: {
            programmato: formatHHmmFromMs(schedArrivoMs),
            reale: formatHHmmFromMs(effArrivoMs),
            probabile: formatHHmmFromMs(probArrivoMs),
          },
        },
        partenza: {
          programmato: schedPartenzaMs,
          reale: effPartenzaMs,
          probabile: probPartenzaMs,
          deltaMinuti: delayPartenza,
          hhmm: {
            programmato: formatHHmmFromMs(schedPartenzaMs),
            reale: formatHHmmFromMs(effPartenzaMs),
            probabile: formatHHmmFromMs(probPartenzaMs),
          },
        },
      },
      binari: {
        arrivo: { programmato: binario, reale: binario },
        partenza: { programmato: binario, reale: binario },
      },
    };
  });

  return stops;
}

function getItaloStopArrivalRealMs(stop) {
  return stop?.orari?.arrivo?.reale ?? null;
}

function getItaloStopDepartureRealMs(stop) {
  return stop?.orari?.partenza?.reale ?? null;
}

function getItaloStopArrivalPlannedMs(stop) {
  return stop?.orari?.arrivo?.programmato ?? null;
}

function getItaloStopDeparturePlannedMs(stop) {
  return stop?.orari?.partenza?.programmato ?? null;
}

function getItaloStopArrivalForecastMs(stop) {
  return stop?.orari?.arrivo?.probabile ?? getItaloStopArrivalPlannedMs(stop);
}

function getItaloStopDepartureForecastMs(stop) {
  return stop?.orari?.partenza?.probabile ?? getItaloStopDeparturePlannedMs(stop);
}

function getItaloStopArrivalMs(stop) {
  return getItaloStopArrivalRealMs(stop) ?? getItaloStopArrivalForecastMs(stop) ?? null;
}

function getItaloStopDepartureMs(stop) {
  return getItaloStopDepartureRealMs(stop) ?? getItaloStopDepartureForecastMs(stop) ?? null;
}

function getItaloStopPassMs(stop) {
  if (!stop) return null;
  const arrivoMs = getItaloStopArrivalMs(stop);
  const partenzaMs = getItaloStopDepartureMs(stop);
  if (stop.tipoFermata === 'P') return partenzaMs ?? arrivoMs;
  if (stop.tipoFermata === 'A') return arrivoMs ?? partenzaMs;
  return arrivoMs ?? partenzaMs;
}

function buildItaloNextStopSummary(nextStop, index) {
  if (!nextStop || index == null) return null;
  return {
    indice: index,
    stazione: nextStop?.stazione ?? null,
    arrivoPrevisto: formatHHmmFromMs(getItaloStopArrivalForecastMs(nextStop)),
  };
}

function buildItaloPreviousStopSummary(prevStop, index) {
  if (!prevStop || index == null) return null;
  return {
    indice: index,
    stazione: prevStop?.stazione ?? null,
    arrivoReale: formatHHmmFromMs(getItaloStopArrivalRealMs(prevStop)),
    partenzaReale: formatHHmmFromMs(getItaloStopDepartureRealMs(prevStop)),
  };
}

function computeItaloStopIndexes(fermate, referenceMs) {
  let previousIdx = null;
  let nextIdx = null;
  let currentIdx = null;
  if (!Array.isArray(fermate) || fermate.length === 0) return { previousIdx, nextIdx, currentIdx };

  for (let i = 0; i < fermate.length; i += 1) {
    const passMs = getItaloStopPassMs(fermate[i]);
    if (passMs == null) continue;
    if (passMs <= referenceMs) previousIdx = i;
    else {
      nextIdx = i;
      break;
    }
  }

  if (nextIdx != null && fermate[nextIdx]?.tipoFermata === 'P') {
    let replacement = null;
    for (let i = nextIdx + 1; i < fermate.length; i += 1) {
      if (fermate[i]?.tipoFermata !== 'P') {
        replacement = i;
        break;
      }
    }
    nextIdx = replacement;
  }

  for (let i = 0; i < fermate.length; i += 1) {
    const stop = fermate[i];
    const arrivoMs = getItaloStopArrivalMs(stop);
    const partenzaMs = getItaloStopDepartureMs(stop);
    if (stop?.tipoFermata === 'P') {
      if (partenzaMs != null && referenceMs <= partenzaMs) {
        currentIdx = i;
        break;
      }
    } else if (arrivoMs != null && partenzaMs != null) {
      if (referenceMs >= arrivoMs && referenceMs <= partenzaMs) {
        currentIdx = i;
        break;
      }
    } else if (arrivoMs != null && partenzaMs == null) {
      if (referenceMs >= arrivoMs) {
        currentIdx = i;
        break;
      }
    }
  }

  if (currentIdx == null && previousIdx != null) currentIdx = previousIdx;

  return { previousIdx, nextIdx, currentIdx };
}

const ITALO_STATE_TOLERANCE_MS = 2 * 60 * 1000;

function deriveItaloRunningState({
  rawState,
  referenceMs,
  firstDepartureMs,
  lastArrivalMs,
  currentIdx,
  fermate,
}) {
  if (rawState && rawState !== 'programmato') return rawState;
  let derived = 'programmato';
  if (lastArrivalMs != null && referenceMs >= lastArrivalMs + ITALO_STATE_TOLERANCE_MS) {
    derived = 'concluso';
  } else if (firstDepartureMs != null && referenceMs >= firstDepartureMs - ITALO_STATE_TOLERANCE_MS) {
    derived = 'in viaggio';
  }

  if (derived === 'in viaggio' && currentIdx != null && Array.isArray(fermate)) {
    const stop = fermate[currentIdx];
    const arrivoMs = getItaloStopArrivalMs(stop);
    const partenzaMs = getItaloStopDepartureMs(stop);
    if (
      arrivoMs != null &&
      partenzaMs != null &&
      referenceMs >= arrivoMs - ITALO_STATE_TOLERANCE_MS &&
      referenceMs <= partenzaMs + ITALO_STATE_TOLERANCE_MS
    ) {
      derived = 'in stazione';
    }
  }

  return derived;
}

function mergeTrainEntries(primary, extra, timeKey) {
  const merged = [];
  const seen = new Set();
  const buildKey = (item) => {
    if (!item || typeof item !== 'object') return '';
    const num = item.numeroTreno != null ? String(item.numeroTreno) : '';
    const time = item[timeKey] != null ? String(item[timeKey]) : '';
    const origine = item.origine != null ? String(item.origine) : '';
    const destinazione = item.destinazione != null ? String(item.destinazione) : '';
    const key = `${num}|${time}|${origine}|${destinazione}`;
    return key !== '|||'
      ? key
      : JSON.stringify({
          numeroTreno: num || null,
          time: time || null,
          origine: origine || null,
          destinazione: destinazione || null,
        });
  };
  for (const item of [...primary, ...extra]) {
    const key = buildKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }
  return merged
    .map((item, idx) => ({
      item,
      idx,
      time: item && Number.isFinite(Number(item[timeKey])) ? Number(item[timeKey]) : null,
    }))
    .sort((a, b) => {
      const timeA = a.time != null ? a.time : Number.POSITIVE_INFINITY;
      const timeB = b.time != null ? b.time : Number.POSITIVE_INFINITY;
      if (timeA !== timeB) return timeA - timeB;
      return a.idx - b.idx;
    })
    .map((entry) => entry.item);
}

function computeProbableMs(scheduledMs, realMs, delayMinutes) {
  // Se c'è l'orario reale, il "probabile" non serve (come in precedenza): ritorna null.
  if (realMs != null) return null;
  if (scheduledMs == null) return null;
  if (delayMinutes == null) return null;
  return scheduledMs + delayMinutes * 60 * 1000;
}

function buildStopPlatforms(stop) {
  const arr = {
    programmato: pickFirstString(stop, ['binarioProgrammatoArrivoDescrizione', 'binarioProgrammatoArrivoCodice']),
    reale: pickFirstString(stop, ['binarioEffettivoArrivoDescrizione', 'binarioEffettivoArrivoCodice']),
  };
  const dep = {
    programmato: pickFirstString(stop, ['binarioProgrammatoPartenzaDescrizione', 'binarioProgrammatoPartenzaCodice']),
    reale: pickFirstString(stop, ['binarioEffettivoPartenzaDescrizione', 'binarioEffettivoPartenzaCodice']),
  };
  return { arrivo: arr, partenza: dep };
}

const MIN_DWELL_TO_ASSUME_DEPARTURE_MS = 30 * 1000;

function getStopScheduledArrivalMs(stop) {
  if (!stop || isOriginStop(stop)) return null;
  return pickEpochMs(stop, [
    'arrivo_teorico',
    'arrivoTeorico',
    'arrivo_teorica',
    'arrivoTeorica',
    'arrivoProgrammato',
    'arrivoProgrammata',
    'programmata',
    'programmataZero',
  ]);
}

function getStopScheduledDepartureMs(stop) {
  if (!stop || isDestinationStop(stop)) return null;
  return pickEpochMs(stop, [
    'partenza_teorica',
    'partenzaTeorica',
    'partenzaProgrammato',
    'partenzaProgrammata',
    'programmata',
    'programmataZero',
  ]);
}

function getStopEffettivaMs(stop) {
  return stop ? pickEpochMs(stop, ['effettiva', 'effettivaZero', 'effettiva_zero']) : null;
}

function getStopExplicitRealArrivalMs(stop) {
  return stop
    ? pickEpochMs(stop, ['arrivoReale', 'arrivo_reale', 'arrivoEffettivo', 'arrivoEffettiva', 'arrivo_effettivo'])
    : null;
}

function getStopExplicitRealDepartureMs(stop) {
  return stop
    ? pickEpochMs(stop, [
        'partenzaReale',
        'partenza_reale',
        'partenzaEffettiva',
        'partenzaEffettivo',
        'partenzaEffettiva',
        'partenza_effettiva',
      ])
    : null;
}

function getStopRealTimes(stop, scheduled = null) {
  if (!stop) return { arrivoMs: null, partenzaMs: null };

  const isOrigin = isOriginStop(stop);
  const isDestination = isDestinationStop(stop);

  const schedArrivoMs = scheduled?.arrivoMs ?? getStopScheduledArrivalMs(stop);
  const schedPartenzaMs = scheduled?.partenzaMs ?? getStopScheduledDepartureMs(stop);

  const effettivaMs = getStopEffettivaMs(stop);

  let arrivoMs = isOrigin ? null : getStopExplicitRealArrivalMs(stop);
  let partenzaMs = isDestination ? null : getStopExplicitRealDepartureMs(stop);

  // Su VT "effettiva" non è univoca:
  // - origine: coincide con la partenza reale
  // - fermate intermedie: spesso coincide con la partenza reale (arrivoReale separato)
  // - destinazione: coincide con l'arrivo reale
  if (arrivoMs == null && !isOrigin) {
    if (isDestination) arrivoMs = effettivaMs;
  }

  if (partenzaMs == null && !isDestination) {
    if (isOrigin) {
      partenzaMs = effettivaMs;
    } else if (effettivaMs != null) {
      // Non usare "effettiva" come partenza se sembra essere l'arrivo (treno fermo in stazione).
      if (arrivoMs != null) {
        if (effettivaMs - arrivoMs >= MIN_DWELL_TO_ASSUME_DEPARTURE_MS) partenzaMs = effettivaMs;
      } else if (schedPartenzaMs != null) {
        // Fallback: se non abbiamo arrivoReale, considera "effettiva" come partenza solo se più vicina alla partenza teorica.
        const dDep = Math.abs(effettivaMs - schedPartenzaMs);
        const dArr = schedArrivoMs != null ? Math.abs(effettivaMs - schedArrivoMs) : Number.POSITIVE_INFINITY;
        if (dDep + MIN_DWELL_TO_ASSUME_DEPARTURE_MS <= dArr) partenzaMs = effettivaMs;
      }
    }
  }

  // Sanity: mai partenza < arrivo per la stessa fermata.
  if (arrivoMs != null && partenzaMs != null && partenzaMs < arrivoMs) partenzaMs = null;

  return { arrivoMs, partenzaMs };
}

function buildStopTimes(stop, globalDelay) {
  const isOrigin = isOriginStop(stop);
  const isDestination = isDestinationStop(stop);

  const delayArrivo = parseDelayMinutes(stop?.ritardoArrivo) ?? parseDelayMinutes(stop?.ritardo) ?? parseDelayMinutes(globalDelay);
  const delayPartenza =
    parseDelayMinutes(stop?.ritardoPartenza) ?? parseDelayMinutes(stop?.ritardo) ?? parseDelayMinutes(globalDelay);
  const globalDelayMin = parseDelayMinutes(globalDelay);

  const schedArrivoMs = getStopScheduledArrivalMs(stop);
  const schedPartenzaMs = getStopScheduledDepartureMs(stop);
  const { arrivoMs: realArrivoMs, partenzaMs: realPartenzaMs } = getStopRealTimes(stop, {
    arrivoMs: schedArrivoMs,
    partenzaMs: schedPartenzaMs,
  });

  const predictedArrivoMs = isOrigin
    ? null
    : pickEpochMs(stop, ['arrivoPrevisto', 'arrivoPrevista', 'arrivoProbabile']);
  const predictedPartenzaMs = isDestination
    ? null
    : pickEpochMs(stop, ['partenzaPrevisto', 'partenzaPrevista', 'partenzaProbabile']);

  const probableArrivoMs =
    realArrivoMs != null
      ? null
      : globalDelayMin != null
        ? computeProbableMs(schedArrivoMs, null, globalDelayMin)
        : predictedArrivoMs ?? computeProbableMs(schedArrivoMs, null, delayArrivo);
  const probablePartenzaMs =
    realPartenzaMs != null
      ? null
      : globalDelayMin != null
        ? computeProbableMs(schedPartenzaMs, null, globalDelayMin)
        : predictedPartenzaMs ?? computeProbableMs(schedPartenzaMs, null, delayPartenza);

  return {
    arrivo: {
      programmato: schedArrivoMs,
      reale: realArrivoMs,
      probabile: probableArrivoMs,
      deltaMinuti: delayArrivo,
      hhmm: {
        programmato: formatHHmmFromMs(schedArrivoMs),
        reale: formatHHmmFromMs(realArrivoMs),
        probabile: formatHHmmFromMs(probableArrivoMs),
      },
    },
    partenza: {
      programmato: schedPartenzaMs,
      reale: realPartenzaMs,
      probabile: probablePartenzaMs,
      deltaMinuti: delayPartenza,
      hhmm: {
        programmato: formatHHmmFromMs(schedPartenzaMs),
        reale: formatHHmmFromMs(realPartenzaMs),
        probabile: formatHHmmFromMs(probablePartenzaMs),
      },
    },
  };
}

// ============================================================================
// Helpers: stato treno / prossima fermata
// ============================================================================
function isSuppressedStop(stop) {
  const tipo = stop?.tipoFermata != null ? String(stop.tipoFermata).trim().toUpperCase() : '';
  const actualType = Number(stop?.actualFermataType);
  if (Number.isFinite(actualType) && actualType === 3) return true;
  return tipo === 'S' || stop?.soppresso === true;
}

function resolveStopServiceStatus(stop) {
  if (!stop) return { stato: null, codice: null };
  if (isSuppressedStop(stop)) {
    const code = Number.isFinite(Number(stop?.actualFermataType)) ? Number(stop.actualFermataType) : null;
    return { stato: 'soppressa', codice: code };
  }
  const actualType = Number(stop?.actualFermataType);
  if (Number.isFinite(actualType) && actualType === 2) return { stato: 'straordinaria', codice: actualType };
  if (Number.isFinite(actualType) && actualType === 1) return { stato: 'prevista', codice: actualType };
  return { stato: 'prevista', codice: Number.isFinite(actualType) ? actualType : null };
}

function isOriginStop(stop) {
  const tipo = stop?.tipoFermata != null ? String(stop.tipoFermata).trim().toUpperCase() : '';
  return tipo === 'P';
}

function isDestinationStop(stop) {
  const tipo = stop?.tipoFermata != null ? String(stop.tipoFermata).trim().toUpperCase() : '';
  return tipo === 'A';
}

function getOriginStopIndex(fermateRaw) {
  if (!Array.isArray(fermateRaw) || fermateRaw.length === 0) return null;
  const idx = fermateRaw.findIndex((s) => isOriginStop(s));
  return idx >= 0 ? idx : 0;
}

function getDestinationStopIndex(fermateRaw) {
  if (!Array.isArray(fermateRaw) || fermateRaw.length === 0) return null;
  for (let i = fermateRaw.length - 1; i >= 0; i -= 1) {
    if (isDestinationStop(fermateRaw[i])) return i;
  }
  return fermateRaw.length - 1;
}

function hasEffectiveDeparturePlatform(stop) {
  const eff = pickFirstString(stop, ['binarioEffettivoPartenzaDescrizione', 'binarioEffettivoPartenzaCodice', 'binarioEffettivoPartenza']);
  return !!(eff && String(eff).trim());
}

function hasEffectiveArrivalPlatform(stop) {
  const eff = pickFirstString(stop, ['binarioEffettivoArrivoDescrizione', 'binarioEffettivoArrivoCodice', 'binarioEffettivoArrivo']);
  return !!(eff && String(eff).trim());
}

function getLastRealStopIndex(fermateRaw) {
  if (!Array.isArray(fermateRaw) || fermateRaw.length === 0) return -1;
  for (let i = fermateRaw.length - 1; i >= 0; i -= 1) {
    const stop = fermateRaw[i];
    const sched = { arrivoMs: getStopScheduledArrivalMs(stop), partenzaMs: getStopScheduledDepartureMs(stop) };
    const { arrivoMs: realArrivoMs, partenzaMs: realPartenzaMs } = getStopRealTimes(stop, sched);
    if (realArrivoMs != null || realPartenzaMs != null) return i;
  }
  return -1;
}

function isTrainVaried(snapshot, fermateRaw, rfiServiceState = null) {
  const serviceState = rfiServiceState ?? deriveRfiServiceStatus(snapshot)?.stato ?? null;
  if (serviceState === 'deviato' || serviceState === 'parzialmente_soppresso') return true;

  const provvedimento = snapshot?.provvedimento != null ? Number(snapshot.provvedimento) : null;
  if (Number.isFinite(provvedimento) && provvedimento !== 0) return true;

  const riprogrammazione = snapshot?.riprogrammazione != null ? String(snapshot.riprogrammazione).trim().toUpperCase() : '';
  if (riprogrammazione && riprogrammazione !== 'N') return true;

  if (Array.isArray(fermateRaw) && fermateRaw.some(isSuppressedStop)) return true;
  return false;
}

function hasPartialSuppression(fermateRaw) {
  if (!Array.isArray(fermateRaw) || fermateRaw.length === 0) return false;
  let suppressed = 0;
  let active = 0;
  for (const stop of fermateRaw) {
    if (isSuppressedStop(stop)) suppressed += 1;
    else active += 1;
  }
  return suppressed > 0 && active > 0;
}

function hasOnlySuppressedStops(fermateRaw) {
  if (!Array.isArray(fermateRaw) || fermateRaw.length === 0) return false;
  let suppressed = 0;
  let active = 0;
  for (const stop of fermateRaw) {
    if (isSuppressedStop(stop)) suppressed += 1;
    else active += 1;
  }
  return suppressed > 0 && active === 0;
}

function flattenToStrings(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(flattenToStrings);
  if (typeof value === 'string') return [value];
  if (typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  return [];
}

// RFI: tipoTreno + provvedimento codificano la regolarita' del servizio.
const RFI_TIPO_TRENO_STATUS = {
  regolare: new Set(['PG']),
  soppresso: new Set(['ST']),
  parzialmenteSoppresso: new Set(['PP', 'SI', 'SF', 'SM']),
  deviato: new Set(['DV', 'VD', 'VO']),
};

function normalizeRfiTipoTreno(value) {
  const s = String(value || '').trim().toUpperCase();
  return s ? s : null;
}

function normalizeRfiProvvedimento(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function flattenToTokens(value) {
  if (value == null) return [];
  if (Array.isArray(value)) return value.flatMap(flattenToTokens);
  if (typeof value === 'object') return Object.values(value).flatMap(flattenToTokens);
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return [String(value)];
  return [];
}

function extractRfiProvvedimentiInfo(snapshot) {
  const tokens = new Set();
  const numbers = new Set();

  const addToken = (raw) => {
    const s = String(raw).trim();
    if (!s) return;
    tokens.add(s.toUpperCase());
    const n = Number(raw);
    if (Number.isFinite(n)) numbers.add(n);
  };

  const walk = (value) => {
    if (value == null) return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (typeof value === 'object') {
      Object.values(value).forEach(walk);
      return;
    }
    addToken(value);
  };

  walk(snapshot?.provvedimenti);
  if (snapshot?.provvedimento != null) addToken(snapshot.provvedimento);

  return { tokens, numbers };
}

function deriveRfiServiceStatus(snapshot) {
  if (!snapshot) return { stato: null, tipoTreno: null, provvedimento: null };

  const tipoTrenoRaw = normalizeRfiTipoTreno(snapshot?.tipoTreno);
  const provvedimento = normalizeRfiProvvedimento(snapshot?.provvedimento);
  const { tokens, numbers } = extractRfiProvvedimentiInfo(snapshot);

  const allCodes = [
    ...RFI_TIPO_TRENO_STATUS.regolare,
    ...RFI_TIPO_TRENO_STATUS.soppresso,
    ...RFI_TIPO_TRENO_STATUS.parzialmenteSoppresso,
    ...RFI_TIPO_TRENO_STATUS.deviato,
  ];
  const tipoFromTokens = allCodes.find((code) => tokens.has(code)) || null;
  const tipoTreno = tipoTrenoRaw || tipoFromTokens;

  const provMatches = (allowed) => {
    if (provvedimento != null) return allowed.includes(provvedimento);
    if (numbers.size) return allowed.some((n) => numbers.has(n));
    return true;
  };

  if (tipoTreno && RFI_TIPO_TRENO_STATUS.soppresso.has(tipoTreno) && provMatches([1])) {
    return { stato: 'soppresso', tipoTreno, provvedimento };
  }
  if (tipoTreno && RFI_TIPO_TRENO_STATUS.parzialmenteSoppresso.has(tipoTreno) && provMatches([0, 2])) {
    return { stato: 'parzialmente_soppresso', tipoTreno, provvedimento };
  }
  if (tipoTreno && RFI_TIPO_TRENO_STATUS.deviato.has(tipoTreno) && provMatches([3])) {
    return { stato: 'deviato', tipoTreno, provvedimento };
  }
  if (tipoTreno && RFI_TIPO_TRENO_STATUS.regolare.has(tipoTreno) && provMatches([0])) {
    return { stato: 'regolare', tipoTreno, provvedimento };
  }

  const tokenText = Array.from(tokens).join(' ');
  if (/\b(SOPPRESS|SOPPRES|CANCELL|ANNULL)\b/.test(tokenText)) {
    return { stato: 'soppresso', tipoTreno, provvedimento };
  }
  if (/\b(DEVIA|DEVIAZIONE|VARIAZIONE\s+ORIGINE|VARIAZIONE\s+DESTINAZIONE|DEV)\b/.test(tokenText)) {
    return { stato: 'deviato', tipoTreno, provvedimento };
  }
  if (/\b(REGOL|REGOLARE|PROGRAMM)\b/.test(tokenText)) {
    return { stato: 'regolare', tipoTreno, provvedimento };
  }

  return { stato: null, tipoTreno, provvedimento };
}

function looksLikeSuppressedTrain(snapshot) {
  if (!snapshot) return false;

  if (snapshot?.soppresso === true) return true;
  if (snapshot?.circolante === false) return true;
  if (snapshot?.cancellato === true || snapshot?.cancellata === true) return true;

  const hay = [
    snapshot?.subTitle,
    snapshot?.statoTreno,
    snapshot?.descrizioneVCO,
    snapshot?.motivoRitardoPrevalente,
    snapshot?.compClassRitardoTxt,
    snapshot?.compRitardo,
    snapshot?.compRitardoAndamento,
  ]
    .flatMap(flattenToStrings)
    .join(' ')
    .toLowerCase()
    .replace(/&[a-z]+;/g, ' ');

  if (!hay.trim()) return false;
  return (
    hay.includes('cancellat') ||
    hay.includes('soppress') ||
    hay.includes('soppres') ||
    hay.includes('annull') ||
    hay.includes('canceled') ||
    hay.includes('cancelled') ||
    hay.includes('cancelado') ||
    hay.includes('storniert') ||
    hay.includes('annul')
  );
}

function resolveTrainStatus(snapshot) {
  if (!snapshot) return null;

  const fermateRaw = Array.isArray(snapshot.fermate) ? snapshot.fermate : [];
  const rfiService = deriveRfiServiceStatus(snapshot);
  const rfiServiceState = rfiService?.stato ?? null;
  const partialSuppression = hasPartialSuppression(fermateRaw);
  const fullySuppressed = hasOnlySuppressedStops(fermateRaw);

  const isSuppressed =
    (rfiServiceState === 'soppresso' || looksLikeSuppressedTrain(snapshot) || fullySuppressed) && !partialSuppression;
  if (isSuppressed) return 'soppresso';

  const last = fermateRaw.length ? fermateRaw[fermateRaw.length - 1] : null;
  const lastRealArrivalMs = last ? getStopRealTimes(last).arrivoMs : null;
  const isConcluded = snapshot?.arrivato === true || lastRealArrivalMs != null;
  if (isConcluded) return 'concluso';

  const hasAnyRealStop = getLastRealStopIndex(fermateRaw) >= 0;
  // Non considerare "iniziato" solo perché esiste un rilevamento: per l'app, finché non parte davvero resta "pianificato".
  const hasStarted = hasAnyRealStop || snapshot?.nonPartito === false;
  const varied = isTrainVaried(snapshot, fermateRaw, rfiServiceState);

  if (!hasStarted) {
    const originIdx = getOriginStopIndex(fermateRaw);
    const originStop = originIdx != null ? fermateRaw[originIdx] : null;
    const readyAtOrigin = !!(originStop && hasEffectiveDeparturePlatform(originStop));
    // Se arriva il binario effettivo alla prima fermata (origine), per l'app significa treno in stazione.
    if (readyAtOrigin || snapshot?.inStazione === true) return 'in stazione';
    return varied ? 'variato' : 'programmato';
  }

  const lastRealIdx = getLastRealStopIndex(fermateRaw);
  const lastRealStop = lastRealIdx >= 0 ? fermateRaw[lastRealIdx] : null;
  const lastRealTimes = lastRealStop ? getStopRealTimes(lastRealStop) : { arrivoMs: null, partenzaMs: null };
  const derivedInStation =
    lastRealStop && !isDestinationStop(lastRealStop) && lastRealTimes.arrivoMs != null && lastRealTimes.partenzaMs == null;

  if (snapshot?.inStazione === true || derivedInStation) return 'in stazione';
  return varied ? 'variato' : 'in viaggio';
}

function computeNextStopIndex(snapshot, fermateRaw) {
  if (!snapshot || !Array.isArray(fermateRaw) || fermateRaw.length === 0) return null;
  const stato = resolveTrainStatus(snapshot);
  if (stato === 'soppresso' || stato === 'concluso') return null;

  const lastRealIdx = getLastRealStopIndex(fermateRaw);
  const startIdx = lastRealIdx >= 0 ? lastRealIdx + 1 : 0;
  for (let i = startIdx; i < fermateRaw.length; i += 1) {
    // Se non ha ancora eventi reali, la "prossima fermata" non può essere la stazione di origine.
    if (lastRealIdx < 0 && isOriginStop(fermateRaw[i])) continue;
    if (!isSuppressedStop(fermateRaw[i])) return i;
  }
  return null;
}

function buildNextStopSummary(nextStop, index, globalDelay) {
  if (!nextStop || index == null) return null;
  const stazione = stationNameById(nextStop?.id) || stationPublicNameFromIdOrName(nextStop?.stazione) || null;
  const schedArrivalMs = pickEpochMs(nextStop, [
    'arrivo_teorico',
    'arrivoTeorica',
    'programmata',
    'programmataZero',
    'orarioArrivo',
    'arrivo',
  ]);
  const delay = parseDelayMinutes(globalDelay);
  const arrivoPrevistoMs = schedArrivalMs != null && delay != null ? schedArrivalMs + delay * 60 * 1000 : null;
  return {
    indice: index,
    stazione,
    arrivoPrevisto: formatHHmmFromMs(arrivoPrevistoMs),
  };
}

function buildPreviousStopSummary(prevStop, index) {
  if (!prevStop || index == null) return null;
  const stazione = stationNameById(prevStop?.id) || stationPublicNameFromIdOrName(prevStop?.stazione) || null;
  const sched = { arrivoMs: getStopScheduledArrivalMs(prevStop), partenzaMs: getStopScheduledDepartureMs(prevStop) };
  const { arrivoMs: realArrivoMs, partenzaMs: realPartenzaMs } = getStopRealTimes(prevStop, sched);
  return {
    indice: index,
    stazione,
    arrivoReale: formatHHmmFromMs(realArrivoMs),
    partenzaReale: formatHHmmFromMs(realPartenzaMs),
  };
}

// ============================================================================
// API: ViaggiaTreno (RFI)
// ============================================================================

// Autocomplete stazioni
app.get('/api/viaggiatreno/autocomplete', rateLimitStandard, async (req, res) => {
  const query = (req.query.query || '').trim();
  if (query.length < 2) return res.json({ ok: true, data: [] });

  try {
    const text = await fetchText(`${VT_BASE_URL}/autocompletaStazione/${encodeURIComponent(query)}`);
    const data = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [nomeUpstream, codice] = line.split('|');
        return stationNameById((codice || '').trim()) || String(nomeUpstream || '').trim() || null;
      })
      .filter(Boolean);
    setCacheHeaders(res, CACHE_TTL_MS);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: normalizeErrorMessage(err) });
  }
});

function buildStationAutocompleteMatches(query, limit, options = {}) {
  const qKey = normalizeStationNameKey(query);
  if (!qKey) return [];
  const onlyWithLefrecceId = options.onlyWithLefrecceId === true;
  const qTokens = qKey.split(' ').filter(Boolean);
  const scored = [];
  const directId = stationIdByKey.get(qKey);
  const directStation = directId ? stationsById.get(directId) : null;
  const directName = directStation?.name ? String(directStation.name) : null;

  if (directStation?.name) {
    scored.push({ name: directName, score: 200, station: directStation });
  }

  if (qTokens.length >= 1) {
    const cityKey = qTokens[0];
    const multistation = stationList.find((s) => {
      if (!s?.name) return false;
      if (!/\(tutte le stazioni\)/i.test(s.name)) return false;
      const sKey = normalizeStationNameKey(s.name);
      return sKey.startsWith(`${cityKey} tutte le stazioni`);
    });
    if (multistation && (!directStation || multistation.id !== directStation.id)) {
      scored.push({ name: String(multistation.name), score: 160, station: multistation });
    }
  }

  for (const s of stationList) {
    if (!s?.name) continue;
    if (directStation && s.id === directStation.id) continue;
    if (onlyWithLefrecceId && !Number.isFinite(s.lefrecceId)) continue;
    const sKey = normalizeStationNameKey(s.name);
    if (!sKey) continue;

    if (qKey.length < 4 && !sKey.startsWith(qKey)) {
      continue;
    }

    let score = 0;
    if (sKey === qKey) score += 100;
    else if (sKey.startsWith(qKey)) score += 80;
    else if (sKey.includes(qKey)) score += 60;

    let hits = 0;
    let tokenScore = 0;
    const sTokens = sKey.split(' ').filter(Boolean);
    const sTokenSet = new Set(sTokens);
    for (const t of qTokens) {
      if (!t) continue;
      if (sTokenSet.has(t)) {
        hits += 1;
        tokenScore += 12;
        continue;
      }
      if (sTokens.some((sTok) => sTok.startsWith(t))) {
        hits += 1;
        tokenScore += 8;
      }
    }
    if (qTokens.length >= 2 && !sKey.includes(qKey) && hits < Math.min(2, qTokens.length)) {
      continue;
    }
    if (hits > 0) score += tokenScore;

    if (qTokens.length > 1) {
      const ordered = qTokens.every((t, idx) => sTokens.indexOf(t) >= (idx === 0 ? 0 : sTokens.indexOf(qTokens[idx - 1])));
      if (ordered && sTokens.join(' ').includes(qTokens.join(' '))) score += 12;
      else if (ordered) score += 6;
    }

    const lengthPenalty = Math.max(0, sTokens.length - qTokens.length);
    score -= Math.min(10, lengthPenalty);

    if (/\(tutte le stazioni\)/i.test(s.name) && sKey.startsWith(qKey)) {
      score += 6;
    }

    if (score > 0) scored.push({ name: String(s.name), score, station: s });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'it'));

  const matches = [];
  const seen = new Set();
  for (const item of scored) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    matches.push(item);
    if (matches.length >= limit) break;
  }

  return matches;
}

// Autocomplete stazioni (locale: usa stazioni.json, senza chiamate esterne)
app.get('/api/stations/autocomplete', rateLimitStandard, (req, res) => {
  const query = (req.query.query || '').trim();
  const limitRaw = req.query.limit;
  const limit = Number.isFinite(Number(limitRaw)) ? Math.max(1, Math.min(50, Number(limitRaw))) : 10;
  const includeIds = parseBool(req.query.includeIds, false);
  if (query.length < 2) return res.json({ ok: true, data: [] });

  const matches = buildStationAutocompleteMatches(query, limit);
  const data = includeIds
    ? matches.map((item) => ({
        name: item.name,
        stationCode: item.station?.id || null,
        lefrecceId: Number.isFinite(item.station?.lefrecceId) ? item.station.lefrecceId : null,
        italoCode: item.station?.italoCode || null,
      }))
    : matches.map((item) => item.name);

  setCacheHeaders(res, CACHE_TTL_MS);
  res.json({ ok: true, data });
});

// Info stazione (flatten + meteo)
app.get('/api/stations/info', rateLimitStandard, async (req, res) => {
  const stationCode = resolveStationCodeOrNull(req.query.stationCode, req.query.stationName || req.query.name);
  if (!stationCode) return res.status(400).json({ ok: false, error: 'stationCode o stationName obbligatorio' });

  try {
    const regionId = await fetchRegionId(stationCode);
    const detail = await fetchStationDetail(stationCode, regionId);

    res.json({
      ok: true,
      stazione: stationNameById(stationCode),
      latitudine: detail && detail.lat != null ? detail.lat : null,
      longitudine: detail && detail.lon != null ? detail.lon : null,
      regione: String(regionId || '').trim() || null,
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: normalizeErrorMessage(err) });
  }
});

// Partenze (enriched)
app.get('/api/stations/departures', rateLimitStandard, async (req, res) => {
  const stationCode = resolveStationCodeOrNull(req.query.stationCode, req.query.stationName || req.query.name);
  const when = (req.query.when || 'now').trim();
  const whenKey = when.toLowerCase() === 'now' ? 'now' : when;
  const raw = ENABLE_RAW_UPSTREAM && parseBool(req.query.raw, false);

  if (!stationCode) return res.status(400).json({ ok: false, error: 'stationCode o stationName obbligatorio' });

  try {
    const whenMs = parseWhenToMs(when);
    const dateStr = encodeDateString(when);
    const upstream = await cacheGetOrSet(`vt:dep:${stationCode}:${whenKey}`, STATION_DEPARTURES_TTL_MS, () =>
      fetchJson(`${VT_BASE_URL}/partenze/${encodeURIComponent(stationCode)}/${dateStr}`)
    );
    const list = Array.isArray(upstream) ? upstream : [];

    let italoTreni = [];
    const italoCode = italoCodeByStationIdOrNull(stationCode);
    const stationName = stationNameById(stationCode);
    if (italoCode && shouldUseItaloNow(when)) {
      try {
        const italoBoard = await cacheGetOrSet(`italo:board:${italoCode}`, ITALO_BOARD_TTL_MS, () =>
          fetchItaloStationBoard(italoCode)
        );
        const italoList = Array.isArray(italoBoard?.ListaTreniPartenza) ? italoBoard.ListaTreniPartenza : [];
        italoTreni = italoList.map((entry) => mapItaloDepartureEntry(entry, stationName, whenMs));
      } catch {
        italoTreni = [];
      }
    }

    const treni = mergeTrainEntries(list.map(mapDepartureEntry), italoTreni, 'orarioPartenza');

    const payload = {
      ok: true,
      stazione: stationName,
      data: toIsoOrNow(when),
      treni,
    };
    if (raw) payload.raw = list;
    setCacheHeaders(res, STATION_DEPARTURES_TTL_MS);
    res.json(payload);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: normalizeErrorMessage(err) });
  }
});

// Arrivi (enriched)
app.get('/api/stations/arrivals', rateLimitStandard, async (req, res) => {
  const stationCode = resolveStationCodeOrNull(req.query.stationCode, req.query.stationName || req.query.name);
  const when = (req.query.when || 'now').trim();
  const whenKey = when.toLowerCase() === 'now' ? 'now' : when;
  const raw = ENABLE_RAW_UPSTREAM && parseBool(req.query.raw, false);

  if (!stationCode) return res.status(400).json({ ok: false, error: 'stationCode o stationName obbligatorio' });

  try {
    const whenMs = parseWhenToMs(when);
    const dateStr = encodeDateString(when);
    const upstream = await cacheGetOrSet(`vt:arr:${stationCode}:${whenKey}`, STATION_ARRIVALS_TTL_MS, () =>
      fetchJson(`${VT_BASE_URL}/arrivi/${encodeURIComponent(stationCode)}/${dateStr}`)
    );
    const list = Array.isArray(upstream) ? upstream : [];

    let italoTreni = [];
    const italoCode = italoCodeByStationIdOrNull(stationCode);
    const stationName = stationNameById(stationCode);
    if (italoCode && shouldUseItaloNow(when)) {
      try {
        const italoBoard = await cacheGetOrSet(`italo:board:${italoCode}`, ITALO_BOARD_TTL_MS, () =>
          fetchItaloStationBoard(italoCode)
        );
        const italoList = Array.isArray(italoBoard?.ListaTreniArrivo) ? italoBoard.ListaTreniArrivo : [];
        italoTreni = italoList.map((entry) => mapItaloArrivalEntry(entry, stationName, whenMs));
      } catch {
        italoTreni = [];
      }
    }

    const treni = mergeTrainEntries(list.map(mapArrivalEntry), italoTreni, 'orarioArrivo');

    const payload = {
      ok: true,
      stazione: stationName,
      data: toIsoOrNow(when),
      treni,
    };
    if (raw) payload.raw = list;
    setCacheHeaders(res, STATION_ARRIVALS_TTL_MS);
    res.json(payload);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: normalizeErrorMessage(err) });
  }
});

function buildItaloModelPayload(italo, trainNumber) {
  if (!italo || italo.IsEmpty || !italo.TrainSchedule) return null;

  const schedule = italo.TrainSchedule;
  const referenceMs = Date.now();
  const globalDelay = schedule?.Distruption?.DelayAmount;
  const runningState = schedule?.Distruption?.RunningState;
  const statoTrenoRaw = mapItaloRunningState(runningState);

  const fermate = buildItaloStops(schedule, referenceMs);
  const firstStop = fermate[0] || null;
  const lastStop = fermate[fermate.length - 1] || null;

  const firstSchedDepartureMs =
    parseItaloTimeMs(schedule?.DepartureDate, referenceMs) ??
    firstStop?.orari?.partenza?.programmato ??
    null;
  const lastSchedArrivalMs =
    alignItaloTimeMs(
      schedule?.ArrivalDate,
      firstSchedDepartureMs ?? referenceMs,
      firstSchedDepartureMs ?? referenceMs
    ) ??
    lastStop?.orari?.arrivo?.programmato ??
    null;

  const firstRealDepartureMs = firstStop?.orari?.partenza?.reale ?? null;
  const lastRealArrivalMs = lastStop?.orari?.arrivo?.reale ?? null;
  const firstDepartureMs =
    firstStop?.orari?.partenza?.reale ??
    firstStop?.orari?.partenza?.probabile ??
    firstStop?.orari?.partenza?.programmato ??
    firstSchedDepartureMs ??
    null;
  const lastArrivalMs =
    lastStop?.orari?.arrivo?.reale ??
    lastStop?.orari?.arrivo?.probabile ??
    lastStop?.orari?.arrivo?.programmato ??
    lastSchedArrivalMs ??
    null;

  const { previousIdx, nextIdx, currentIdx } = computeItaloStopIndexes(fermate, referenceMs);
  const statoTreno = deriveItaloRunningState({
    rawState: statoTrenoRaw,
    referenceMs,
    firstDepartureMs,
    lastArrivalMs,
    currentIdx,
    fermate,
  });
  const precedenteFermata = previousIdx != null ? buildItaloPreviousStopSummary(fermate[previousIdx], previousIdx) : null;
  const prossimaFermata = (() => {
    if (nextIdx == null || statoTreno === 'concluso') return null;
    const next = buildItaloNextStopSummary(fermate[nextIdx], nextIdx);
    if (!next) return null;
    return { ...next, precedente: precedenteFermata };
  })();
  const stazioneCorrente =
    statoTreno === 'in stazione' ? fermate[currentIdx]?.stazione ?? precedenteFermata?.stazione ?? null : null;

  const principali = {
    numeroTreno: String(schedule?.TrainNumber || trainNumber),
    tipoTreno: { ...trainTypeInfoFromCode('ITA'), compagnia: 'NTV' },
    tratta: {
      origine:
        firstStop?.stazione ||
        italoStationNameFromCodeOrName(
          schedule?.DepartureStationCode || schedule?.DepartureStationId,
          schedule?.DepartureStationDescription
        ) ||
        null,
      destinazione:
        lastStop?.stazione ||
        italoStationNameFromCodeOrName(
          schedule?.ArrivalStationCode || schedule?.ArrivalStationId,
          schedule?.ArrivalStationDescription
        ) ||
        null,
    },
    stato: statoTreno,
    isSoppresso: false,
    isVariato: false,
    inStazione: statoTreno === 'in stazione',
    stazioneCorrente,
    prossimaFermata,
    orari: {
      partenza: {
        programmato: formatHHmmFromMs(firstSchedDepartureMs),
        reale: formatHHmmFromMs(firstRealDepartureMs),
        probabile: null,
      },
      arrivo: {
        programmato: formatHHmmFromMs(lastSchedArrivalMs),
        reale: formatHHmmFromMs(lastRealArrivalMs),
        probabile: null,
      },
    },
    ritardoMinuti: parseDelayMinutes(globalDelay),
    ultimoRilevamento: italo?.LastUpdate
      ? {
          timestamp: null,
          orario: String(italo.LastUpdate).trim(),
          luogo: null,
          testo: String(italo.LastUpdate).trim(),
        }
      : null,
    fermate,
  };

  return buildModelResponse({
    dataRiferimento: formatDateItalianFromMs(referenceMs),
    dateDisponibili: [],
    compagnia: 'ntv',
    numeroTreno: principali.numeroTreno,
    tipoTreno: principali.tipoTreno,
    tratta: principali.tratta,
    orari: principali.orari,
    statoTreno: {
      deltaTempo: principali.ritardoMinuti ?? null,
      stato: formatTrainStatusLabel(principali.stato),
      stazioneCorrente:
        principali.stato === 'in stazione'
          ? stazioneCorrente ?? null
          : principali.stato === 'concluso'
            ? lastStop?.stazione ?? null
            : null,
      stazioneSuccessiva: principali.stato === 'concluso' ? null : prossimaFermata?.stazione ?? null,
      stazionePrecedente: principali.stato === 'concluso' ? null : precedenteFermata?.stazione ?? null,
      infoIR: italo?.LastUpdate
        ? {
            ultimoRilevOra: String(italo.LastUpdate).trim(),
            ultimoRilevLuogo: null,
            messaggioUltimoRilev: String(italo.LastUpdate).trim(),
          }
        : null,
      messaggiRfi: null,
    },
    fermate,
  });
}

function isItaloPayloadCompleted(payload) {
  const state = payload?.statoTreno?.stato;
  return typeof state === 'string' && state.trim().toLowerCase() === 'concluso';
}

async function resolveItaloPayloadCached(trainNumber) {
  const liveKey = `italo:live:${trainNumber}`;
  const lastKey = `italo:last:${trainNumber}`;
  const cachedLive = cacheGet(liveKey);
  if (cachedLive) return { entry: cachedLive, stale: false };

  return withSingleFlight(liveKey, async () => {
    const cachedAgain = cacheGet(liveKey);
    if (cachedAgain) return { entry: cachedAgain, stale: false };

    try {
      const raw = await fetchItaloTrainStatus(trainNumber);
      const payload = buildItaloModelPayload(raw, trainNumber);
      if (payload) {
        const entry = { payload, raw, cachedAt: Date.now() };
        const liveTtl = isItaloPayloadCompleted(payload) ? ITALO_LAST_KNOWN_TTL_MS : ITALO_STATUS_TTL_MS;
        cacheSet(liveKey, entry, liveTtl);
        cacheSet(lastKey, entry, ITALO_LAST_KNOWN_TTL_MS);
        return { entry, stale: false };
      }
    } catch (err) {
      const last = cacheGet(lastKey);
      if (last) {
        const liveTtl = isItaloPayloadCompleted(last.payload) ? ITALO_LAST_KNOWN_TTL_MS : ITALO_STATUS_TTL_MS;
        cacheSet(liveKey, last, liveTtl);
        return { entry: last, stale: true };
      }
      throw err;
    }

    const last = cacheGet(lastKey);
    if (last) {
      const liveTtl = isItaloPayloadCompleted(last.payload) ? ITALO_LAST_KNOWN_TTL_MS : ITALO_STATUS_TTL_MS;
      cacheSet(liveKey, last, liveTtl);
      return { entry: last, stale: true };
    }
    const negativeEntry = { payload: null, raw: null, cachedAt: Date.now() };
    cacheSet(liveKey, negativeEntry, ITALO_STATUS_TTL_MS);
    return { entry: negativeEntry, stale: false };
  });
}

// Stato treno (raw + campi principali)
async function handleItaloTrainStatus(req, res) {
  const trainNumber = (req.query.numeroTreno || req.query.trainNumber || '').trim();
  const raw = ENABLE_RAW_UPSTREAM && parseBool(req.query.raw, false);

  if (!trainNumber) return res.status(400).json({ ok: false, error: 'numeroTreno obbligatorio' });

  try {
    const { entry } = await resolveItaloPayloadCached(trainNumber);
    const payload = entry?.payload ? { ...entry.payload } : null;
    if (!payload) {
      return res.json({ ok: true, data: null, message: 'Nessun treno Italo trovato per questo numero' });
    }
    if (raw && entry?.raw) payload.raw = entry.raw;
    setCacheHeaders(res, TRAIN_STATUS_TTL_MS);
    res.json(payload);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: normalizeErrorMessage(err) });
  }
}

app.get('/api/italo/trains/status', rateLimitHeavy, handleItaloTrainStatus);

const handleTrainStatus = async (req, res) => {
  const trainNumber = (req.query.numeroTreno || req.query.trainNumber || '').trim();
  const originCodeHint = (req.query.codiceOrigine || req.query.originCode || '').trim().toUpperCase();
  const originNameHint = (req.query.originName || '').trim();
  const serviceDateHint = (req.query.data || req.query.date || req.query.serviceDate || '').trim();
  const technicalHint = (req.query.technical || req.query.id || '').trim();
  const choiceHintRaw = req.query.choice;
  const choiceHint = choiceHintRaw != null && choiceHintRaw !== '' ? Number(choiceHintRaw) : null;
  const epochMsHintRaw = req.query.timestampRiferimento ?? req.query.epochMs ?? null;
  const epochMsHintExplicit = epochMsHintRaw != null ? Number(epochMsHintRaw) : null;
  const epochMsHintFromDate = serviceDateHint ? parseIsoDateToLocalMidnightMs(serviceDateHint) : null;
  let epochMsHint =
    Number.isFinite(epochMsHintExplicit) ? epochMsHintExplicit : Number.isFinite(epochMsHintFromDate) ? epochMsHintFromDate : null;
  const debug = ENABLE_DEBUG_RAW && parseBool(req.query.debug, false);
  const responseCacheKey = buildTrainStatusCacheKey({
    trainNumber,
    originCodeHint,
    originNameHint,
    serviceDateHint,
    technicalHint,
    choiceHint,
    epochMsHint,
    debug,
  });
  const cachedResponse = cacheGet(responseCacheKey);

  if (!trainNumber) return res.status(400).json({ ok: false, error: 'numeroTreno obbligatorio' });
  if (cachedResponse) {
    setCacheHeaders(res, TRAIN_STATUS_TTL_MS);
    return res.json(cachedResponse);
  }

  try {
    function sendCached(payload) {
      if (payload && payload.ok) {
        cacheSet(responseCacheKey, payload, TRAIN_STATUS_TTL_MS);
        setCacheHeaders(res, TRAIN_STATUS_TTL_MS);
      }
      res.json(payload);
    }

    const italoPromise = resolveItaloPayloadCached(trainNumber)
      .then(({ entry }) => entry?.payload ?? null)
      .catch(() => null);
    const italoSoftPromise = promiseWithTimeout(italoPromise, ITALO_SOFT_TIMEOUT_MS);

    function parseEpochFromDisplay(displayStr) {
      const s = String(displayStr || '').trim();
      if (!s) return null;

      // Cerca data italiana: dd/mm[/yyyy] (a volte senza anno)
      const dm = s.match(/\b(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?\b/);
      if (!dm) return null;

      const day = Number(dm[1]);
      const month = Number(dm[2]);
      let year = dm[3] ? Number(dm[3]) : new Date().getFullYear();
      if (year < 100) year += 2000;
      if (!day || !month || !year) return null;

      // Ora HH:mm se presente; altrimenti mezzogiorno (più robusto di 00:00)
      const tm = s.match(/\b(\d{1,2}):(\d{2})\b/);
      const hour = tm ? Number(tm[1]) : 12;
      const minute = tm ? Number(tm[2]) : 0;

      const d = new Date(year, month - 1, day, hour, minute, 0, 0);
      const ms = d.getTime();
      return Number.isNaN(ms) ? null : ms;
    }

    function buildDateDisponibiliFromEpochs(epochList) {
      const map = new Map();
      for (const ms of epochList) {
        const dayStart = toLocalDayStartMs(ms);
        if (!Number.isFinite(dayStart)) continue;
        if (map.has(dayStart)) continue;
        map.set(dayStart, { data: formatYYYYMMDDFromMs(dayStart), timestamp: dayStart });
      }
      return Array.from(map.values()).sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
    }

    function buildDateSuggeriteFromBase(baseMs) {
      const baseDay = toLocalDayStartMs(baseMs);
      const prevDay = addDaysFromLocalDayStartMs(baseDay, -1);
      return buildDateDisponibiliFromEpochs([baseDay, prevDay]);
    }

    const searchKey = `vt:search:${trainNumber}`;
    const textSearch = await cacheGetOrSet(searchKey, TRAIN_SEARCH_TTL_MS, () =>
      fetchText(`${VT_BASE_URL}/cercaNumeroTrenoTrenoAutocomplete/${encodeURIComponent(trainNumber)}`)
    );
    let italoPayload = null;
    let italoFound = false;
    const lines = textSearch
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (!lines.length) {
      italoPayload = await italoPromise;
      italoFound = !!italoPayload;
      if (italoPayload) {
        return sendCached(attachCorrispondenza(italoPayload, false, true));
      }
      return sendCached(
        attachCorrispondenza({ ok: true, data: null, message: 'Nessun treno trovato per questo numero' }, false, false)
      );
    }

    {
      const soft = await italoSoftPromise;
      italoPayload = soft.timedOut ? null : soft.value;
      italoFound = !!italoPayload;
    }

    const candidates = lines
      .map((rawLine) => {
        const parts = String(rawLine).split('|');
        const display = (parts[0] || '').trim();
        const technical = (parts[1] || '').trim(); // es: "9544-S09818-1768172400000"
        const techParts = technical.split('-');
        const numFromTechnical = (techParts[0] || trainNumber).trim();
        const originCode = (techParts[1] || '').trim().toUpperCase();
        const epochMsFromTechnical = techParts[2] ? parseEpochMsOrSeconds(techParts[2]) : null;
        const epochMsFromDisplay = parseEpochFromDisplay(display);
        const epochMs = epochMsFromTechnical ?? epochMsFromDisplay ?? null;
        return {
          rawLine,
          display,
          technical,
          trainNumber: numFromTechnical,
          originCode,
          epochMs,
          data: epochMs != null ? formatYYYYMMDDFromMs(epochMs) : null,
        };
      })
      .filter((c) => c.originCode)
      .filter((c, idx, arr) => {
        const key = c.technical || `${c.trainNumber}-${c.originCode}-${c.epochMs ?? ''}`;
        return arr.findIndex((x) => (x.technical || `${x.trainNumber}-${x.originCode}-${x.epochMs ?? ''}`) === key) === idx;
      });

    const originCodeFromName = originNameHint ? resolveStationIdByName(originNameHint) : null;
    function pickClosestByEpoch(cList, targetEpochMs) {
      if (!Number.isFinite(targetEpochMs)) return null;
      const withEpoch = cList.filter((c) => Number.isFinite(c.epochMs));
      if (!withEpoch.length) return null;
      withEpoch.sort((a, b) => Math.abs(a.epochMs - targetEpochMs) - Math.abs(b.epochMs - targetEpochMs));
      return Math.abs(withEpoch[0].epochMs - targetEpochMs) <= 36 * 60 * 60 * 1000 ? withEpoch[0] : null;
    }

    const candidatesByOrigin = new Map();
    for (const c of candidates) {
      if (!candidatesByOrigin.has(c.originCode)) candidatesByOrigin.set(c.originCode, []);
      candidatesByOrigin.get(c.originCode).push(c);
    }

    const originGroups = Array.from(candidatesByOrigin.entries()).map(([originCode, list]) => {
      const bestByEpoch = list
        .slice()
        .sort((a, b) => (Number(b.epochMs) || 0) - (Number(a.epochMs) || 0))[0];
      return {
        originCode,
        candidates: list,
        best: bestByEpoch || list[0] || null,
      };
    });

    const hasUniqueOrigin = originGroups.length === 1;
    const uniqueOriginGroup = hasUniqueOrigin ? originGroups[0] : null;

    function serializeOriginChoice(group, idx) {
      return { choice: idx, origine: stationNameById(group.originCode) };
    }

    function serializeDateChoice(dateItem, idx) {
      return { choice: idx, data: dateItem.data, timestampRiferimento: dateItem.timestamp };
    }

    function buildDateDisponibiliForGroup(group) {
      if (!group) return [];
      return buildDateDisponibiliFromEpochs(group.candidates.map((c) => c.epochMs).filter((x) => x != null));
    }

    const dateDisponibiliUnique = hasUniqueOrigin ? buildDateDisponibiliForGroup(uniqueOriginGroup) : [];

    // Quando il numero è ambiguo (origini diverse), chiediamo solo la scelta dell'origine.
    // La scelta per data (oggi/ieri o giorni diversi) è riservata ai casi con origine univoca.
    if (!technicalHint && !originCodeHint && !originCodeFromName && !Number.isFinite(choiceHint) && originGroups.length > 1) {
      return sendCached(
        attachCorrispondenza(
          {
            ok: true,
            data: null,
            needsSelection: true,
            selectionType: 'origin',
            message: 'Più treni trovati con questo numero: specifica choice oppure originName.',
            choices: originGroups.map(serializeOriginChoice),
          },
          true,
          italoFound
        )
      );
    }

    // Se l'origine è univoca ma ci sono più giorni disponibili, chiedi scelta data/epoch.
    if (
      hasUniqueOrigin &&
      !technicalHint &&
      epochMsHint == null &&
      !Number.isFinite(choiceHint) &&
      dateDisponibiliUnique.length > 1
    ) {
      return sendCached(
        attachCorrispondenza(
          {
            ok: true,
            data: null,
            needsSelection: true,
            selectionType: 'date',
            origine: stationNameById(uniqueOriginGroup.originCode),
            message:
              'Più corse trovate per questo numero (giorni diversi): specifica choice oppure timestampRiferimento/date.',
            dateDisponibili: dateDisponibiliUnique,
            dateSuggerite: buildDateSuggeriteFromBase(
              (dateDisponibiliUnique[0] && dateDisponibiliUnique[0].timestamp) || Date.now()
            ),
            choices: dateDisponibiliUnique.map(serializeDateChoice),
          },
          true,
          italoFound
        )
      );
    }

    // Interpreta choice:
    // - se origine ambigua: choice seleziona l'origine
    // - se origine univoca e ci sono più giorni: choice seleziona il giorno
    let selectedOriginGroup = null;
    if (originCodeHint) selectedOriginGroup = originGroups.find((g) => g.originCode === originCodeHint) || null;
    if (!selectedOriginGroup && originCodeFromName) {
      const oc = String(originCodeFromName).toUpperCase();
      selectedOriginGroup = originGroups.find((g) => g.originCode === oc) || null;
    }

    if (!selectedOriginGroup && Number.isFinite(choiceHint)) {
      if (originGroups.length > 1) {
        selectedOriginGroup = choiceHint >= 0 && choiceHint < originGroups.length ? originGroups[choiceHint] : null;
      } else if (hasUniqueOrigin && dateDisponibiliUnique.length > 1) {
        const picked = choiceHint >= 0 && choiceHint < dateDisponibiliUnique.length ? dateDisponibiliUnique[choiceHint] : null;
        if (picked) epochMsHint = picked.timestamp;
        selectedOriginGroup = uniqueOriginGroup;
      }
    }

    if (!selectedOriginGroup && hasUniqueOrigin) selectedOriginGroup = uniqueOriginGroup;

    const technicalSelected = technicalHint ? candidates.find((c) => c.technical === technicalHint) : null;
    const epochSelected =
      epochMsHint != null ? pickClosestByEpoch(selectedOriginGroup ? selectedOriginGroup.candidates : candidates, epochMsHint) : null;

    const selected =
      technicalSelected ||
      epochSelected ||
      (selectedOriginGroup ? selectedOriginGroup.best : null) ||
      candidates[0] ||
      null;

    if (!selected) {
      return sendCached(
        attachCorrispondenza({ ok: false, error: 'Impossibile determinare il codice origine del treno' }, true, italoFound)
      );
    }

    if (!Number.isFinite(epochMsHint) && Number.isFinite(selected?.epochMs)) {
      epochMsHint = selected.epochMs;
    }

    async function fetchSnapshot(ts) {
      const cacheKey = `vt:snapshot:${selected.originCode}:${selected.trainNumber}:${ts}`;
      return cacheGetOrSet(cacheKey, TRAIN_SNAPSHOT_TTL_MS, async () => {
        const url = `${VT_BASE_URL}/andamentoTreno/${encodeURIComponent(selected.originCode)}/${encodeURIComponent(
          selected.trainNumber
        )}/${ts}`;
        try {
          return await fetchJson(url);
        } catch (err) {
          if (err.status === 204) return null;
          throw err;
        }
      });
    }

    function runLooksFuture(snap, nowMs) {
      const stops = Array.isArray(snap?.fermate) ? snap.fermate : [];
      const firstStop = stops[0] || null;
      const startMs =
        pickEpochMs(firstStop, ['partenza_teorica', 'partenzaTeorica', 'programmata', 'programmataZero']) ??
        getStopRealTimes(firstStop).partenzaMs;
      if (startMs == null) return false;
      return startMs - nowMs > 30 * 60 * 1000;
    }

    function trainStillRunning(snap, nowMs) {
      const stops = Array.isArray(snap?.fermate) ? snap.fermate : [];
      const lastStop = stops[stops.length - 1] || null;
      const endMs =
        pickEpochMs(lastStop, ['arrivo_teorico', 'arrivoTeorica', 'programmata', 'programmataZero']) ??
        getStopRealTimes(lastStop).arrivoMs;
      if (endMs == null) return false;
      return nowMs <= endMs + 2 * 60 * 60 * 1000;
    }

    const nowMs = Date.now();
    const baseTimestamp = Number.isFinite(epochMsHint) ? epochMsHint : nowMs;

    let referenceTimestamp = baseTimestamp;
    let snapshot = null;
    const successfulDayStarts = new Set();

    if (Number.isFinite(epochMsHint)) {
      const offsetsHours = [0, -6, 6, -12, 12, -24, 24];
      for (const h of offsetsHours) {
        const ts = baseTimestamp + h * 60 * 60 * 1000;
        if (ts <= 0) continue;
        const s = await fetchSnapshot(ts);
        if (!s) continue;
        const ds = toLocalDayStartMs(ts);
        if (Number.isFinite(ds)) successfulDayStarts.add(ds);
        snapshot = s;
        referenceTimestamp = ts;
        break;
      }
    } else {
      const offsetsHours = [0, -6, -12, -18, -24];
      let primary = null;
      let selectedSnap = null;
      let backup = null;

      for (const h of offsetsHours) {
        const ts = nowMs + h * 60 * 60 * 1000;
        if (ts <= 0) continue;
        const s = await fetchSnapshot(ts);
        if (!s) continue;

        const ds = toLocalDayStartMs(ts);
        if (Number.isFinite(ds)) successfulDayStarts.add(ds);

        const descriptor = { data: s, ts, offset: h };

        if (h === 0) {
          primary = descriptor;
          backup = backup || descriptor;
          if (!runLooksFuture(s, nowMs)) {
            selectedSnap = descriptor;
            break;
          }
          continue;
        }

        backup = backup || descriptor;
        if (trainStillRunning(s, nowMs)) {
          selectedSnap = descriptor;
          break;
        }
      }

      const chosen = selectedSnap || primary || backup;
      if (chosen) {
        snapshot = chosen.data;
        referenceTimestamp = chosen.ts;
      }
    }

    if (!snapshot) {
      italoPayload = await italoPromise;
      italoFound = !!italoPayload;
      if (italoPayload) {
        return sendCached(attachCorrispondenza(italoPayload, true, true));
      }
      return sendCached(
        attachCorrispondenza(
          {
            ok: true,
            data: null,
            message: 'Nessuna informazione di andamento disponibile per il numero fornito.',
          },
          true,
          italoFound
        )
      );
    }

    const fermateRaw = Array.isArray(snapshot.fermate) ? snapshot.fermate : [];
    const globalDelay = parseDelayMinutes(snapshot?.ritardo);
    const originIdx = getOriginStopIndex(fermateRaw);
    const destinationIdx = getDestinationStopIndex(fermateRaw);
    const originStop = originIdx != null ? fermateRaw[originIdx] : null;
    const destinationStop = destinationIdx != null ? fermateRaw[destinationIdx] : null;
    const readyAtOrigin = !!(originStop && hasEffectiveDeparturePlatform(originStop));
    const rfiService = deriveRfiServiceStatus(snapshot);
    const rfiServiceState = rfiService?.stato ?? null;

    const tipoTreno = resolveTrainKind(
      snapshot?.compNumeroTreno,
      snapshot?.categoriaDescrizione,
      snapshot?.categoria,
      snapshot?.tipoTreno
    );
    const clienteKind = resolveTrainKindFromCliente(snapshot?.codiceCliente, snapshot?.tipoTreno, snapshot?.compNumeroTreno);
    // Fallback su codiceCliente (RFI) quando non c'è abbastanza testo per riconoscere la categoria.
    const numberKind = resolveTrainKindFromNumber(snapshot?.numeroTreno || selected.trainNumber || trainNumber);
    const tipoTrenoFinal = numberKind || (tipoTreno.codice !== '?' ? tipoTreno : clienteKind || tipoTreno);
    const companyCode = resolveCompanyCodeFromCliente(snapshot?.codiceCliente);

    const orientamentoCodice =
      snapshot?.orientamento != null && String(snapshot.orientamento).trim() ? String(snapshot.orientamento).trim().toUpperCase() : null;
    const orientamentoDescrizione = (() => {
      const list = Array.isArray(snapshot?.compOrientamento)
        ? snapshot.compOrientamento
        : Array.isArray(snapshot?.descOrientamento)
          ? snapshot.descOrientamento
          : null;
      const first = list && list.length ? String(list[0]).trim() : '';
      return first ? first : null;
    })();
    const executiveBase = parseExecutivePositionFromText(orientamentoDescrizione);
    function computeExecutivePositionForOrient(stopOrientamento) {
      const stopO = stopOrientamento != null ? String(stopOrientamento).trim().toUpperCase() : null;
      if (tipoTrenoFinal.codice !== 'FR') return null;
      if (!executiveBase) return null;
      if (!orientamentoCodice || !stopO) return null;
      return stopO !== orientamentoCodice ? flipHeadTail(executiveBase) : executiveBase;
    }

    const fermate = fermateRaw.map((stop) => {
      const id = stop && stop.id != null ? String(stop.id).trim().toUpperCase() : null;
      const ritardo = parseDelayMinutes(stop?.ritardo) ?? globalDelay;
      const carrozzaExecutive = tipoTrenoFinal.codice === 'FR' ? computeExecutivePositionForOrient(stop?.orientamento) : null;
      const fermataInfo = resolveStopServiceStatus(stop);

      return {
        stazione: stationNameById(id) || stationPublicNameFromIdOrName(stop?.stazione),
        tipoFermata: stop?.tipoFermata != null ? String(stop.tipoFermata) : null,
        statoFermata: fermataInfo.stato,
        tipoFermataRfi: fermataInfo.codice,
        ritardo,
        orari: buildStopTimes(stop, globalDelay),
        binari: buildStopPlatforms(stop),
        ...(carrozzaExecutive ? { carrozzaExecutive } : {}),
      };
    });

    const first = fermateRaw[0] || {};
    const last = fermateRaw[fermateRaw.length - 1] || {};

    const lastDetectionMs = parseEpochMsOrSeconds(snapshot?.oraUltimoRilevamento) ?? parseEpochMsOrSeconds(snapshot?.ultimoRilev);
    const lastDetectionStation = snapshot?.stazioneUltimoRilevamento
      ? String(snapshot.stazioneUltimoRilevamento)
      : null;
    const lastDetectionStationPublic = lastDetectionStation ? String(lastDetectionStation).trim() : null;
    const lastDetectionOrario = formatHHmmFromMs(lastDetectionMs);
    const lastDetectionText =
      [lastDetectionOrario, lastDetectionStationPublic].filter(Boolean).join(' - ').trim() || null;

    const destinationId = destinationStop?.id != null ? String(destinationStop.id).trim().toUpperCase() : null;
    const lastDetectionId = lastDetectionStation != null ? String(lastDetectionStation).trim().toUpperCase() : null;
    const stoppedAtDestination =
      snapshot?.inStazione === true &&
      destinationStop &&
      destinationId &&
      lastDetectionId &&
      lastDetectionId === destinationId &&
      hasEffectiveArrivalPlatform(destinationStop);

    const convoglio =
      tipoTrenoFinal.codice === 'FR' && orientamentoCodice
        ? {
            orientamento: {
              codice: orientamentoCodice,
            },
          }
        : null;

    const firstSchedDepartureMs = pickEpochMs(first, [
      'partenza_teorica',
      'partenzaTeorica',
      'programmata',
      'programmataZero',
    ]);
    const firstRealDepartureMs = getStopRealTimes(first).partenzaMs;
    const lastSchedArrivalMs = pickEpochMs(last, [
      'arrivo_teorico',
      'arrivoTeorica',
      'programmata',
      'programmataZero',
    ]);
    const lastRealArrivalMs = getStopRealTimes(last).arrivoMs;

    const probableDepartureMs = computeProbableMs(firstSchedDepartureMs, firstRealDepartureMs, globalDelay);
    const probableArrivalMs = computeProbableMs(lastSchedArrivalMs, lastRealArrivalMs, globalDelay);

    const runStartMs = firstRealDepartureMs ?? probableDepartureMs ?? firstSchedDepartureMs;
    const runEndMs = lastRealArrivalMs ?? probableArrivalMs ?? lastSchedArrivalMs;
    const giorniCoperti = buildCoveredDaysFromRange(runStartMs, runEndMs);

    const statoRaw = resolveTrainStatus(snapshot);
    const statoTreno = stoppedAtDestination && statoRaw !== 'soppresso' ? 'concluso' : statoRaw;
    const partialSuppression = hasPartialSuppression(fermateRaw);
    const fullySuppressed = hasOnlySuppressedStops(fermateRaw);
    const isSoppresso =
      (rfiServiceState === 'soppresso' || looksLikeSuppressedTrain(snapshot) || fullySuppressed) && !partialSuppression;
    const isVariato = isTrainVaried(snapshot, fermateRaw, rfiServiceState) && !isSoppresso;

    // Se il treno è ancora pianificato, non esporre "prossima fermata" e "ultimo rilevamento"
    // finché dalla stazione di partenza non arriva il binario effettivo (treno in stazione e pronto a partire).
    const hidePlannedCards = (statoTreno === 'programmato' || statoTreno === 'variato') && !readyAtOrigin;

    const lastRealIdx = getLastRealStopIndex(fermateRaw);
    const precedenteFermata = lastRealIdx >= 0 ? buildPreviousStopSummary(fermateRaw[lastRealIdx], lastRealIdx) : null;
    const nextStopIdx = hidePlannedCards || stoppedAtDestination ? null : computeNextStopIndex(snapshot, fermateRaw);
    const prossimaFermata = (() => {
      if (nextStopIdx == null || !fermateRaw[nextStopIdx]) return null;
      const next = buildNextStopSummary(fermateRaw[nextStopIdx], nextStopIdx, globalDelay);
      if (!next) return null;
      return { ...next, precedente: precedenteFermata };
    })();
    const plannedNextStopName = (() => {
      if (!Number.isFinite(originIdx)) return null;
      for (let i = originIdx + 1; i < fermateRaw.length; i += 1) {
        if (isSuppressedStop(fermateRaw[i])) continue;
        return (
          stationNameById(fermateRaw[i]?.id) ||
          stationPublicNameFromIdOrName(fermateRaw[i]?.stazione) ||
          null
        );
      }
      return null;
    })();

    const fermatePerGiorno =
      giorniCoperti.length > 1 ? buildFermatePerGiorno(fermate, giorniCoperti.map((d) => d.timestamp)) : [];

    const principali = {
      numeroTreno: String(snapshot.numeroTreno || selected.trainNumber || trainNumber),
      tipoTreno: { ...trainTypeInfoFromCode(tipoTrenoFinal.codice), ...(companyCode ? { compagnia: companyCode } : {}) },
      tratta: {
        origine: stationNameById(first.id),
        destinazione: stationNameById(last.id),
      },
      stato: statoTreno,
      isSoppresso,
      isVariato,
      inStazione: statoTreno === 'in stazione',
      stazioneCorrente: statoTreno === 'in stazione' ? lastDetectionStationPublic : null,
      prossimaFermata,
      orari: {
        partenza: {
          programmato: formatHHmmFromMs(firstSchedDepartureMs),
          reale: formatHHmmFromMs(firstRealDepartureMs),
          probabile: formatHHmmFromMs(probableDepartureMs),
        },
        arrivo: {
          programmato: formatHHmmFromMs(lastSchedArrivalMs),
          reale: formatHHmmFromMs(lastRealArrivalMs),
          probabile: formatHHmmFromMs(probableArrivalMs),
        },
      },
      ritardoMinuti: globalDelay ?? (fermate.find((f) => typeof f.ritardo === 'number')?.ritardo ?? null),
      ultimoRilevamento: hidePlannedCards
        ? null
        : {
            timestamp: lastDetectionMs,
            orario: lastDetectionOrario,
            luogo: lastDetectionStationPublic,
            testo: lastDetectionText,
          },
      ...(convoglio ? { convoglio } : {}),
      aggiornamentoRfi:
        snapshot?.subTitle != null && String(snapshot.subTitle).trim()
          ? String(snapshot.subTitle).trim()
          : null,
      fermate,
      ...(giorniCoperti.length > 1 ? { giorniCoperti, fermatePerGiorno } : {}),
    };

    const dateDisponibiliFinal = hasUniqueOrigin
      ? buildDateDisponibiliFromEpochs([
          ...dateDisponibiliUnique.map((d) => d.timestamp),
          ...Array.from(successfulDayStarts.values()),
        ])
      : [];

    const statoServizioRaw = rfiServiceState ?? null;
    const statoServizio = formatTrainStatusLabel(statoServizioRaw);
    const statoServizioRfi =
      rfiService?.tipoTreno != null || rfiService?.provvedimento != null
        ? {
            tipoTreno: rfiService?.tipoTreno ?? null,
            provvedimento: rfiService?.provvedimento ?? null,
          }
        : null;

    const responseStateRaw = statoTreno === 'programmato' && readyAtOrigin ? 'in stazione' : statoTreno;
    const stazioneCorrente =
      responseStateRaw === 'in stazione'
        ? statoTreno === 'programmato' && readyAtOrigin
          ? stationNameById(first.id) || stationPublicNameFromIdOrName(first?.stazione) || null
          : lastDetectionStationPublic ?? stationNameById(first.id) ?? null
        : responseStateRaw === 'concluso'
          ? stationNameById(last.id) || stationPublicNameFromIdOrName(last?.stazione) || null
          : null;
    const messaggiRfiBase =
      snapshot?.subTitle != null && String(snapshot.subTitle).trim() ? String(snapshot.subTitle).trim() : null;
    const messaggiRfiPlanned =
      statoTreno === 'programmato' && readyAtOrigin
        ? messaggiRfiBase
          ? `${messaggiRfiBase} - Stazione di partenza`
          : 'Stazione di partenza'
        : messaggiRfiBase;
    const response = buildModelResponse({
      dataRiferimento: formatDateItalianFromMs(referenceTimestamp),
      dateDisponibili: hasUniqueOrigin
        ? dateDisponibiliFinal
            .map((d) => formatDateItalianFromMs(d.timestamp) ?? d.data)
            .filter(Boolean)
        : [],
      compagnia: 'rfi',
      numeroTreno: principali.numeroTreno,
      tipoTreno: principali.tipoTreno,
      tratta: principali.tratta,
      orari: principali.orari,
      statoTreno: {
        deltaTempo: globalDelay ?? null,
        stato: formatTrainStatusLabel(responseStateRaw),
        statoServizio,
        statoServizioRaw,
        statoServizioRfi,
        stazioneCorrente,
        stazioneSuccessiva:
          statoTreno === 'concluso'
            ? null
            : statoTreno === 'programmato'
              ? plannedNextStopName
              : prossimaFermata?.stazione ?? null,
        stazionePrecedente:
          statoTreno === 'concluso' ? null : statoTreno === 'programmato' ? null : precedenteFermata?.stazione ?? null,
        infoIR:
          lastDetectionOrario || lastDetectionStationPublic
            ? {
                ultimoRilevOra: lastDetectionOrario ?? null,
                ultimoRilevLuogo: lastDetectionStationPublic ?? null,
                messaggioUltimoRilev: lastDetectionText ?? null,
              }
            : null,
        messaggiRfi: messaggiRfiPlanned,
      },
      fermate,
    });

    if (debug) response.debug = { dataRiferimento: formatDateItalianFromMs(referenceTimestamp) };
    const finalPayload = attachCorrispondenza(response, true, italoFound);
    sendCached(finalPayload);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: normalizeErrorMessage(err) });
  }
};

app.get('/api/trains/status', rateLimitHeavy, handleTrainStatus);

// ============================================================================
// API: LeFrecce
// ============================================================================

app.get('/api/lefrecce/autocomplete', rateLimitStandard, async (req, res) => {
  const query = (req.query.query || '').trim();
  const includeIds = parseBool(req.query.includeIds, false);
  const limitRaw = req.query.limit;
  const limit = Number.isFinite(Number(limitRaw)) ? Math.max(1, Math.min(50, Number(limitRaw))) : 10;
  if (query.length < 2) return res.json({ ok: true, data: [] });

  const matches = buildStationAutocompleteMatches(query, limit, { onlyWithLefrecceId: true });
  const data = matches.map((item) => {
    const name = item.name;
    const multistation = /\(tutte le stazioni\)/i.test(name);
    return {
      stazione: name,
      multistation,
      ...(includeIds
        ? {
            lefrecceId: Number.isFinite(item.station?.lefrecceId) ? item.station.lefrecceId : null,
            stationCode: item.station?.id || null,
          }
        : {}),
    };
  });
  setCacheHeaders(res, CACHE_TTL_MS);
  res.json({ ok: true, data });
});

async function resolveLefrecceLocationIdByName(stationName) {
  const name = (stationName || '').trim();
  if (!name) return null;

  const key = `lf:loc:${name.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;

  const params = new URLSearchParams({ name, limit: '10' });
  const url = `${LEFRECCE_BASE_URL}/website/locations/search?${params.toString()}`;
  const list = await fetchJson(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json, text/plain, */*',
    },
  });

  if (!Array.isArray(list) || list.length === 0) return null;

  const lower = name.toLowerCase();
  const exact =
    list.find(
      (s) =>
        (s.name && String(s.name).toLowerCase() === lower) ||
        (s.displayName && String(s.displayName).toLowerCase() === lower)
    ) || null;

  const chosen = exact || list[0];
  const id = typeof chosen.id === 'number' ? chosen.id : Number(chosen.id);
  const finalId = Number.isFinite(id) ? id : null;
  if (finalId) cacheSet(key, finalId, 24 * 60 * 60 * 1000);
  return finalId;
}

function parseDurationMinutes(durationStr, fallbackStartIso, fallbackEndIso) {
  const s = String(durationStr || '').trim();
  const m = s.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*min)?/i);
  if (m && (m[1] || m[2])) {
    const hours = m[1] ? Number(m[1]) : 0;
    const mins = m[2] ? Number(m[2]) : 0;
    const total = hours * 60 + mins;
    if (Number.isFinite(total) && total > 0) return total;
  }
  const startMs = Date.parse(String(fallbackStartIso || ''));
  const endMs = Date.parse(String(fallbackEndIso || ''));
  if (!Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs >= startMs) {
    return Math.round((endMs - startMs) / 60000);
  }
  return null;
}

function mapLefreccePrice(price) {
  const p = price && typeof price === 'object' ? price : null;
  if (!p || p.hideAmount === true) return null;
  const importo = Number(p.amount);
  if (!Number.isFinite(importo)) return null;
  const importoOriginale = p.originalAmount != null ? Number(p.originalAmount) : null;
  return {
    valuta: p.currency != null ? String(p.currency).trim() : null,
    importo,
    ...(Number.isFinite(importoOriginale) ? { importoOriginale } : {}),
    ...(p.indicative != null ? { indicativo: !!p.indicative } : {}),
  };
}

function extractTrainNumberOnly(value) {
  const s = value == null ? '' : String(value).trim();
  if (!s) return null;
  const matches = s.match(/\d{1,6}/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1];
}

app.get('/api/solutions', rateLimitHeavy, async (req, res) => {
  try {
    const {
      fromId,
      toId,
      fromLefrecceId,
      toLefrecceId,
      departureLocationId,
      arrivalLocationId,
      fromName,
      toName,
      fromStationCode,
      toStationCode,
      date,
      time,
      adults,
      children,
      frecceOnly,
      regionalOnly,
      intercityOnly,
      tourismOnly,
      noChanges,
      order,
      offset,
      limit,
      bestFare,
      bikeFilter,
    } = req.query;

    if (!date) {
      return res.status(400).json({ ok: false, error: 'Parametro obbligatorio: date (YYYY-MM-DD)' });
    }

    const depIdRaw = departureLocationId ?? fromLefrecceId ?? fromId;
    const arrIdRaw = arrivalLocationId ?? toLefrecceId ?? toId;
    let depId = depIdRaw != null && String(depIdRaw).trim() ? Number(depIdRaw) : null;
    let arrId = arrIdRaw != null && String(arrIdRaw).trim() ? Number(arrIdRaw) : null;
    if (!Number.isFinite(depId)) depId = null;
    if (!Number.isFinite(arrId)) arrId = null;

    const fromCode =
      (fromStationCode ? String(fromStationCode).trim().toUpperCase() : '') ||
      resolveStationIdByName(fromName) ||
      '';
    const toCode =
      (toStationCode ? String(toStationCode).trim().toUpperCase() : '') ||
      resolveStationIdByName(toName) ||
      '';

    if (!depId && fromCode && lefrecceIdByStationId.has(fromCode)) {
      depId = lefrecceIdByStationId.get(fromCode);
    }
    if (!arrId && toCode && lefrecceIdByStationId.has(toCode)) {
      arrId = lefrecceIdByStationId.get(toCode);
    }

    if (!depId || !arrId) {
      return res.status(400).json({
        ok: false,
        error:
          'Impossibile risolvere locationId LeFrecce con stazioni.json (usa fromLefrecceId/toLefrecceId o departureLocationId/arrivalLocationId; in alternativa fromStationCode/toStationCode o fromName/toName presenti nel DB locale).',
      });
    }

    const [hh = '00', mm = '00'] = (time || '00:00').split(':');
    const departureTime = `${date}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00.000`;

    const body = {
      cartId: null,
      departureLocationId: depId,
      arrivalLocationId: arrId,
      departureTime,
      adults: Number(adults || 1),
      children: Number(children || 0),
      criteria: {
        frecceOnly: parseBool(frecceOnly, false),
        regionalOnly: parseBool(regionalOnly, false),
        intercityOnly: parseBool(intercityOnly, false),
        tourismOnly: parseBool(tourismOnly, false),
        noChanges: parseBool(noChanges, false),
        order: order || 'DEPARTURE_DATE',
        offset: Number.isFinite(Number(offset)) ? Number(offset) : 0,
        limit: Number.isFinite(Number(limit)) ? Number(limit) : 10,
      },
      advancedSearchRequest: {
        bestFare: parseBool(bestFare, false),
        bikeFilter: parseBool(bikeFilter, false),
        forwardDiscountCodes: [],
      },
    };

    const vtResp = await fetchWithTimeout(`${LEFRECCE_BASE_URL}/website/ticket/solutions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/plain, */*',
      },
      body: JSON.stringify(body),
    });

    const text = await vtResp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(vtResp.status).json({
        ok: false,
        error: 'Risposta LeFrecce non in formato JSON',
        upstreamStatus: vtResp.status,
        raw: String(text || '').slice(0, 2000),
      });
    }

    if (!vtResp.ok) {
      const fromCodeByLefrecce = Number.isFinite(depId) ? stationIdByLefrecceId.get(depId) : null;
      const toCodeByLefrecce = Number.isFinite(arrId) ? stationIdByLefrecceId.get(arrId) : null;
      const fromCodeResolved = fromCode || fromCodeByLefrecce || null;
      const toCodeResolved = toCode || toCodeByLefrecce || null;
      return res.json({
        ok: false,
        idRicerca: data?.searchId || null,
        stazioni: {
          from:
            (fromCodeResolved && stationNameById(fromCodeResolved)) || (fromName ? String(fromName).trim() : null) || null,
          to: (toCodeResolved && stationNameById(toCodeResolved)) || (toName ? String(toName).trim() : null) || null,
        },
        soluzioni: [],
        error: data?.message || data?.reason || data?.technicalReason || null,
        status: vtResp.status || null,
      });
    }

    const soluzioni = Array.isArray(data?.solutions)
      ? data.solutions.map((wrap) => {
          const sol = wrap && wrap.solution ? wrap.solution : wrap;
          const nodes = Array.isArray(sol?.nodes) ? sol.nodes : [];
          const firstNode = nodes[0] || null;
          const lastNode = nodes[nodes.length - 1] || firstNode;

          const treni = nodes.map((n) => ({
            numeroTreno: extractTrainNumberOnly(n?.train?.description || n?.train?.name || null),
            tipoTreno: trainTypeInfoFromCode(n?.train?.acronym || null),
            da: stationPublicNameFromIdOrName(n?.origin),
            a: stationPublicNameFromIdOrName(n?.destination),
            dataPartenza: formatYYYYMMDDFromIso(n?.departureTime),
            orarioPartenza: formatHHmmFromIso(n?.departureTime),
            dataArrivo: formatYYYYMMDDFromIso(n?.arrivalTime),
            orarioArrivo: formatHHmmFromIso(n?.arrivalTime),
          }));

          const durata = parseDurationMinutes(sol?.duration, sol?.departureTime, sol?.arrivalTime);
          const departureIso = firstNode?.departureTime || sol?.departureTime;
          const arrivalIso = lastNode?.arrivalTime || sol?.arrivalTime;
          const dataPartenza = formatYYYYMMDDFromIso(departureIso);
          const dataArrivo = formatYYYYMMDDFromIso(arrivalIso);
          const partenza = formatHHmmFromIso(departureIso);
          const arrivo = formatHHmmFromIso(arrivalIso);

          return {
            durata,
            dataPartenza,
            partenza,
            dataArrivo,
            arrivo,
            cambi: Math.max(0, nodes.length - 1),
            prezzo: mapLefreccePrice(sol?.price),
            treni,
          };
        })
      : [];

    const fromCodeByLefrecce = Number.isFinite(depId) ? stationIdByLefrecceId.get(depId) : null;
    const toCodeByLefrecce = Number.isFinite(arrId) ? stationIdByLefrecceId.get(arrId) : null;
    const fromCodeResolved = fromCode || fromCodeByLefrecce || null;
    const toCodeResolved = toCode || toCodeByLefrecce || null;

    res.json({
      ok: vtResp.ok,
      idRicerca: data.searchId || null,
      stazioni: {
        from: (fromCodeResolved && stationNameById(fromCodeResolved)) || (fromName ? String(fromName).trim() : null) || null,
        to: (toCodeResolved && stationNameById(toCodeResolved)) || (toName ? String(toName).trim() : null) || null,
      },
      soluzioni,
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: normalizeErrorMessage(err) });
  }
});

// ============================================================================
// Extra endpoint utili
// ============================================================================
app.get('/api/health', rateLimitStandard, (_req, res) => {
  res.json({
    ok: true,
    stationDb: {
      loaded: stationList.length > 0,
      count: stationList.length,
    },
  });
});

app.get('/api/viaggiatreno/station-board', rateLimitStandard, async (req, res) => {
  const stationCode = resolveStationCodeOrNull(req.query.stationCode, req.query.stationName || req.query.name);
  const raw = ENABLE_RAW_UPSTREAM && parseBool(req.query.raw, false);
  if (!stationCode) return res.status(400).json({ ok: false, error: 'stationCode o stationName obbligatorio' });
  try {
    const dateStr = encodeDateString('now');
    const [departures, arrivals] = await Promise.all([
      cacheGetOrSet(`vt:board:dep:${stationCode}`, STATION_BOARD_TTL_MS, () =>
        fetchJson(`${VT_BASE_URL}/partenze/${encodeURIComponent(stationCode)}/${dateStr}`)
      ).catch(() => []),
      cacheGetOrSet(`vt:board:arr:${stationCode}`, STATION_BOARD_TTL_MS, () =>
        fetchJson(`${VT_BASE_URL}/arrivi/${encodeURIComponent(stationCode)}/${dateStr}`)
      ).catch(() => []),
    ]);
    const departuresList = Array.isArray(departures) ? departures : [];
    const arrivalsList = Array.isArray(arrivals) ? arrivals : [];
    setCacheHeaders(res, STATION_BOARD_TTL_MS);
    res.json({
      ok: true,
      stazione: stationNameById(stationCode),
      data: {
        departures: departuresList.map(mapDepartureEntry),
        arrivals: arrivalsList.map(mapArrivalEntry),
      },
      ...(raw ? { raw: { departures: departuresList, arrivals: arrivalsList } } : {}),
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: normalizeErrorMessage(err) });
  }
});

app.get('/api/stations/board', rateLimitStandard, async (req, res) => {
  const stationCode = (req.query.stationCode || '').trim().toUpperCase();
  if (!stationCode) return res.status(400).json({ ok: false, error: 'stationCode obbligatorio' });
  try {
    const dateStr = encodeDateString('now');
    const html = await cacheGetOrSet(`vt:board:html:${stationCode}`, STATION_BOARD_TTL_MS, () =>
      fetchText(`${VT_BOARD_BASE_URL}/partenze/${encodeURIComponent(stationCode)}/${dateStr}`)
    );
    setCacheHeaders(res, STATION_BOARD_TTL_MS);
    res.type('text/html').send(html);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: normalizeErrorMessage(err) });
  }
});

app.get('/api/news', rateLimitStandard, async (req, res) => {
  try {
    const works = parseBool(req.query.works || req.query.lavori, false);
    const html = await cacheGetOrSet(`vt:news:${works ? 'works' : 'news'}`, NEWS_TTL_MS, () =>
      fetchText(`${VT_BASE_URL}/infomobilitaRSS/${works ? 'true' : 'false'}`)
    );
    const data = parseInfomobilitaRSS(html);
    const payload = { ok: true, works, data };
    if (ENABLE_RAW_UPSTREAM) payload.raw = html;
    setCacheHeaders(res, NEWS_TTL_MS);
    res.json(payload);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: normalizeErrorMessage(err) });
  }
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Route non trovata', path: req.path });
});

// Espone alcune funzioni pure per test locali (non usate dall'app).
app.locals.__internals = {
  pickEpochMs,
  formatHHmmFromMs,
  mapDepartureEntry,
  mapArrivalEntry,
  resolveTrainStatus,
  computeNextStopIndex,
  buildNextStopSummary,
};

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ API attive su http://localhost:${PORT}`);
  });
}
