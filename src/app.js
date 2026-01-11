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

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);
const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 5 * 60 * 1000);
const APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'Europe/Rome';
const ENABLE_RAW_UPSTREAM = process.env.ENABLE_RAW_UPSTREAM === '1';
const ENABLE_DEBUG_RAW = process.env.ENABLE_DEBUG_RAW === '1';

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

app.use(express.json());

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
  cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  return value;
}

// ============================================================================
// Station DB (canonica) - si ragiona sempre per codici stazione (RFI)
// ============================================================================
const stationList = [];
const stationsById = new Map(); // id -> { id, name, ... }
const stationIdByKey = new Map(); // normalizedName -> id
const stationTokensIndex = []; // { id, tokens:Set<string> }
const lefrecceIdByStationId = new Map(); // stationId -> lefrecceId (number)
const stationIdByLefrecceId = new Map(); // lefrecceId -> stationId

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

try {
  // Preferisci `require` per garantire l'inclusione nel bundle Netlify Functions.
  // (La lettura via fs può fallire in produzione se il file non viene incluso automaticamente.)
  let list = null;
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    list = require('../stations-viaggiatreno.json');
  } catch {
    list = null;
  }
  if (!Array.isArray(list)) {
    const candidates = [
      path.join(__dirname, '..', 'stations-viaggiatreno.json'),
      path.resolve(process.cwd(), 'stations-viaggiatreno.json'),
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
      .filter((s) => s && s.id)
      .forEach((s) => {
        const id = String(s.id).trim().toUpperCase();
        if (!id) return;
        const name = s.name != null ? String(s.name).trim() : null;
        const lefrecceId = s.lefrecceId != null ? Number(s.lefrecceId) : null;
        const rec = { ...s, id, name, lefrecceId: Number.isFinite(lefrecceId) ? lefrecceId : null };
        stationList.push(rec);
        if (!stationsById.has(id)) stationsById.set(id, rec);
        if (name) {
          addStationNameVariant(id, name);
        }
        if (Number.isFinite(rec.lefrecceId)) {
          if (!lefrecceIdByStationId.has(id)) lefrecceIdByStationId.set(id, rec.lefrecceId);
          if (!stationIdByLefrecceId.has(rec.lefrecceId)) stationIdByLefrecceId.set(rec.lefrecceId, id);
        }
      });

    stationList.forEach((s) => {
      const key = normalizeStationNameKey(s.name);
      const tokens = new Set(key ? key.split(' ').filter(Boolean) : []);
      stationTokensIndex.push({ id: s.id, tokens });
    });
  }
} catch (err) {
  console.warn('⚠️ Impossibile caricare stations-viaggiatreno.json:', err.message);
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

function encodeDateString(when = 'now') {
  const baseDate = when === 'now' ? new Date() : new Date(when);
  return encodeURIComponent(baseDate.toString());
}

function toIsoOrNow(when = 'now') {
  const d = when === 'now' ? new Date() : new Date(when);
  const ms = d.getTime();
  return Number.isNaN(ms) ? new Date().toISOString() : d.toISOString();
}

function parseBool(val, defaultVal = false) {
  if (val === undefined || val === null) return defaultVal;
  if (typeof val === 'boolean') return val;
  const s = String(val).toLowerCase().trim();
  if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(s)) return false;
  return defaultVal;
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
  if (/(EUROCITY|(^|[^A-Z])EC(\s|$))/.test(hay)) return pick('EC', 'intercity');
  if (/(FRECCIAROSSA|(^|[^A-Z])FR(\s|$))/.test(hay)) return pick('FR', 'high-speed');
  if (/(FRECCIARGENTO|(^|[^A-Z])FA(\s|$))/.test(hay)) return pick('FA', 'high-speed');
  if (/(FRECCIABIANCA|(^|[^A-Z])FB(\s|$))/.test(hay)) return pick('FB', 'intercity');
  if (/(ITALO|NTV|(^|[^A-Z])ITA(\s|$))/.test(hay)) return pick('ITA', 'high-speed');
  if (/(INTERCITY|(^|[^A-Z])IC(\s|$))/.test(hay)) return pick('IC', 'intercity');
  // Normalizza tutte le varianti "regionali" su REG (RV, R, REG, ...).
  if (/(REGIONALE\s+VELOCE|(^|[^A-Z])RV(\s|$))/.test(hay)) return pick('REG', 'regional');
  if (/(REGIONALE|(^|[^A-Z])REG(\s|$)|(^|[^A-Z])RE(\s|$)|(^|[^A-Z])R(\s|$))/.test(hay))
    return pick('REG', 'regional');
  if (/(BUS|SOSTITUTIVO)/.test(hay)) return pick('BUS', 'bus');
  return pick('?', 'unknown');
}

// ============================================================================
// Helpers: platform / epoch
// ============================================================================
function pickFirstString(obj, keys) {
  for (const k of keys) {
    if (!k) continue;
    const v = obj && obj[k] != null ? String(obj[k]).trim() : '';
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
  const tipoTreno = resolveTrainKind(
    entry?.categoriaDescrizione,
    entry?.categoria,
    entry?.tipoTreno,
    entry?.compNumeroTreno
  );
  const partenzaMs = pickEpochMs(entry, ['partenzaTreno', 'orarioPartenza', 'partenza', 'dataPartenzaTreno']);
  const { binarioProgrammato, binarioEffettivo } = buildPlatformsForDeparture(entry);
  const ritardo =
    entry && entry.ritardo != null && Number.isFinite(Number(entry.ritardo)) ? Number(entry.ritardo) : 0;
  const circolante =
    typeof entry?.circolante === 'boolean'
      ? entry.circolante
      : entry?.soppresso != null
        ? !entry.soppresso
        : true;

  return {
    numeroTreno: entry && entry.numeroTreno != null ? Number(entry.numeroTreno) : null,
    categoria: tipoTreno.codice,
    origine: stationPublicNameFromIdOrName(entry?.codOrigine) || stationPublicNameFromIdOrName(entry?.origine),
    destinazione:
      stationPublicNameFromIdOrName(entry?.codDestinazione) || stationPublicNameFromIdOrName(entry?.destinazione),
    orarioPartenza: partenzaMs,
    orarioPartenzaLeggibile: formatHHmmFromMs(partenzaMs),
    ritardo: Number.isFinite(ritardo) ? ritardo : null,
    binarioProgrammato,
    binarioEffettivo: binarioEffettivo || binarioProgrammato,
    circolante: !!circolante,
    tipoTreno,
  };
}

function mapArrivalEntry(entry) {
  const tipoTreno = resolveTrainKind(
    entry?.categoriaDescrizione,
    entry?.categoria,
    entry?.tipoTreno,
    entry?.compNumeroTreno
  );
  const arrivoMs = pickEpochMs(entry, ['arrivoTreno', 'orarioArrivo', 'arrivo', 'dataArrivoTreno']);
  const { binarioProgrammato, binarioEffettivo } = buildPlatformsForArrival(entry);
  const ritardo =
    entry && entry.ritardo != null && Number.isFinite(Number(entry.ritardo)) ? Number(entry.ritardo) : 0;
  const circolante =
    typeof entry?.circolante === 'boolean'
      ? entry.circolante
      : entry?.soppresso != null
        ? !entry.soppresso
        : true;

  return {
    numeroTreno: entry && entry.numeroTreno != null ? Number(entry.numeroTreno) : null,
    categoria: tipoTreno.codice,
    origine: stationPublicNameFromIdOrName(entry?.codOrigine) || stationPublicNameFromIdOrName(entry?.origine),
    destinazione:
      stationPublicNameFromIdOrName(entry?.codDestinazione) || stationPublicNameFromIdOrName(entry?.destinazione),
    orarioArrivo: arrivoMs,
    orarioArrivoLeggibile: formatHHmmFromMs(arrivoMs),
    ritardo: Number.isFinite(ritardo) ? ritardo : null,
    binarioProgrammato,
    binarioEffettivo: binarioEffettivo || binarioProgrammato,
    circolante: !!circolante,
    tipoTreno,
  };
}

function parseDelayMinutes(raw) {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function computeProbableMs(scheduledMs, realMs, delayMinutes) {
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

function buildStopTimes(stop, globalDelay) {
  const tipoFermata = stop && stop.tipoFermata != null ? String(stop.tipoFermata).trim().toUpperCase() : '';
  const isOrigin = tipoFermata === 'P';
  const isDestination = tipoFermata === 'A';

  const delayArrivo = parseDelayMinutes(stop?.ritardoArrivo ?? stop?.ritardo ?? globalDelay);
  const delayPartenza = parseDelayMinutes(stop?.ritardoPartenza ?? stop?.ritardo ?? globalDelay);

  const schedArrivoMs = isOrigin
    ? null
    : pickEpochMs(stop, [
        'arrivo_teorico',
        'arrivoTeorico',
        'arrivo_teorica',
        'arrivoTeorica',
        'arrivoProgrammato',
        'arrivoProgrammata',
        'programmata',
        'programmataZero',
      ]);

  const schedPartenzaMs = isDestination
    ? null
    : pickEpochMs(stop, [
        'partenza_teorica',
        'partenzaTeorica',
        'partenzaProgrammato',
        'partenzaProgrammata',
        'programmata',
        'programmataZero',
      ]);

  const realArrivoMs = isOrigin
    ? null
    : pickEpochMs(stop, ['arrivoReale', 'arrivo_reale', 'arrivoEffettivo', 'effettiva']);
  const realPartenzaMs = isDestination
    ? null
    : pickEpochMs(stop, ['partenzaReale', 'partenza_reale', 'partenzaEffettiva', 'effettiva']);

  const predictedArrivoMs = isOrigin
    ? null
    : pickEpochMs(stop, ['arrivoPrevisto', 'arrivoPrevista', 'arrivoProbabile']);
  const predictedPartenzaMs = isDestination
    ? null
    : pickEpochMs(stop, ['partenzaPrevisto', 'partenzaPrevista', 'partenzaProbabile']);

  const probableArrivoMs =
    predictedArrivoMs ?? computeProbableMs(schedArrivoMs, realArrivoMs, delayArrivo);
  const probablePartenzaMs =
    predictedPartenzaMs ?? computeProbableMs(schedPartenzaMs, realPartenzaMs, delayPartenza);

  return {
    arrivo: {
      programmato: schedArrivoMs,
      reale: realArrivoMs,
      probabile: probableArrivoMs,
      delayMinuti: delayArrivo,
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
      delayMinuti: delayPartenza,
      hhmm: {
        programmato: formatHHmmFromMs(schedPartenzaMs),
        reale: formatHHmmFromMs(realPartenzaMs),
        probabile: formatHHmmFromMs(probablePartenzaMs),
      },
    },
  };
}

// ============================================================================
// API: ViaggiaTreno (RFI)
// ============================================================================

// Autocomplete stazioni
app.get('/api/viaggiatreno/autocomplete', async (req, res) => {
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
    res.json({ ok: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// Autocomplete stazioni (locale: usa stations-viaggiatreno.json, senza chiamate esterne)
app.get('/api/stations/autocomplete', (req, res) => {
  const query = (req.query.query || '').trim();
  const limitRaw = req.query.limit;
  const limit = Number.isFinite(Number(limitRaw)) ? Math.max(1, Math.min(50, Number(limitRaw))) : 10;
  if (query.length < 2) return res.json({ ok: true, data: [] });

  const qKey = normalizeStationNameKey(query);
  if (!qKey) return res.json({ ok: true, data: [] });

  const qTokens = qKey.split(' ').filter(Boolean);
  const scored = [];

  for (const s of stationList) {
    if (!s?.name) continue;
    const sKey = normalizeStationNameKey(s.name);
    if (!sKey) continue;

    let score = 0;
    if (sKey === qKey) score += 10;
    if (sKey.startsWith(qKey)) score += 5;
    if (sKey.includes(qKey)) score += 2;

    let hits = 0;
    for (const t of qTokens) {
      if (t && sKey.includes(t)) hits += 1;
    }
    if (hits > 0) score += hits / Math.max(1, qTokens.length);

    if (score > 0) scored.push({ name: String(s.name), score });
  }

  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, 'it'));

  const data = [];
  const seen = new Set();
  for (const item of scored) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    data.push(item.name);
    if (data.length >= limit) break;
  }

  res.json({ ok: true, data });
});

// Info stazione (flatten + meteo)
app.get('/api/stations/info', async (req, res) => {
  const stationCode = resolveStationCodeOrNull(req.query.stationCode, req.query.stationName || req.query.name);
  if (!stationCode) return res.status(400).json({ ok: false, error: 'stationCode o stationName obbligatorio' });

  try {
    const regionId = await fetchRegionId(stationCode);
    const detail = await fetchStationDetail(stationCode, regionId);

    let meteo = null;
    try {
      meteo = await fetchJson(`${VT_BASE_URL}/datimeteo/${encodeURIComponent(regionId)}`);
    } catch {
      meteo = null;
    }

    res.json({
      ok: true,
      stazione: stationNameById(stationCode),
      latitudine: detail && detail.lat != null ? detail.lat : null,
      longitudine: detail && detail.lon != null ? detail.lon : null,
      regione: String(regionId || '').trim() || null,
      meteo,
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// Partenze (enriched)
app.get('/api/stations/departures', async (req, res) => {
  const stationCode = resolveStationCodeOrNull(req.query.stationCode, req.query.stationName || req.query.name);
  const when = (req.query.when || 'now').trim();
  const raw = ENABLE_RAW_UPSTREAM && parseBool(req.query.raw, false);

  if (!stationCode) return res.status(400).json({ ok: false, error: 'stationCode o stationName obbligatorio' });

  try {
    const dateStr = encodeDateString(when);
    const upstream = await fetchJson(`${VT_BASE_URL}/partenze/${encodeURIComponent(stationCode)}/${dateStr}`);
    const list = Array.isArray(upstream) ? upstream : [];

    const treni = list.map(mapDepartureEntry);

    const payload = {
      ok: true,
      stazione: stationNameById(stationCode),
      data: toIsoOrNow(when),
      treni,
    };
    if (raw) payload.raw = list;
    res.json(payload);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// Arrivi (enriched)
app.get('/api/stations/arrivals', async (req, res) => {
  const stationCode = resolveStationCodeOrNull(req.query.stationCode, req.query.stationName || req.query.name);
  const when = (req.query.when || 'now').trim();
  const raw = ENABLE_RAW_UPSTREAM && parseBool(req.query.raw, false);

  if (!stationCode) return res.status(400).json({ ok: false, error: 'stationCode o stationName obbligatorio' });

  try {
    const dateStr = encodeDateString(when);
    const upstream = await fetchJson(`${VT_BASE_URL}/arrivi/${encodeURIComponent(stationCode)}/${dateStr}`);
    const list = Array.isArray(upstream) ? upstream : [];

    const treni = list.map(mapArrivalEntry);

    const payload = {
      ok: true,
      stazione: stationNameById(stationCode),
      data: toIsoOrNow(when),
      treni,
    };
    if (raw) payload.raw = list;
    res.json(payload);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// Stato treno (raw + campi principali)
app.get('/api/trains/status', async (req, res) => {
  const trainNumber = (req.query.numeroTreno || req.query.trainNumber || '').trim();
  const originCodeHint = (req.query.codiceOrigine || req.query.originCode || '').trim().toUpperCase();
  const originNameHint = (req.query.originName || '').trim();
  const choiceHintRaw = req.query.choice;
  const choiceHint = choiceHintRaw != null && choiceHintRaw !== '' ? Number(choiceHintRaw) : null;
  const epochMsHintRaw = req.query.timestampRiferimento || req.query.epochMs || null;
  const epochMsHint = epochMsHintRaw != null ? Number(epochMsHintRaw) : null;
  const debug = ENABLE_DEBUG_RAW && parseBool(req.query.debug, false);

  if (!trainNumber) return res.status(400).json({ ok: false, error: 'numeroTreno obbligatorio' });

  try {
    const textSearch = await fetchText(
      `${VT_BASE_URL}/cercaNumeroTrenoTrenoAutocomplete/${encodeURIComponent(trainNumber)}`
    );
    const lines = textSearch
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (!lines.length) {
      return res.json({ ok: true, data: null, message: 'Nessun treno trovato per questo numero' });
    }

    const candidates = lines
      .map((rawLine) => {
        const parts = String(rawLine).split('|');
        const technical = (parts[1] || '').trim(); // es: "8527-S02430"
        const [numFromTechnical, originCode] = technical.split('-');
        return {
          rawLine,
          technical,
          trainNumber: (numFromTechnical || trainNumber).trim(),
          originCode: (originCode || '').trim().toUpperCase(),
        };
      })
      .filter((c) => c.originCode);

    const originCodeFromName = originNameHint ? resolveStationIdByName(originNameHint) : null;
    const selectedByChoice =
      Number.isFinite(choiceHint) && choiceHint >= 0 && choiceHint < candidates.length ? candidates[choiceHint] : null;

    if (!originCodeHint && !originCodeFromName && !selectedByChoice && candidates.length > 1) {
      return res.json({
        ok: true,
        data: null,
        needsSelection: true,
        message: 'Più treni trovati con questo numero: specifica choice oppure originName.',
        choices: candidates.map((c, idx) => ({
          choice: idx,
          origine: stationNameById(c.originCode),
        })),
      });
    }

    const selected =
      selectedByChoice ||
      (originCodeHint ? candidates.find((c) => c.originCode === originCodeHint) : null) ||
      (originCodeFromName ? candidates.find((c) => c.originCode === String(originCodeFromName).toUpperCase()) : null) ||
      candidates[0] ||
      null;

    if (!selected) {
      return res.json({ ok: false, error: 'Impossibile determinare il codice origine del treno' });
    }

    async function fetchSnapshot(ts) {
      const url = `${VT_BASE_URL}/andamentoTreno/${encodeURIComponent(selected.originCode)}/${encodeURIComponent(
        selected.trainNumber
      )}/${ts}`;
      try {
        return await fetchJson(url);
      } catch (err) {
        if (err.status === 204) return null;
        throw err;
      }
    }

    let referenceTimestamp = Number.isFinite(epochMsHint) ? epochMsHint : Date.now();
    let snapshot = null;

    if (Number.isFinite(epochMsHint)) {
      const offsetsHours = [0, -6, 6, -12, 12, -24, 24];
      for (const h of offsetsHours) {
        const ts = epochMsHint + h * 60 * 60 * 1000;
        if (ts <= 0) continue;
        const s = await fetchSnapshot(ts);
        if (s) {
          snapshot = s;
          referenceTimestamp = ts;
          break;
        }
      }
    } else {
      const offsetsHours = [0, -6, -12, -18, -24];
      for (const h of offsetsHours) {
        const ts = Date.now() + h * 60 * 60 * 1000;
        if (ts <= 0) continue;
        const s = await fetchSnapshot(ts);
        if (s) {
          snapshot = s;
          referenceTimestamp = ts;
          break;
        }
      }
    }

    if (!snapshot) {
      return res.json({
        ok: true,
        data: null,
        message: 'Nessuna informazione di andamento disponibile per il numero fornito.',
      });
    }

    const fermateRaw = Array.isArray(snapshot.fermate) ? snapshot.fermate : [];
    const globalDelay =
      snapshot.ritardo != null && Number.isFinite(Number(snapshot.ritardo)) ? Number(snapshot.ritardo) : null;

    const fermate = fermateRaw.map((stop) => {
      const id = stop && stop.id != null ? String(stop.id).trim().toUpperCase() : null;
      const ritardo =
        stop && stop.ritardo != null && Number.isFinite(Number(stop.ritardo)) ? Number(stop.ritardo) : globalDelay;

      return {
        stazione: stationNameById(id) || stationPublicNameFromIdOrName(stop?.stazione),
        tipoFermata: stop?.tipoFermata != null ? String(stop.tipoFermata) : null,
        ritardo,
        orari: buildStopTimes(stop, globalDelay),
        binari: buildStopPlatforms(stop),
      };
    });

    const first = fermateRaw[0] || {};
    const last = fermateRaw[fermateRaw.length - 1] || {};

    const tipoTreno = resolveTrainKind(
      snapshot?.compNumeroTreno,
      snapshot?.categoriaDescrizione,
      snapshot?.categoria,
      snapshot?.tipoTreno
    );
    // Fallback su codiceCliente (RFI) quando non c'è abbastanza testo per riconoscere la categoria.
    const tipoTrenoFinal =
      tipoTreno.codice !== '?' || snapshot?.codiceCliente == null
        ? tipoTreno
        : Number(snapshot.codiceCliente) === 1
          ? { codice: 'FR', nome: 'FR', categoria: 'high-speed' }
          : tipoTreno;

    const lastDetectionMs =
      snapshot?.oraUltimoRilevamento != null && Number.isFinite(Number(snapshot.oraUltimoRilevamento))
        ? Number(snapshot.oraUltimoRilevamento)
        : null;
    const lastDetectionStation = snapshot?.stazioneUltimoRilevamento
      ? String(snapshot.stazioneUltimoRilevamento)
      : null;

    const firstSchedDepartureMs = pickEpochMs(first, [
      'partenza_teorica',
      'partenzaTeorica',
      'programmata',
      'programmataZero',
    ]);
    const firstRealDepartureMs = pickEpochMs(first, ['partenzaReale', 'partenza_reale', 'effettiva']);
    const lastSchedArrivalMs = pickEpochMs(last, [
      'arrivo_teorico',
      'arrivoTeorica',
      'programmata',
      'programmataZero',
    ]);
    const lastRealArrivalMs = pickEpochMs(last, ['arrivoReale', 'arrivo_reale', 'effettiva']);

    const probableDepartureMs = computeProbableMs(firstSchedDepartureMs, firstRealDepartureMs, globalDelay);
    const probableArrivalMs = computeProbableMs(lastSchedArrivalMs, lastRealArrivalMs, globalDelay);

    const principali = {
      numeroTreno: String(snapshot.numeroTreno || selected.trainNumber || trainNumber),
      codiceTreno: tipoTrenoFinal.codice,
      tipoTreno: tipoTrenoFinal,
      tratta: {
        origine: stationNameById(first.id),
        destinazione: stationNameById(last.id),
      },
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
      ultimoRilevamento: {
        timestamp: lastDetectionMs,
        orario: formatHHmmFromMs(lastDetectionMs),
        stazione: stationPublicNameFromIdOrName(lastDetectionStation),
      },
      aggiornamentoRfi:
        snapshot?.subTitle != null && String(snapshot.subTitle).trim()
          ? String(snapshot.subTitle).trim()
          : null,
      fermate,
    };

    const response = {
      ok: true,
      referenceTimestamp,
      principali,
    };

    if (debug) {
      response.upstream = snapshot;
      response.choices = candidates.map((c) => ({
        technical: c.technical,
        originCode: c.originCode,
      }));
    }

    res.json(response);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// API: LeFrecce
// ============================================================================

app.get('/api/lefrecce/autocomplete', async (req, res) => {
  const query = (req.query.query || '').trim();
  if (query.length < 2) return res.json({ ok: true, data: [] });

  try {
    const params = new URLSearchParams({ name: query, limit: '10' });
    const url = `${LEFRECCE_BASE_URL}/website/locations/search?${params.toString()}`;
    const list = await fetchJson(url, { headers: { Accept: 'application/json, text/plain, */*' } });
    const data = Array.isArray(list)
      ? list.map((s) => ({
          stazione: (() => {
            const lfId = typeof s.id === 'number' ? s.id : Number(s.id);
            const stationId = Number.isFinite(lfId) ? stationIdByLefrecceId.get(lfId) : null;
            return stationNameById(stationId) || stationPublicNameFromIdOrName(s?.name || s?.displayName);
          })(),
          multistation: !!s.multistation,
        }))
      : [];
    res.json({ ok: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
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

app.get('/api/solutions', async (req, res) => {
  try {
    const {
      fromId,
      toId,
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

    let depId = fromId ? Number(fromId) : null;
    let arrId = toId ? Number(toId) : null;

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

    if (!depId) {
      const name = (fromCode && stationNameById(fromCode)) || (fromName ? String(fromName) : '') || fromCode;
      if (name) depId = await resolveLefrecceLocationIdByName(name);
    }
    if (!arrId) {
      const name = (toCode && stationNameById(toCode)) || (toName ? String(toName) : '') || toCode;
      if (name) arrId = await resolveLefrecceLocationIdByName(name);
    }

    if (!depId || !arrId) {
      return res.status(400).json({
        ok: false,
        error:
          'Impossibile risolvere locationId LeFrecce (usa fromName/toName oppure fromStationCode/toStationCode; fromId/toId solo per uso interno).',
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

    const soluzioni = Array.isArray(data?.solutions)
      ? data.solutions.map((wrap) => {
          const sol = wrap && wrap.solution ? wrap.solution : wrap;
          const nodes = Array.isArray(sol?.nodes) ? sol.nodes : [];
          const firstNode = nodes[0] || null;
          const lastNode = nodes[nodes.length - 1] || firstNode;

          const treni = nodes.map((n) => ({
            numeroTreno: n?.train?.description || n?.train?.name || null,
            categoria: n?.train?.acronym || null,
            da: stationPublicNameFromIdOrName(n?.origin),
            a: stationPublicNameFromIdOrName(n?.destination),
            orarioPartenza: formatHHmmFromIso(n?.departureTime),
            orarioArrivo: formatHHmmFromIso(n?.arrivalTime),
          }));

          const durata = parseDurationMinutes(sol?.duration, sol?.departureTime, sol?.arrivalTime);
          const partenza = formatHHmmFromIso(firstNode?.departureTime || sol?.departureTime);
          const arrivo = formatHHmmFromIso(lastNode?.arrivalTime || sol?.arrivalTime);

          return {
            durata,
            partenza,
            arrivo,
            cambi: Math.max(0, nodes.length - 1),
            treni,
          };
        })
      : [];

    res.json({
      ok: vtResp.ok,
      idRicerca: data.searchId || null,
      stazioni: {
        from: (fromCode && stationNameById(fromCode)) || (fromName ? String(fromName).trim() : null) || null,
        to: (toCode && stationNameById(toCode)) || (toName ? String(toName).trim() : null) || null,
      },
      soluzioni,
    });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

// ============================================================================
// Extra endpoint utili
// ============================================================================
app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    stationDb: {
      loaded: stationList.length > 0,
      count: stationList.length,
    },
  });
});

app.get('/api/viaggiatreno/station-board', async (req, res) => {
  const stationCode = resolveStationCodeOrNull(req.query.stationCode, req.query.stationName || req.query.name);
  const raw = ENABLE_RAW_UPSTREAM && parseBool(req.query.raw, false);
  if (!stationCode) return res.status(400).json({ ok: false, error: 'stationCode o stationName obbligatorio' });
  try {
    const dateStr = encodeDateString('now');
    const [departures, arrivals] = await Promise.all([
      fetchJson(`${VT_BASE_URL}/partenze/${encodeURIComponent(stationCode)}/${dateStr}`).catch(() => []),
      fetchJson(`${VT_BASE_URL}/arrivi/${encodeURIComponent(stationCode)}/${dateStr}`).catch(() => []),
    ]);
    const departuresList = Array.isArray(departures) ? departures : [];
    const arrivalsList = Array.isArray(arrivals) ? arrivals : [];
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
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

app.get('/api/stations/board', async (req, res) => {
  const stationCode = (req.query.stationCode || '').trim().toUpperCase();
  if (!stationCode) return res.status(400).json({ ok: false, error: 'stationCode obbligatorio' });
  try {
    const dateStr = encodeDateString('now');
    const html = await fetchText(`${VT_BOARD_BASE_URL}/partenze/${encodeURIComponent(stationCode)}/${dateStr}`);
    res.type('text/html').send(html);
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

app.get('/api/news', async (_req, res) => {
  try {
    const data = await fetchJson(`${VT_BASE_URL}/news/0/it`);
    res.json({ ok: true, data });
  } catch (err) {
    res.status(err.status || 500).json({ ok: false, error: err.message });
  }
});

app.use((req, res) => {
  res.status(404).json({ ok: false, error: 'Route non trovata', path: req.path });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ API attive su http://localhost:${PORT}`);
  });
}
