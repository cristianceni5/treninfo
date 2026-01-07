//Developed by Cristian Ceni 2025 dhn

// In locale usiamo Netlify Dev (functions + redirects) sulla stessa origin.
// Quindi l'API base resta relativa sia in dev che in produzione.
const API_BASE = '';

// Refresh “quasi real-time” (una chiamata al minuto massimo) quando un treno è in monitoraggio.
const TRAIN_AUTO_REFRESH_INTERVAL_MS = 60_000;
let trainAutoRefreshTimer = null;
let trainAutoRefreshTrainNumber = null;
let trainAutoRefreshOriginCode = null;
let trainAutoRefreshEpochMs = null;
let trainAutoRefreshAbortController = null;
let trainAutoRefreshInFlight = false;
let trainAutoRefreshLastSuccessAt = 0;
let lastRenderedTrainStatusPayload = null;

// I dati computati (tipo treno, ritardo, stato viaggio) vengono calcolati dal backend.
// Il frontend li usa direttamente dai campi "computed" o "_computed" nelle risposte API.

const RECENT_KEY = 'monitor_treno_recent';
const FAVORITES_KEY = 'monitor_treno_favorites';
const TRAIN_CHOICE_BY_NUMBER_KEY = 'train_choice_by_number';
const TRAIN_NOTIFICATIONS_KEY = 'treninfo_train_notifications';
const MAX_RECENT = 5;
const MAX_FAVORITES = 8;

function loadTrainNotificationsSettings() {
  try {
    const raw = localStorage.getItem(TRAIN_NOTIFICATIONS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object') {
      return { enabled: false, target: null, lastDigest: '', lastNotifiedAt: 0 };
    }
    return {
      enabled: !!parsed.enabled,
      target: parsed.target && typeof parsed.target === 'object' ? parsed.target : null,
      lastDigest: typeof parsed.lastDigest === 'string' ? parsed.lastDigest : '',
      lastNotifiedAt: Number.isFinite(Number(parsed.lastNotifiedAt)) ? Number(parsed.lastNotifiedAt) : 0,
    };
  } catch {
    return { enabled: false, target: null, lastDigest: '', lastNotifiedAt: 0 };
  }
}

function saveTrainNotificationsSettings(next) {
  try {
    localStorage.setItem(TRAIN_NOTIFICATIONS_KEY, JSON.stringify(next));
  } catch {
    // ignore
  }
}

function buildTrainNotificationTarget({ trainNumber, originCode = '', technical = '', epochMs = null } = {}) {
  const num = String(trainNumber || '').trim();
  if (!num) return null;
  return {
    trainNumber: num,
    originCode: String(originCode || '').trim(),
    technical: String(technical || '').trim(),
    epochMs: Number.isFinite(Number(epochMs)) ? Number(epochMs) : null,
  };
}

function trainNotificationTargetKey(target) {
  if (!target || typeof target !== 'object') return '';
  const num = String(target.trainNumber || '').trim();
  if (!num) return '';
  const origin = String(target.originCode || '').trim();
  const technical = String(target.technical || '').trim();
  const epoch = Number.isFinite(Number(target.epochMs)) ? String(Number(target.epochMs)) : '';
  return [num, origin, technical, epoch].join('|');
}

function getCurrentTrainNotificationState(payload) {
  const settings = loadTrainNotificationsSettings();
  if (!settings.enabled) return { enabled: false, matches: false, targetKey: '' };

  const d = payload && payload.data;
  const num = String((d && (d.numeroTreno || d.numeroTrenoEsteso)) || '').trim();
  const target = buildTrainNotificationTarget({
    trainNumber: num,
    originCode: payload?.originCode || '',
    technical: payload?.technical || '',
    epochMs: payload?.referenceTimestamp ?? null,
  });

  const currentKey = trainNotificationTargetKey(target);
  const savedKey = trainNotificationTargetKey(settings.target);
  return { enabled: true, matches: !!currentKey && currentKey === savedKey, targetKey: currentKey };
}

async function ensureBrowserNotificationPermission() {
  if (typeof window === 'undefined') return 'unsupported';
  if (!('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'granted') return 'granted';
  if (Notification.permission === 'denied') return 'denied';
  try {
    const p = await Notification.requestPermission();
    return p;
  } catch {
    return 'denied';
  }
}

function computeTrainNotificationDigest(payload) {
  const d = payload && payload.data;
  if (!d) return '';
  
  // Usa dati computed dal backend quando disponibili
  const computed = payload.computed || {};
  const journey = computed.journeyState 
    ? { state: computed.journeyState.state } 
    : computeJourneyState(d);
  const globalDelay = computed.globalDelay != null 
    ? computed.globalDelay 
    : getGlobalDelayMinutes(d);
  
  const lastStation = String(d.stazioneUltimoRilevamento || '').trim();
  const lastTime = String(d.oraUltimoRilevamento || '').trim();
  const fermate = Array.isArray(d.fermate) ? d.fermate : [];
  const timelineState = deriveTimelineFromTimes(fermate, { journeyState: journey.state, globalDelay });
  const currentIdx = Number.isFinite(timelineState?.currentIdx) ? String(timelineState.currentIdx) : '';
  return [
    String(journey.state || ''),
    String(globalDelay ?? ''),
    lastStation,
    lastTime,
    currentIdx,
  ].join('|');
}

function buildTrainNotificationMessage(payload) {
  const d = payload && payload.data;
  if (!d) return null;

  // Usa dati computed dal backend quando disponibili
  const computed = payload.computed || {};
  const journey = computed.journeyState 
    ? { state: computed.journeyState.state } 
    : computeJourneyState(d);
  const globalDelay = computed.globalDelay != null 
    ? computed.globalDelay 
    : getGlobalDelayMinutes(d);
  
  const num = String(d.numeroTreno || d.numeroTrenoEsteso || '').trim();
  const route = [String(d.origine || '').trim(), String(d.destinazione || '').trim()].filter(Boolean).join(' → ');

  const stateLabelMap = {
    PLANNED: 'Pianificato',
    RUNNING: 'In viaggio',
    COMPLETED: 'Concluso',
    CANCELLED: 'Soppresso',
    PARTIAL: 'Cancellato parz.',
    UNKNOWN: 'Sconosciuto',
  };
  const stateLabel = stateLabelMap[journey.state] || stateLabelMap.UNKNOWN;

  const lastDetectionMillis = parseToMillis(d.oraUltimoRilevamento);
  const lastTime = d.oraUltimoRilevamento ? formatTimeFlexible(d.oraUltimoRilevamento) : '';
  const lastStation = String(d.stazioneUltimoRilevamento || '').trim();
  const last = [lastTime, lastStation].filter(Boolean).join(' - ');

  const delayPart = Number.isFinite(Number(globalDelay))
    ? (globalDelay > 0 ? `${globalDelay} min ritardo` : (globalDelay < 0 ? `${Math.abs(globalDelay)} min anticipo` : 'In orario'))
    : '';

  const bodyParts = [
    `Stato: ${stateLabel}`,
    delayPart ? `• ${delayPart}` : '',
    last ? `• Ultimo: ${last}` : '',
  ].filter(Boolean);

  return {
    title: num ? `Treno ${num}` : 'Aggiornamento treno',
    body: `${route ? `${route}\n` : ''}${bodyParts.join(' ')}`.trim(),
    tag: num ? `train-update-${num}` : 'train-update',
    timestamp: lastDetectionMillis != null ? lastDetectionMillis : Date.now(),
  };
}

function maybeSendTrainNotification(payload) {
  const settings = loadTrainNotificationsSettings();
  if (!settings.enabled || !settings.target) return;

  const d = payload && payload.data;
  if (!d) return;

  const target = buildTrainNotificationTarget({
    trainNumber: String(d.numeroTreno || d.numeroTrenoEsteso || '').trim(),
    originCode: payload?.originCode || '',
    technical: payload?.technical || '',
    epochMs: payload?.referenceTimestamp ?? null,
  });

  const currentKey = trainNotificationTargetKey(target);
  const savedKey = trainNotificationTargetKey(settings.target);
  if (!currentKey || currentKey !== savedKey) return;

  // Notifica solo quando la pagina non è in primo piano, per evitare spam mentre stai guardando.
  if (typeof document !== 'undefined' && document.visibilityState === 'visible') return;

  if (!('Notification' in window) || Notification.permission !== 'granted') return;

  const digest = computeTrainNotificationDigest(payload);
  if (!digest) return;

  const now = Date.now();
  const MIN_GAP_MS = 30_000;
  if (settings.lastDigest === digest) return;
  if (settings.lastNotifiedAt && now - settings.lastNotifiedAt < MIN_GAP_MS) return;

  const msg = buildTrainNotificationMessage(payload);
  if (!msg) return;

  try {
    // `tag` evita che si accumulino notifiche duplicate (dipende dal browser).
    new Notification(msg.title, { body: msg.body, tag: msg.tag });
    saveTrainNotificationsSettings({
      ...settings,
      lastDigest: digest,
      lastNotifiedAt: now,
    });
  } catch {
    // ignore
  }
}

const REGION_LABELS = {
  '1': 'Lombardia',
  '2': 'Liguria',
  '3': 'Piemonte',
  '4': "Valle d'Aosta",
  '5': 'Lazio',
  '6': 'Umbria',
  '7': 'Molise',
  '8': 'Emilia-Romagna',
  '10': 'Friuli Venezia Giulia',
  '11': 'Marche',
  '12': 'Veneto',
  '13': 'Toscana',
  '14': 'Sicilia',
  '15': 'Basilicata',
  '16': 'Puglia',
  '17': 'Calabria',
  '18': 'Campania',
  '19': 'Abruzzo',
  '20': 'Sardegna',
  '21': 'Trentino-Alto Adige',
  '22': 'Trentino-Alto Adige',
};

// Icone per tipo treno (mantenute per UI)
const TRAIN_KIND_ICON_SRC = {
  FR: '/img/FR_black.svg',
  FA: '/img/FA_black.svg',
  FB: '/img/FB_black.svg',
  IC: '/img/IC.svg',
  ICN: '/img/NI.svg',
  ITA: '/img/ITA.svg',
  BU: '/img/BU_black.svg',
  BUS: '/img/BU_black.svg',
  EC: '/img/EC_black.svg',
  R: '/img/RV.svg',
  REG: '/img/RV.svg',
  RV: '/img/RV.svg',
};

const REGIONAL_ICON_CODES = new Set([
  'R',
  'REG', 'RV', 'IR', 'IREG',
  'LEX',
  'SUB', 'MET', 'SFM',
  'MXP', 'FL',
  'DD', 'DIR', 'D', 'ACC',
  'PE', 'PEXP',
  'TEXP', 'CEXP',
]);

function getTrainKindIconSrc(kindCode) {
  const code = (kindCode || '').toString().trim().toUpperCase();
  // Tutte le sigle che iniziano per R (es. RXP) sono regionali (escluso RJ).
  if (code && code.startsWith('R') && code !== 'RJ') return '/img/RV.svg';
  if (TRAIN_KIND_ICON_SRC[code]) return TRAIN_KIND_ICON_SRC[code];
  if (REGIONAL_ICON_CODES.has(code)) return '/img/RV.svg';
  return '/img/trenitalia.png';
}

const THEMED_TRAIN_ICON_CODES = new Set(['FR', 'FA', 'FB', 'BU', 'BUS', 'EC']);

function getTrainKindIconMarkup(kindCode, options = {}) {
  const { alt = '', imgClass = '', ariaHidden = false } = options;
  const code = (kindCode || '').toString().trim().toUpperCase();
  const ariaHiddenAttr = ariaHidden ? ' aria-hidden="true"' : '';
  const classAttr = imgClass ? ` class="${imgClass}"` : '';
  const safeAlt = escapeHtml(alt);

  if (THEMED_TRAIN_ICON_CODES.has(code)) {
    const base = code === 'BUS' ? 'BU' : code;
    return `<picture${ariaHiddenAttr}><source srcset="/img/${base}_white.svg" media="(prefers-color-scheme: dark)" /><img src="/img/${base}_black.svg" alt="${safeAlt}"${classAttr}${ariaHiddenAttr} /></picture>`;
  }

  const src = getTrainKindIconSrc(code);
  return `<img src="${src}" alt="${safeAlt}"${classAttr}${ariaHiddenAttr} />`;
}

function normalizeTrainShortCode(raw) {
  const code = (raw || '').toString().trim().toUpperCase();
  return /^[A-Z]{1,4}$/.test(code) ? code : '';
}

const PREFERRED_SHORT_CODES = [
  'ICN',
  'FR',
  'FA',
  'FB',
  'IC',
  'ITA',
  'BU',
  'BUS',
  'EC',
  'EN',
  'RJ',
  'TGV',
  'ES',
  'ESC',
  'R',
  'REG',
  'RV',
  'REX',
  'RE',
  'IREG',
  'IR',
  'LEX',
  'SUB',
  'MET',
  'MXP',
  'FL',
  'DD',
  'D',
  'ACC',
  'EXP',
  'SFM',
  'PEXP',
  'PE',
  'TEXP',
  'CEXP',
];

function deriveShortCodeFromRule(rule) {
  const raw = Array.isArray(rule?.matches) ? rule.matches : [];
  const extra = [rule?.detailLabel, rule?.boardLabel];
  const candidates = new Set(
    [...raw, ...extra]
      .map((x) => String(x || '').toUpperCase().trim())
      .filter(Boolean)
      .map((x) => x.replace(/[^A-Z]/g, ''))
      .filter((x) => x.length >= 1 && x.length <= 4)
  );

  for (const preferred of PREFERRED_SHORT_CODES) {
    if (candidates.has(preferred)) return preferred;
  }

  // fallback: prima sigla "compatta" (2-4 lettere)
  for (const c of candidates) {
    if (c.length >= 2 && c.length <= 4) return c;
  }
  return '';
}

// Fallback semplice per estrarre il tipo treno quando backend non fornisce computed
// Estrae la sigla iniziale (es. "FR 9544" → "FR")
function resolveTrainKindFromCode(...rawValues) {
  for (const raw of rawValues) {
    if (raw == null) continue;
    const normalized = String(raw)
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) continue;
    
    // Estrai sigla iniziale (es. "FR 9544" → "FR", "REG 12345" → "REG")
    const prefixMatch = normalized.match(/^([A-Z]{1,4})\b/);
    const numberMatch = normalized.match(/(\d{2,5})/);
    
    if (prefixMatch) {
      const code = prefixMatch[1];
      const number = numberMatch ? numberMatch[1] : '';
      
      // Mappa classi CSS base
      let className = '';
      if (['FR', 'FA', 'TGV', 'ES', 'ITA'].includes(code)) className = 'train-title--fr';
      else if (code === 'ITA') className = 'train-title--ita';
      else if (['IC', 'ICN', 'EC', 'EN', 'FB', 'RJ'].includes(code)) className = 'train-title--ic';
      else if (['REG', 'RV', 'R', 'SUB', 'MET', 'LEX', 'MXP', 'FL'].includes(code)) className = 'train-title--reg';
      
      return {
        boardLabel: code,
        detailLabel: code,
        className,
        shortCode: code,
        number,
      };
    }
  }
  return null;
}

// DOM ----------------------------------------------------------------

const stationQueryInput = document.getElementById('stationQuery');
const stationList = document.getElementById('stationList');
const stationInfoContainer = document.getElementById('stationInfo');
const stationBoardContainer = document.getElementById('stationBoard');
const stationBoardList = document.getElementById('stationBoardList');
const stationBoardTabs = document.querySelectorAll('.station-board-tab');
const stationSearchBtn = document.getElementById('stationSearchBtn');
const stationClearBtn = document.getElementById('stationClearBtn');
const stationSearchSection = document.getElementById('stationSearch');
const trainSearchSection = document.getElementById('trainSearch');
const stationError = document.getElementById('stationError');

const trainNumberInput = document.getElementById('trainNumber');
const trainSearchBtn = document.getElementById('trainSearchBtn');
const trainClearBtn = document.getElementById('trainClearBtn');
const trainError = document.getElementById('trainError');
const trainResult = document.getElementById('trainResult');
const recentTrainsContainer = document.getElementById('recentTrains');
const favoriteTrainsContainer = document.getElementById('favoriteTrains');

// --- DOM: SOLUZIONI DI VIAGGIO ------------------------------------------

const tripFromInput = document.getElementById('tripFrom');
const tripFromList = document.getElementById('tripFromList');
const tripToInput = document.getElementById('tripTo');
const tripToList = document.getElementById('tripToList');
const tripDateInput = document.getElementById('tripDate');
const tripTimeInput = document.getElementById('tripTime');
const tripSearchBtn = document.getElementById('tripSearchBtn');
const tripClearBtn = document.getElementById('tripClearBtn');
const tripSwapBtn = document.getElementById('tripSwapBtn');
const tripResults = document.getElementById('tripResults');
const tripError = document.getElementById('tripError');

let tripFromId = null;
let tripToId = null;
let tripPaginationState = null;

let selectedStation = null;
let stationBoardData = { departures: [], arrivals: [] };
let stationBoardActiveTab = 'departures';

// --- INDICE STAZIONI LOCALE (TSV) --------------------------------------
// Usato per l'autocomplete della ricerca stazione (evita chiamate a ViaggiaTreno).

let stationIndex = [];
let stationIndexByCode = new Map();
let stationIndexLoadPromise = null;

// --- CANONICALIZZAZIONE + COORDINATE STAZIONI (TSV/GEO) -----------------
// File aggiunti:
// - stazioni_coord_coerenti.tsv (name + id_staz + id_reg + lat/lon)
// Obiettivo: coerenza nomi/codici + coordinate per mappe/tratte senza dipendere da VT.

let stationCanonicalByCode = new Map();
let stationCanonicalByKey = new Map();
let stationCanonicalLoadPromise = null;

function normalizeStationSearchKey(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function ensureStationCanonicalLoaded() {
  if (stationCanonicalLoadPromise) return stationCanonicalLoadPromise;

  stationCanonicalLoadPromise = (async () => {
    try {
      const paths = [
        '/stazioni_coord_canon.tsv',
        '/stazioni_coord_coerenti.tsv',
        '/src/stazioni_coord_coerenti.tsv',
        '/src/stazioni_coord_canon.tsv',
      ];
      let text = null;

      for (const path of paths) {
        const res = await fetch(path, { cache: 'force-cache' });
        if (res.ok) {
          text = await res.text();
          break;
        }
      }

      if (!text) throw new Error('TSV stazioni non trovato (prova /stazioni_coord_coerenti.tsv)');

      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length <= 1) {
        stationCanonicalByCode = new Map();
        stationCanonicalByKey = new Map();
        return;
      }

      const header = (lines[0] || '').split('\t').map((h) => h.trim().toLowerCase());
      const findIndex = (predicates) => {
        for (let i = 0; i < header.length; i += 1) {
          const h = header[i] || '';
          if (predicates.some((p) => p(h))) return i;
        }
        return -1;
      };

      const codeIdx = findIndex([
        (h) => h === 'id_staz' || h === 'idstaz' || h === 'codice' || h === 'code' || h === 'stationcode',
        (h) => h.includes('id_staz') || h.includes('idstaz') || h.includes('stationcode'),
      ]);

      const regionIdx = findIndex([
        (h) => h === 'id_reg' || h === 'idreg' || h === 'region' || h === 'regionid',
        (h) => h.includes('id_reg') || h.includes('idreg'),
      ]);

      const latIdx = findIndex([(h) => h === 'lat' || h === 'latitude' || h.includes('lat')]);
      const lonIdx = findIndex([
        (h) => h === 'lon' || h === 'lng' || h === 'long' || h === 'longitude' || h.includes('lon'),
      ]);

      const nameCandidateIdxs = header
        .map((h, idx) => ({ h, idx }))
        .filter(({ h }) => /name|nome|stazione/.test(h))
        .map(({ idx }) => idx);

      const primaryNameIdx = nameCandidateIdxs.length ? nameCandidateIdxs[0] : 0;

      const byCode = new Map();
      const byKey = new Map();

      for (let i = 1; i < lines.length; i += 1) {
        const line = lines[i];
        if (!line) continue;
        const parts = line.split('\t');
        const code = normalizeStationCode(codeIdx >= 0 ? parts[codeIdx] : parts[1] || '');
        if (!code) continue;

        const primaryName = (parts[primaryNameIdx] || '').trim();
        const regionId = (regionIdx >= 0 ? (parts[regionIdx] || '') : (parts[2] || '')).trim();
        const latRaw = (latIdx >= 0 ? (parts[latIdx] || '') : (parts[3] || '')).trim();
        const lonRaw = (lonIdx >= 0 ? (parts[lonIdx] || '') : (parts[4] || '')).trim();

        const lat = latRaw ? Number(String(latRaw).replace(',', '.')) : null;
        const lon = lonRaw ? Number(String(lonRaw).replace(',', '.')) : null;

        const item = {
          name: primaryName || code,
          code,
          regionId,
          lat: Number.isFinite(lat) ? lat : null,
          lon: Number.isFinite(lon) ? lon : null,
          key: normalizeStationSearchKey(primaryName || code),
        };

        byCode.set(code, item);

        const allNames = new Set();
        if (primaryName) allNames.add(primaryName);
        for (const idx of nameCandidateIdxs) {
          const v = (parts[idx] || '').trim();
          if (v) allNames.add(v);
        }

        for (const nm of allNames) {
          const k = normalizeStationSearchKey(nm);
          if (k && !byKey.has(k)) byKey.set(k, item);
        }
      }

      stationCanonicalByCode = byCode;
      stationCanonicalByKey = byKey;
    } catch (err) {
      console.error('Errore caricamento TSV canonico stazioni:', err);
      stationCanonicalByCode = new Map();
      stationCanonicalByKey = new Map();
    }
  })();

  return stationCanonicalLoadPromise;
}

function getCanonicalStationRecord(code, fallbackName = '') {
  const normalized = normalizeStationCode(code);
  if (normalized) {
    const hit = stationCanonicalByCode.get(normalized);
    if (hit) return hit;
  }
  const key = normalizeStationSearchKey(fallbackName);
  if (key) {
    const hit = stationCanonicalByKey.get(key);
    if (hit) return hit;
  }
  return null;
}

function resolveStationDisplayName(code, fallbackName = '') {
  const rec = getCanonicalStationRecord(code, fallbackName);
  if (rec?.name) return rec.name;
  return (fallbackName || '').toString().trim();
}

function parseCoordNumber(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  const s = String(raw).trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function resolveStationCoords(code, fallbackName = '', stationDetails = null) {
  const rec =
    getCanonicalStationRecord(code, fallbackName) ||
    stationIndexByCode.get(normalizeStationCode(code));

  const lat =
    (rec && rec.lat != null ? rec.lat : null) ??
    parseCoordNumber(stationDetails?.latitudine ?? stationDetails?.lat ?? stationDetails?.latitude);
  const lon =
    (rec && rec.lon != null ? rec.lon : null) ??
    parseCoordNumber(stationDetails?.longitudine ?? stationDetails?.lon ?? stationDetails?.longitude);

  if (lat == null || lon == null) return null;
  return { lat, lon };
}

function renderMiniMapSvg(container, points, options = {}) {
  if (!container) return;

  const opts = options && typeof options === 'object' ? options : {};
  const mode = opts.mode === 'point' ? 'point' : 'route';
  const titleRaw = (opts.title || '').toString().trim();

  const cleaned = (Array.isArray(points) ? points : [])
    .map((p) => ({
      lat: Number(p?.lat),
      lon: Number(p?.lon),
      label: (p?.label || p?.name || '').toString(),
      code: (p?.code || '').toString(),
      stopIdx: Number.isFinite(p?.stopIdx) ? Number(p.stopIdx) : null,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (!cleaned.length) {
    container.innerHTML = '';
    return;
  }

  const W = 360;
  const H = 190;
  const M = 14;

  let minLon = cleaned[0].lon;
  let maxLon = cleaned[0].lon;
  let minLat = cleaned[0].lat;
  let maxLat = cleaned[0].lat;

  for (const p of cleaned) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }

  const lonSpanRaw = maxLon - minLon;
  const latSpanRaw = maxLat - minLat;

  const lonPad = lonSpanRaw > 0 ? lonSpanRaw * 0.12 : 0.02;
  const latPad = latSpanRaw > 0 ? latSpanRaw * 0.12 : 0.02;

  minLon -= lonPad;
  maxLon += lonPad;
  minLat -= latPad;
  maxLat += latPad;

  const lonSpan = maxLon - minLon || 0.04;
  const latSpan = maxLat - minLat || 0.04;

  const proj = (p) => {
    const x = M + ((p.lon - minLon) / lonSpan) * (W - M * 2);
    const y = M + ((maxLat - p.lat) / latSpan) * (H - M * 2);
    return { x, y };
  };

  const projectedStops = cleaned.map((p) => {
    const pt = proj(p);
    return { ...p, ...pt };
  });

  const lineStops = cleaned;
  const lineSource = mode === 'route' ? smoothLatLonPath(lineStops, { targetPoints: 520 }) : lineStops;
  const routePos = mode === 'route' ? computeRoutePosition(lineStops, opts, -1) : null;
  const split = mode === 'route' && routePos ? splitPathByPosition(lineSource, routePos) : null;
  const pastLine = split ? split.past : lineSource;
  const futureLine = split ? split.future : [];
  const projectedLine = lineSource.map((p) => {
    const pt = proj(p);
    return { ...p, ...pt };
  });

  const projectLine = (line) =>
    (Array.isArray(line) ? line : []).map((p) => {
      const pt = proj(p);
      return { ...p, ...pt };
    });

  const mkPolyline = (line, color, opacity) => {
    const pr = projectLine(line);
    if (pr.length < 2) return '';
    const attr = pr.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return `<polyline points="${attr}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" pointer-events="none" />`;
  };

  const lineHtml =
    mode === 'route'
      ? (split
        ? (mkPolyline(pastLine, '#16a34a', 0.95) + mkPolyline(futureLine, '#94a3b8', 0.75))
        : mkPolyline(lineSource, '#2d7ff9', 0.9))
      : '';

  const circlesHtml = projectedStops
    .map((p, idx) => {
      const isEndpoint = idx === 0 || idx === projectedStops.length - 1;
      const r = isEndpoint ? 5.2 : 3.6;
      const fill = isEndpoint ? '#0f172a' : '#334155';
      const stroke = '#ffffff';
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2" />`;
    })
    .join('');

  const labelHtml = (() => {
    if (!projectedStops.length) return '';
    const first = projectedStops[0];
    const last = projectedStops[projectedStops.length - 1];

    const mk = (p, anchor) => {
      const text = escapeHtml(p.label || '');
      if (!text) return '';
      const x = Math.min(Math.max(p.x, M), W - M);
      const y = Math.min(Math.max(p.y - 8, M + 10), H - M);
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="12" font-family="system-ui, -apple-system, Segoe UI, Roboto, sans-serif" fill="#0f172a" opacity="0.92">${text}</text>`;
    };

    const anchorFirst = first.x < W / 2 ? 'start' : 'end';
    const anchorLast = last.x < W / 2 ? 'start' : 'end';

    const onlyOne = projectedStops.length === 1;
    if (onlyOne) return mk(first, 'middle');
    return mk(first, anchorFirst) + mk(last, anchorLast);
  })();

  const title = escapeHtml(titleRaw);
  const titleTag = title ? `<title>${title}</title>` : '';

  container.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="100%" role="img" aria-label="${title || 'Mappa'}" preserveAspectRatio="xMidYMid meet">
      ${titleTag}
      <rect x="0" y="0" width="${W}" height="${H}" fill="transparent" />
      ${lineHtml}
      ${circlesHtml}
      ${labelHtml}
    </svg>
  `;
}

function clampLatMercator(lat) {
  const v = Number(lat);
  if (!Number.isFinite(v)) return 0;
  return Math.max(-85.05112878, Math.min(85.05112878, v));
}

function lonLatToWorldPixels(lon, lat, zoom, tileSize = 256) {
  const z = Number(zoom);
  const n = 2 ** z;
  const x = ((Number(lon) + 180) / 360) * n * tileSize;
  const latClamped = clampLatMercator(lat);
  const rad = (latClamped * Math.PI) / 180;
  const y =
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) *
    n *
    tileSize;
  return { x, y };
}

function worldPixelsToLonLat(x, y, zoom, tileSize = 256) {
  const z = Number(zoom);
  const n = 2 ** z;
  const lon = (Number(x) / (n * tileSize)) * 360 - 180;
  const yNorm = 1 - (2 * Number(y)) / (n * tileSize);
  const lat = (Math.atan(Math.sinh(Math.PI * yNorm)) * 180) / Math.PI;
  return { lon, lat };
}

function isLeafletAvailable() {
  try {
    return typeof window !== 'undefined' && !!window.L && typeof window.L.map === 'function';
  } catch {
    return false;
  }
}

function smoothLatLonPath(points, options = {}) {
  const pts = (Array.isArray(points) ? points : [])
    .map((p) => ({ lat: Number(p?.lat), lon: Number(p?.lon) }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (pts.length < 3) return pts.slice();

  const opts = options && typeof options === 'object' ? options : {};
  const segments = pts.length - 1;
  const targetPoints = Number.isFinite(opts.targetPoints) ? Math.max(20, Number(opts.targetPoints)) : 520;
  const samplesPerSegment = Math.max(2, Math.min(10, Math.floor(targetPoints / Math.max(1, segments))));
  const maxOut = Number.isFinite(opts.maxPoints) ? Math.max(50, Number(opts.maxPoints)) : 900;

  const out = [];

  const catmullRom = (p0, p1, p2, p3, t) => {
    const t2 = t * t;
    const t3 = t2 * t;
    const lat = 0.5 * (
      (2 * p1.lat) +
      (-p0.lat + p2.lat) * t +
      (2 * p0.lat - 5 * p1.lat + 4 * p2.lat - p3.lat) * t2 +
      (-p0.lat + 3 * p1.lat - 3 * p2.lat + p3.lat) * t3
    );
    const lon = 0.5 * (
      (2 * p1.lon) +
      (-p0.lon + p2.lon) * t +
      (2 * p0.lon - 5 * p1.lon + 4 * p2.lon - p3.lon) * t2 +
      (-p0.lon + 3 * p1.lon - 3 * p2.lon + p3.lon) * t3
    );
    return { lat, lon };
  };

  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];

    for (let j = 0; j <= samplesPerSegment; j += 1) {
      if (i > 0 && j === 0) continue; // evita duplicati
      const t = j / samplesPerSegment;
      const p = catmullRom(p0, p1, p2, p3, t);
      out.push(p);
      if (out.length >= maxOut) return out;
    }
  }

  return out;
}

function renderMiniMapLeaflet(container, points, options = {}) {
  if (!container || !isLeafletAvailable()) return null;

  // Cleanup eventuale (se riusiamo lo stesso nodo).
  const existing = container.__treninfoLeafletMap;
  if (existing && typeof existing.remove === 'function') {
    try {
      existing.remove();
    } catch {
      // ignore
    }
    container.__treninfoLeafletMap = null;
  }

  const opts = options && typeof options === 'object' ? options : {};
  const mode = opts.mode === 'point' ? 'point' : 'route';

  const cleaned = (Array.isArray(points) ? points : [])
    .map((p) => ({
      lat: Number(p?.lat),
      lon: Number(p?.lon),
      label: (p?.label || p?.name || '').toString(),
      code: (p?.code || '').toString(),
      stopIdx: Number.isFinite(p?.stopIdx) ? Number(p.stopIdx) : null,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (!cleaned.length) {
    container.innerHTML = '';
    return null;
  }

  container.innerHTML = '';

  const L = window.L;
  const map = L.map(container, {
    zoomControl: true,
    attributionControl: true,
    scrollWheelZoom: true,
  });
  container.__treninfoLeafletMap = map;

  const tiles = L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO',
    }
  ).addTo(map);

  const latLngs = cleaned.map((p) => L.latLng(p.lat, p.lon));
  const overlayGroup = L.layerGroup().addTo(map);
  let fitLatLngs = latLngs;

  if (mode === 'route' && latLngs.length >= 2) {
    const routePos = computeRoutePosition(cleaned, opts, -1);
    const smooth = smoothLatLonPath(cleaned, { targetPoints: 650 });
    fitLatLngs = smooth.map((p) => [p.lat, p.lon]);

    if (routePos) {
      const split = splitPathByPosition(smooth, routePos);
      const pastLine = split.past.map((p) => [p.lat, p.lon]);
      const futureLine = split.future.map((p) => [p.lat, p.lon]);

      if (pastLine.length >= 2) {
        L.polyline(pastLine, {
          color: '#16a34a',
          weight: 4,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(overlayGroup);
      }
      if (futureLine.length >= 2) {
        L.polyline(futureLine, {
          color: '#94a3b8',
          weight: 4,
          opacity: 0.75,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false,
        }).addTo(overlayGroup);
      }
      L.circleMarker([routePos.lat, routePos.lon], {
        radius: 5,
        color: '#ffffff',
        weight: 2,
        fillColor: '#2563eb',
        fillOpacity: 0.95,
        interactive: false,
      }).addTo(overlayGroup);
    } else {
      L.polyline(fitLatLngs, {
        color: '#2d7ff9',
        weight: 4,
        opacity: 0.9,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false,
      }).addTo(overlayGroup);
    }
  }

  const activeCodeRaw = (opts.activeCode || '').toString().trim();
  const activeCodeKey = activeCodeRaw ? normalizeStationCode(activeCodeRaw) : '';
  const activeLabelKey = normalizeStationSearchKey((opts.activeLabel || '').toString());
  const activeIdx = (() => {
    if (activeCodeKey) {
      const idx = cleaned.findIndex((p) => normalizeStationCode(p.code) === activeCodeKey);
      if (idx >= 0) return idx;
    }
    if (activeLabelKey) {
      const idx = cleaned.findIndex((p) => normalizeStationSearchKey(p.label) === activeLabelKey);
      if (idx >= 0) return idx;
    }
    return -1;
  })();

  const iconCache = new Map();
  const getPinIcon = (kind) => {
    const k = String(kind || 'mid');
    if (iconCache.has(k)) return iconCache.get(k);
    const icon = L.divIcon({
      className: 'treninfo-leaflet-stop-icon',
      html: `<div class="treninfo-pin treninfo-pin--${k}"></div>`,
      iconSize: [20, 20],
      iconAnchor: [10, 20],
      tooltipAnchor: [0, -18],
    });
    iconCache.set(k, icon);
    return icon;
  };

  const addPinMarker = (p, kind = 'mid') => {
    const ll = L.latLng(p.lat, p.lon);
    const marker = L.marker(ll, { icon: getPinIcon(kind), keyboard: false }).addTo(overlayGroup);
    if (p.label) marker.bindTooltip(p.label, { direction: 'top', offset: [0, -12], opacity: 0.9 });
  };

  const markerIndices = new Set();
  if (cleaned.length === 1) {
    markerIndices.add(0);
  } else {
    const last = cleaned.length - 1;
    markerIndices.add(0);
    markerIndices.add(last);

    const maxMarkers = Number.isFinite(opts.maxMarkers) ? Math.max(2, Number(opts.maxMarkers)) : 60;
    const maxIntermediate = Math.max(0, maxMarkers - 2);
    if (cleaned.length > 2 && maxIntermediate > 0) {
      const step = Math.ceil((cleaned.length - 2) / maxIntermediate);
      for (let i = 1; i < last; i += Math.max(1, step)) markerIndices.add(i);
    }
  }
  if (activeIdx >= 0) markerIndices.add(activeIdx);

  for (const idx of Array.from(markerIndices).sort((a, b) => a - b)) {
    const p = cleaned[idx];
    if (!p) continue;
    const last = cleaned.length - 1;
    const kind =
      idx === activeIdx
        ? 'active'
        : (idx === 0 ? 'start' : (idx === last ? 'end' : 'mid'));
    addPinMarker(p, kind);
  }

  const fit = () => {
    if (latLngs.length === 1) {
      map.setView(latLngs[0], Number.isFinite(opts.stationZoom) ? opts.stationZoom : 15);
      return;
    }
    const bounds = L.latLngBounds(fitLatLngs);
    map.fitBounds(bounds, { padding: [18, 18], maxZoom: Number.isFinite(opts.maxFitZoom) ? opts.maxFitZoom : 12 });
  };

  // Invalida dimensioni dopo render/layout, poi fit.
  setTimeout(() => {
    try {
      map.invalidateSize();
      fit();
    } catch {
      // ignore
    }
  }, 50);

  fit();

  return { map, fit, tiles };
}

function pickTileZoomForBounds(bounds, sizePx, options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const tileSize = Number.isFinite(opts.tileSize) ? opts.tileSize : 256;
  const minZoom = Number.isFinite(opts.minZoom) ? opts.minZoom : 5;
  const maxZoom = Number.isFinite(opts.maxZoom) ? opts.maxZoom : 16;
  const pad = Number.isFinite(opts.pad) ? opts.pad : 18;

  for (let z = maxZoom; z >= minZoom; z -= 1) {
    const p1 = lonLatToWorldPixels(bounds.minLon, bounds.maxLat, z, tileSize);
    const p2 = lonLatToWorldPixels(bounds.maxLon, bounds.minLat, z, tileSize);
    const spanX = Math.abs(p2.x - p1.x);
    const spanY = Math.abs(p2.y - p1.y);
    if (spanX <= sizePx.w - pad * 2 && spanY <= sizePx.h - pad * 2) {
      return z;
    }
  }
  return minZoom;
}

function renderMiniMapTilesOSM(container, points, options = {}) {
  if (!container) return;

  const opts = options && typeof options === 'object' ? options : {};
  const mode = opts.mode === 'point' ? 'point' : 'route';
  const titleRaw = (opts.title || '').toString().trim();
  const activeIndexOverride = Number.isFinite(opts.activeIndex) ? Number(opts.activeIndex) : null;

  const cleaned = (Array.isArray(points) ? points : [])
    .map((p) => ({
      lat: Number(p?.lat),
      lon: Number(p?.lon),
      label: (p?.label || p?.name || '').toString(),
      code: (p?.code || '').toString(),
      stopIdx: Number.isFinite(p?.stopIdx) ? Number(p.stopIdx) : null,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  if (!cleaned.length) {
    container.innerHTML = '';
    return;
  }

  const rect = container.getBoundingClientRect ? container.getBoundingClientRect() : null;
  const W = rect && rect.width ? Math.max(1, Math.round(rect.width)) : 360;
  const H = rect && rect.height ? Math.max(1, Math.round(rect.height)) : 190;
  const tileSize = 256;

  let minLon = cleaned[0].lon;
  let maxLon = cleaned[0].lon;
  let minLat = cleaned[0].lat;
  let maxLat = cleaned[0].lat;

  for (const p of cleaned) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }

  const lonSpanRaw = maxLon - minLon;
  const latSpanRaw = maxLat - minLat;
  const lonPad = lonSpanRaw > 0 ? lonSpanRaw * 0.12 : 0.02;
  const latPad = latSpanRaw > 0 ? latSpanRaw * 0.12 : 0.02;

  minLon -= lonPad;
  maxLon += lonPad;
  minLat -= latPad;
  maxLat += latPad;

  const bounds = { minLon, maxLon, minLat, maxLat };
  const zoomBias = Number.isFinite(opts.zoomBias) ? opts.zoomBias : 1;

  const hasOverrideCenter = opts.center && Number.isFinite(opts.center.lat) && Number.isFinite(opts.center.lon);
  const centerLat = hasOverrideCenter ? Number(opts.center.lat) : (minLat + maxLat) / 2;
  const centerLon = hasOverrideCenter ? Number(opts.center.lon) : (minLon + maxLon) / 2;

  const hasOverrideZoom = Number.isFinite(opts.zoom);
  const baseZoomFit = pickTileZoomForBounds(bounds, { w: W, h: H }, { minZoom: 5, maxZoom: 16, tileSize, pad: 18 });
  const baseZoom = hasOverrideZoom
    ? Math.min(16, Math.max(5, Math.round(Number(opts.zoom))))
    : Math.min(16, Math.max(5, baseZoomFit + zoomBias));

  let zFinal = baseZoom;
  let oFX = 0;
  let oFY = 0;
  let sX = 0;
  let sY = 0;
  let eX = 0;
  let eY = 0;
  let nFinal = 0;

  const MAX_TILES_TOTAL = 56; // abbastanza per desktop, ma evita richieste eccessive
  const computeView = (z) => {
    const n = 2 ** z;
    const c = lonLatToWorldPixels(centerLon, centerLat, z, tileSize);
    const oX = c.x - W / 2;
    const oY = c.y - H / 2;
    const startX = Math.floor(oX / tileSize);
    const startY = Math.floor(oY / tileSize);
    const endX = Math.floor((oX + W) / tileSize);
    const endY = Math.floor((oY + H) / tileSize);
    const tilesX = endX - startX + 1;
    const tilesY = endY - startY + 1;
    return { n, oX, oY, startX, startY, endX, endY, tilesTotal: tilesX * tilesY };
  };

  let found = false;
  for (let z = baseZoom; z >= 5; z -= 1) {
    const view = computeView(z);
    if (view.tilesTotal <= MAX_TILES_TOTAL) {
      zFinal = z;
      nFinal = view.n;
      oFX = view.oX;
      oFY = view.oY;
      sX = view.startX;
      sY = view.startY;
      eX = view.endX;
      eY = view.endY;
      found = true;
      break;
    }
  }

  // Se anche al minZoom il numero di tile è troppo grande, fallback SVG.
  if (!found) {
    renderMiniMapSvg(container, cleaned, opts);
    return;
  }

  const subdomains = ['a', 'b', 'c'];
  const tiles = [];
  for (let ty = sY; ty <= eY; ty += 1) {
    if (ty < 0 || ty >= nFinal) continue;
    for (let tx = sX; tx <= eX; tx += 1) {
      const normX = ((tx % nFinal) + nFinal) % nFinal;
      const left = tx * tileSize - oFX;
      const top = ty * tileSize - oFY;
      const s = subdomains[(Math.abs(tx) + Math.abs(ty)) % subdomains.length];
      const src = `https://${s}.tile.openstreetmap.org/${zFinal}/${normX}/${ty}.png`;
      tiles.push({ left, top, src });
    }
  }

  const projectToLocal = (p) => {
    const w = lonLatToWorldPixels(p.lon, p.lat, zFinal, tileSize);
    return { x: w.x - oFX, y: w.y - oFY };
  };

  const projectedStops = cleaned.map((p) => ({ ...p, ...projectToLocal(p) }));
  const routePos = mode === 'route' ? computeRoutePosition(cleaned, opts, activeIndex) : null;
  const lineSource = mode === 'route' ? smoothLatLonPath(cleaned, { targetPoints: 520 }) : cleaned;
  const split = mode === 'route' && routePos ? splitPathByPosition(lineSource, routePos) : null;

  const projectLine = (line) =>
    (Array.isArray(line) ? line : []).map((p) => ({ ...p, ...projectToLocal(p) }));

  const mkPolyline = (line, color, opacity) => {
    const pr = projectLine(line);
    if (pr.length < 2) return '';
    const attr = pr.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    return `<polyline points="${attr}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" opacity="${opacity}" />`;
  };

  const lineHtml =
    mode === 'route'
      ? (split
        ? (mkPolyline(split.past, '#16a34a', 0.95) + mkPolyline(split.future, '#94a3b8', 0.75))
        : mkPolyline(lineSource, '#2d7ff9', 0.9))
      : '';

  const positionDotHtml = (() => {
    if (!routePos) return '';
    const p = { ...routePos, ...projectToLocal(routePos) };
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return '';
    return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5.2" fill="#2563eb" stroke="#ffffff" stroke-width="2" opacity="0.95" />`;
  })();

  const circlesHtml = projectedStops
    .map((p, idx) => {
      const isEndpoint = idx === 0 || idx === projectedStops.length - 1;
      const isActive = activeIndex != null && idx === activeIndex;
      const r = isActive ? 6.6 : (isEndpoint ? 5.2 : 3.6);
      const fill = isActive ? '#2563eb' : (isEndpoint ? '#0f172a' : '#334155');
      const stroke = '#ffffff';
      const label = escapeHtml(p.label || '');
      return `<circle class="mini-map-marker${isActive ? ' is-active' : ''}" data-idx="${idx}" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2" tabindex="0" role="button" aria-label="${label}" />`;
    })
    .join('');

  const title = escapeHtml(titleRaw);
  const titleTag = title ? `<title>${title}</title>` : '';

  const tilesHtml = tiles
    .map((t) => `<img class="mini-map-tile" src="${t.src}" alt="" loading="lazy" style="left:${t.left.toFixed(1)}px; top:${t.top.toFixed(1)}px" />`)
    .join('');

  container.innerHTML = `
    <div class="mini-map-tiles" role="img" aria-label="${title || 'Mappa'}" data-zoom="${zFinal}">
      <div class="mini-map-tiles-grid" aria-hidden="true">${tilesHtml}</div>
      <svg class="mini-map-tiles-overlay" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">
        ${titleTag}
        ${lineHtml}
        ${positionDotHtml}
        ${circlesHtml}
      </svg>
      <div class="mini-map-attrib">&copy; OpenStreetMap contributors</div>
    </div>
  `;
}

function attachMapWidget(root, points, options = {}) {
  if (!root) return;
  const body = root.querySelector('.map-widget-body');
  if (!body) return;
  const recenterBtn = root.querySelector('[data-map-action="recenter"]');
  const gotoActiveBtn = root.querySelector('[data-map-action="goto-active"]');

  const cleaned = (Array.isArray(points) ? points : [])
    .map((p) => ({
      lat: Number(p?.lat),
      lon: Number(p?.lon),
      label: (p?.label || p?.name || '').toString(),
      code: (p?.code || '').toString(),
      stopIdx: Number.isFinite(p?.stopIdx) ? Number(p.stopIdx) : null,
    }))
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  if (!cleaned.length) return;

  const opts = options && typeof options === 'object' ? options : {};
  // Default: Leaflet (pan/zoom naturale). Fallback: tiles statiche.
  const bindAction = (btn, fn) => {
    if (!btn) return;
    if (btn.__treninfoBound) return;
    btn.__treninfoBound = true;
    btn.addEventListener('click', () => {
      try {
        fn();
      } catch {
        // ignore
      }
    });
  };

  const getActiveLatLon = () => {
    const activeCodeRaw = (opts.activeCode || '').toString().trim();
    const activeCodeKey = activeCodeRaw ? normalizeStationCode(activeCodeRaw) : '';
    if (activeCodeKey) {
      const hit = cleaned.find((p) => normalizeStationCode(p.code) === activeCodeKey);
      if (hit) return { lat: hit.lat, lon: hit.lon };
    }
    const activeLabelKey = normalizeStationSearchKey((opts.activeLabel || '').toString());
    if (activeLabelKey) {
      const hit = cleaned.find((p) => normalizeStationSearchKey(p.label) === activeLabelKey);
      if (hit) return { lat: hit.lat, lon: hit.lon };
    }
    return null;
  };

  const scrollToCurrentStop = () => {
    try {
      const scope = root.closest('#trainResult') || document;
      const el =
        scope.querySelector('.stop-card.stop-current') ||
        scope.querySelector('tr.stop-current');
      if (!el || typeof el.scrollIntoView !== 'function') return;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } catch {
      // ignore
    }
  };

  try {
    const leaflet = renderMiniMapLeaflet(body, cleaned, opts);
    if (leaflet) {
      bindAction(recenterBtn, () => leaflet.fit());
      bindAction(gotoActiveBtn, () => {
        const pos = getActiveLatLon();
        if (!pos) return;
        const z = Number.isFinite(opts.activeZoom) ? Number(opts.activeZoom) : 15;
        leaflet.map.setView([pos.lat, pos.lon], z, { animate: true });
        scrollToCurrentStop();
      });
      return;
    }
  } catch (err) {
    console.error('Errore Leaflet, fallback:', err);
  }

  try {
    const renderBase = () => renderMiniMapTilesOSM(body, cleaned, opts);
    renderBase();
    bindAction(recenterBtn, renderBase);
    bindAction(gotoActiveBtn, () => {
      const pos = getActiveLatLon();
      if (!pos) return;
      const z = Number.isFinite(opts.activeZoom) ? Math.round(Number(opts.activeZoom)) : 14;
      renderMiniMapTilesOSM(body, cleaned, { ...opts, center: { lat: pos.lat, lon: pos.lon }, zoom: z });
      scrollToCurrentStop();
    });
  } catch (err) {
    console.error('Errore mappa tiles, fallback SVG:', err);
    renderMiniMapSvg(body, cleaned, opts);
    bindAction(recenterBtn, () => renderMiniMapSvg(body, cleaned, opts));
    bindAction(gotoActiveBtn, () => {
      const pos = getActiveLatLon();
      if (!pos) return;
      // SVG non è zoomabile: ridisegna comunque (best-effort).
      renderMiniMapSvg(body, cleaned, opts);
      scrollToCurrentStop();
    });
  }
}

function findClosestPointIndex(points, target) {
  const pts = Array.isArray(points) ? points : [];
  if (!pts.length) return -1;
  const tLat = Number(target?.lat);
  const tLon = Number(target?.lon);
  if (!Number.isFinite(tLat) || !Number.isFinite(tLon)) return -1;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length; i += 1) {
    const p = pts[i];
    const dLat = Number(p.lat) - tLat;
    const dLon = Number(p.lon) - tLon;
    const d = dLat * dLat + dLon * dLon;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function findClosestPointByStopIdx(points, stopIdx) {
  const pts = Array.isArray(points) ? points : [];
  const s = Number(stopIdx);
  if (!Number.isFinite(s) || !pts.length) return null;
  let best = null;
  let bestD = Infinity;
  for (const p of pts) {
    if (!p || !Number.isFinite(p.stopIdx)) continue;
    const d = Math.abs(p.stopIdx - s);
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

function computeRoutePosition(points, options = {}, fallbackIndex = -1) {
  const pts = Array.isArray(points) ? points : [];
  if (!pts.length) return null;
  const opts = options && typeof options === 'object' ? options : {};

  const hasSegment =
    opts.segment &&
    Number.isFinite(opts.segment.fromIdx) &&
    Number.isFinite(opts.segment.toIdx) &&
    typeof opts.segment.progress === 'number' &&
    opts.segment.progress != null;

  if (hasSegment) {
    const from = findClosestPointByStopIdx(pts, Number(opts.segment.fromIdx));
    const to = findClosestPointByStopIdx(pts, Number(opts.segment.toIdx));
    const prog = Math.max(0, Math.min(1, Number(opts.segment.progress)));
    if (from && to) {
      return {
        lat: from.lat + (to.lat - from.lat) * prog,
        lon: from.lon + (to.lon - from.lon) * prog,
      };
    }
  }

  const activeCodeRaw = (opts.activeCode || '').toString().trim();
  const activeCodeKey = activeCodeRaw ? normalizeStationCode(activeCodeRaw) : '';
  if (activeCodeKey) {
    const hit = pts.find((p) => normalizeStationCode(p.code) === activeCodeKey);
    if (hit) return { lat: hit.lat, lon: hit.lon };
  }

  const activeLabelKey = normalizeStationSearchKey((opts.activeLabel || '').toString());
  if (activeLabelKey) {
    const hit = pts.find((p) => normalizeStationSearchKey(p.label) === activeLabelKey);
    if (hit) return { lat: hit.lat, lon: hit.lon };
  }

  if (Number.isFinite(fallbackIndex) && pts[fallbackIndex]) {
    const p = pts[fallbackIndex];
    return { lat: p.lat, lon: p.lon };
  }

  return null;
}

function splitPathByPosition(path, position) {
  const pts = Array.isArray(path) ? path : [];
  if (pts.length < 2) return { past: pts.slice(), future: [] };
  const idx = findClosestPointIndex(pts, position);
  if (idx < 0) return { past: [], future: pts.slice() };
  const past = pts.slice(0, idx + 1);
  const future = pts.slice(idx);
  return { past, future };
}

function buildTrainRoutePoints(stops, limit = 80) {
  const fermate = Array.isArray(stops) ? stops : [];
  const out = [];
  let lastKey = '';

  for (let idx = 0; idx < fermate.length; idx += 1) {
    const f = fermate[idx];
    if (!f || typeof f !== 'object') continue;
    const code = getStopStationCode(f);
    const nameRaw = f.stazione || f.stazioneNome || '';
    const label = resolveStationDisplayName(code, nameRaw) || nameRaw || '';
    const coords = resolveStationCoords(code, label, null);
    if (!coords) continue;

    const key = code ? normalizeStationCode(code) : normalizeStationSearchKey(label);
    if (!key) continue;
    if (key === lastKey) continue;

    out.push({ ...coords, label, code: code || '', stopIdx: idx });
    lastKey = key;
    if (out.length >= limit) break;
  }

  return out;
}

async function ensureStationIndexLoaded() {
  if (stationIndexLoadPromise) return stationIndexLoadPromise;

  stationIndexLoadPromise = (async () => {
    try {
      await ensureStationCanonicalLoaded();

      // L'indice per l'autocomplete è direttamente quello "coerente".
      const parsed = Array.from(stationCanonicalByCode.values())
        .filter((item) => item && item.name && item.code);

      parsed.sort((a, b) => a.key.localeCompare(b.key, 'it'));
      stationIndex = parsed;
      stationIndexByCode = new Map(
        parsed.map((item) => [normalizeStationCode(item.code), item])
      );
    } catch (err) {
      console.error('Errore caricamento indice stazioni TSV:', err);
      stationIndex = [];
      stationIndexByCode = new Map();
    }
  })();

  return stationIndexLoadPromise;
}

function findStationsLocal(query, limit = 12) {
  const qRaw = String(query || '').trim();
  if (!qRaw) return [];

  const qCode = qRaw.toUpperCase();
  // Supporto ricerca diretta per codice stazione (es: S01062)
  if (/^[A-Z]\d{5}$/.test(qCode)) {
    const hit = stationIndexByCode.get(qCode);
    return hit ? [hit] : [];
  }

  const q = normalizeStationSearchKey(qRaw);
  if (q.length < 2) return [];

  const starts = [];
  const contains = [];

  for (let i = 0; i < stationIndex.length; i += 1) {
    const s = stationIndex[i];
    if (!s?.key) continue;
    if (s.key.startsWith(q)) {
      starts.push(s);
      if (starts.length >= limit) break;
    }
  }

  if (starts.length >= limit) return starts;

  for (let i = 0; i < stationIndex.length; i += 1) {
    const s = stationIndex[i];
    if (!s?.key) continue;
    if (s.key.includes(q) && !s.key.startsWith(q)) {
      contains.push(s);
      if (starts.length + contains.length >= limit) break;
    }
  }

  return [...starts, ...contains].slice(0, limit);
}

function scrollToSection(element) {
  if (!element || typeof element.scrollIntoView !== 'function') return;
  requestAnimationFrame(() => {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// UTIL ---------------------------------------------------------------

function setInlineError(target, message) {
  if (!target) return;
  const text = (message || '').toString().trim();
  if (!text) {
    target.textContent = '';
    target.hidden = true;
    return;
  }
  target.textContent = text;
  target.hidden = false;
}

function debounce(fn, delay) {
  let timer = null;
  return (...args) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function formatTimeFromMillis(ms) {
  if (typeof ms !== 'number' || Number.isNaN(ms) || ms <= 0) return '-';
  const d = new Date(ms);
  return d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
}

function parseToMillis(raw) {
  if (raw == null) return null;

  if (typeof raw === 'number') {
    if (!Number.isNaN(raw) && raw > 1e11 && raw < 1e13) return raw;
    return null;
  }

  const s = String(raw).trim();
  if (!s) return null;

  // /Date(1697040000000)/ (alcune serializzazioni)
  const dotNet = s.match(/Date\((\d{10,13})\)/i);
  if (dotNet) {
    const n = Number(dotNet[1]);
    return Number.isNaN(n) ? null : n;
  }

  if (/^\d+$/.test(s)) {
    if (s.length === 13) {
      const n = Number(s);
      return Number.isNaN(n) ? null : n;
    }
    if (s.length === 12 || s.length === 14) {
      const year = Number(s.slice(0, 4));
      const month = Number(s.slice(4, 6)) - 1;
      const day = Number(s.slice(6, 8));
      const hour = Number(s.slice(8, 10));
      const minute = Number(s.slice(10, 12));
      const second = s.length === 14 ? Number(s.slice(12, 14)) : 0;
      const d = new Date(year, month, day, hour, minute, second);
      const ms = d.getTime();
      return Number.isNaN(ms) ? null : ms;
    }
  }

  // ISO / RFC parsing (es: 2025-12-14T12:30:00)
  const parsed = Date.parse(s);
  if (!Number.isNaN(parsed)) return parsed;

  return null;
}

function formatTimeFlexible(raw) {
  const ms = parseToMillis(raw);
  if (ms == null) {
    const s = String(raw || '').trim();
    return s || '-';
  }
  return formatTimeFromMillis(ms);
}

function computePredictedMillis(scheduledRaw, delayMinutes, baseDayMs) {
  if (!Number.isFinite(delayMinutes)) return null;

  let scheduledMs = parseToMillis(scheduledRaw);

  // Fallback: se l'orario è solo HH:mm o HHmm, lo agganciamo al "giorno base" del viaggio.
  if (scheduledMs == null && scheduledRaw != null) {
    const s = String(scheduledRaw).trim();
    let h = null;
    let m = null;

    const m1 = s.match(/^(\d{2}):(\d{2})/);
    if (m1) {
      h = Number(m1[1]);
      m = Number(m1[2]);
    } else if (/^\d{4}$/.test(s)) {
      h = Number(s.slice(0, 2));
      m = Number(s.slice(2, 4));
    }

    if (Number.isFinite(h) && Number.isFinite(m)) {
      const base = baseDayMs != null ? new Date(baseDayMs) : new Date();
      const d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, m, 0, 0);
      const ms = d.getTime();
      if (!Number.isNaN(ms)) scheduledMs = ms;
    }
  }

  if (scheduledMs == null) return null;
  return scheduledMs + delayMinutes * 60000;
}

function getPlannedTimes(fermate) {
  const stops = Array.isArray(fermate) ? fermate : [];
  const first = stops[0];
  const last = stops[stops.length - 1];

  const departure = first
    ? formatTimeFlexible(
        first.partenza_teorica ??
        first.partenzaTeorica ??
        first.programmata
      )
    : '-';

  const arrival = last
    ? formatTimeFlexible(
        last.arrivo_teorico ??
        last.arrivoTeorico ??
        last.programmata
      )
    : '-';

  return { departure, arrival };
}

function hhmmFromRaw(raw) {
  const ms = parseToMillis(raw);
  if (ms == null) return null;
  const d = new Date(ms);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}${m}`;
}

function humanizeDeltaMinutes(mins) {
  if (mins == null || !Number.isFinite(mins)) return '';
  if (Math.abs(mins) < 0.5) return 'ora';

  const sign = mins > 0 ? 1 : -1;
  const abs = Math.abs(mins);
  const h = Math.floor(abs / 60);
  const m = Math.round(abs % 60);
  let core = '';
  if (h > 0 && m > 0) core = `${h} h ${m} min`;
  else if (h > 0) core = `${h} h`;
  else core = `${m} min`;

  return sign > 0 ? `tra ${core}` : `${core} fa`;
}

function parseDelayMinutes(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim().replace(',', '.');
    if (!trimmed) return null;
    const direct = Number(trimmed);
    if (!Number.isNaN(direct)) return direct;
    const match = trimmed.match(/-?\d+/);
    if (match) {
      const num = Number(match[0]);
      if (!Number.isNaN(num)) return num;
    }
  }
  return null;
}

function resolveDelay(primary, fallback) {
  const parsedPrimary = parseDelayMinutes(primary);
  if (parsedPrimary != null) return parsedPrimary;
  return parseDelayMinutes(fallback);
}

function getPredictionDelayMinutes(stopDelayRaw, globalDelayMinutes, hasRealTime) {
  const stopDelay = parseDelayMinutes(stopDelayRaw);
  const globalDelay = parseDelayMinutes(globalDelayMinutes);

  // Per molte corse VT/RFI le fermate future riportano 0 anche se il treno è in ritardo.
  // Se non abbiamo ancora un orario reale per quella fermata, preferiamo il ritardo globale (>0).
  if (!hasRealTime && globalDelay != null && globalDelay > 0) {
    if (stopDelay == null || stopDelay <= 0) return globalDelay;
  }

  return stopDelay != null ? stopDelay : globalDelay;
}

function encodeDatasetValue(value) {
  return encodeURIComponent(value || '');
}

function decodeDatasetValue(value) {
  try {
    return decodeURIComponent(value || '');
  } catch {
    return value || '';
  }
}

function formatBoardClock(raw) {
  if (raw == null) return '--:--';
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return '--:--';
    if (/^\d{4}$/.test(trimmed)) {
      return `${trimmed.slice(0, 2)}:${trimmed.slice(2, 4)}`;
    }
    if (trimmed.includes(':')) {
      return trimmed.slice(0, 5);
    }
  }
  if (typeof raw === 'number') {
    return formatTimeFromMillis(raw);
  }
  return formatTimeFlexible(raw);
}

function normalizeStationCode(code) {
  return String(code || '')
    .trim()
    .toUpperCase();
}

function buildCodeVariants(code) {
  const normalized = normalizeStationCode(code);
  if (!normalized) return [];
  const variants = new Set([normalized]);
  const noPrefix = normalized.replace(/^S/, '');
  if (noPrefix) {
    variants.add(noPrefix);
    const noZeros = noPrefix.replace(/^0+/, '');
    if (noZeros) variants.add(noZeros);
  }
  const digitsOnly = normalized.replace(/[^0-9]/g, '');
  if (digitsOnly) variants.add(digitsOnly);
  return Array.from(variants);
}

function getStopStationCode(stop) {
  if (!stop || typeof stop !== 'object') return '';
  const candidates = [
    stop.codiceStazione,
    stop.codStazione,
    stop.idStazione,
    stop.id,
    stop.stationCode,
    stop.codice,
  ];
  for (const cand of candidates) {
    const normalized = normalizeStationCode(cand);
    if (normalized) return normalized;
  }
  return '';
}

function getStationCodeCandidates(selection, stationDetails = {}, infoPayload = {}) {
  const values = [
    stationDetails.codiceStazione,
    stationDetails.codStazione,
    stationDetails.codice,
    stationDetails.id,
    stationDetails.stationCode,
    infoPayload.stationCode,
    selection?.code,
  ];
  const variants = values.flatMap(buildCodeVariants);
  return Array.from(new Set(variants));
}

function matchWeatherEntryFromList(list, stationCodes) {
  if (!Array.isArray(list) || !list.length) return null;
  if (stationCodes.length) {
    for (const entry of list) {
      const entryCodes = buildCodeVariants(
        entry?.codiceStazione ||
        entry?.codStazione ||
        entry?.codice ||
        entry?.stationCode ||
        entry?.id ||
        entry?.stazione
      );
      if (!entryCodes.length) continue;
      const matches = entryCodes.some((code) => stationCodes.includes(code));
      if (matches) return entry;
    }
  }
  return list[0];
}

function matchWeatherEntryFromObject(obj, stationCodes) {
  if (!obj || typeof obj !== 'object') return null;
  for (const code of stationCodes) {
    if (Object.prototype.hasOwnProperty.call(obj, code) && obj[code]) {
      return obj[code];
    }
    const lower = code.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(obj, lower) && obj[lower]) {
      return obj[lower];
    }
  }

  if (obj.stazioni) {
    const nested = matchWeatherEntryFromObject(obj.stazioni, stationCodes);
    if (nested) return nested;
  }

  const fallbackKey = Object.keys(obj).find((key) => obj[key] && typeof obj[key] === 'object');
  return fallbackKey ? obj[fallbackKey] : null;
}

function resolveWeatherEntry(meteo, stationCodes = []) {
  if (!meteo) return null;

  const codes = Array.from(new Set(stationCodes));

  if (Array.isArray(meteo?.datiMeteoList) && meteo.datiMeteoList.length) {
    return matchWeatherEntryFromList(meteo.datiMeteoList, codes);
  }

  if (Array.isArray(meteo?.previsioni) && meteo.previsioni.length) {
    return matchWeatherEntryFromList(meteo.previsioni, codes);
  }

  if (Array.isArray(meteo)) {
    return matchWeatherEntryFromList(meteo, codes);
  }

  if (typeof meteo === 'object') {
    const matched = matchWeatherEntryFromObject(meteo, codes);
    if (matched) return matched;
  }

  return meteo;
}

function formatTemperatureValue(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return `${value}°C`;
  const str = String(value).trim();
  if (!str) return null;
  if (str.endsWith('°C')) return str;
  const normalized = Number(str.replace(',', '.'));
  if (!Number.isNaN(normalized)) return `${normalized}°C`;
  return str;
}

function pickTemperatureColor(tempValue) {
  if (tempValue == null) return 'station-weather-temp--mild';
  const numeric = Number(String(tempValue).replace('°C', '').replace(',', '.'));
  if (Number.isNaN(numeric)) return 'station-weather-temp--mild';
  if (numeric <= 0) return 'station-weather-temp--freezing';
  if (numeric <= 10) return 'station-weather-temp--cold';
  if (numeric <= 20) return 'station-weather-temp--mild';
  if (numeric <= 28) return 'station-weather-temp--warm';
  return 'station-weather-temp--hot';
}

function buildWeatherDetails(meteo, stationCodes = []) {
  const entry = resolveWeatherEntry(meteo, stationCodes);
  if (!entry) return null;

  const temperatureSources = [
    entry?.temperatura,
    entry?.temp,
    entry?.temperature,
    entry?.gradi,
    entry?.oggiTemperatura,
    entry?.oggiTemperaturaMattino,
    entry?.oggiTemperaturaPomeriggio,
    entry?.oggiTemperaturaSera,
    entry?.domaniTemperatura,
  ];

  let temperatureLabel = null;
  for (const source of temperatureSources) {
    const formatted = formatTemperatureValue(source);
    if (formatted) {
      temperatureLabel = formatted;
      break;
    }
  }

  if (!temperatureLabel) return null;

  return {
    temperature: temperatureLabel,
    temperatureClass: pickTemperatureColor(temperatureLabel),
  };
}

function resolveRegionLabel(stationDetails, infoPayload) {
  const directLabel = stationDetails?.regione || stationDetails?.regionName;
  if (directLabel) return directLabel;
  const code = stationDetails?.codRegione ?? stationDetails?.codiceRegione ?? infoPayload?.regionId;
  if (code == null) return null;
  const normalized = String(code).trim();
  if (!normalized) return null;
  return REGION_LABELS[normalized] || normalized;
}

function resetStationDisplay(message = '') {
  setInlineError(stationError, '');
  if (stationInfoContainer) {
    if (message) {
      stationInfoContainer.classList.remove('hidden');
      stationInfoContainer.innerHTML = `<p class="small muted">${message}</p>`;
    } else {
      stationInfoContainer.classList.add('hidden');
      stationInfoContainer.innerHTML = '';
    }
  }
  if (stationBoardContainer && stationBoardList) {
    stationBoardContainer.classList.add('hidden');
    stationBoardList.innerHTML = '';
  }
  stationBoardData = { departures: [], arrivals: [] };
  stationBoardActiveTab = 'departures';
  stationBoardTabs.forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.board === 'departures');
    btn.setAttribute('aria-selected', btn.dataset.board === 'departures' ? 'true' : 'false');
  });
}

function clearStationSearch() {
  selectedStation = null;
  setInlineError(stationError, '');
  if (stationQueryInput) {
    stationQueryInput.value = '';
  }
  if (stationList) {
    stationList.innerHTML = '';
    stationList.hidden = true;
  }
  resetStationDisplay();
}

function clearTrainSearch() {
  stopTrainAutoRefresh('clear');
  if (trainNumberInput) {
    trainNumberInput.value = '';
  }
  if (trainError) {
    trainError.textContent = '';
  }
  if (trainResult) {
    trainResult.innerHTML = '';
  }
}

function stopTrainAutoRefresh() {
  if (trainAutoRefreshTimer) {
    clearInterval(trainAutoRefreshTimer);
    trainAutoRefreshTimer = null;
  }
  trainAutoRefreshTrainNumber = null;
  trainAutoRefreshOriginCode = null;
  trainAutoRefreshEpochMs = null;
  trainAutoRefreshInFlight = false;
  trainAutoRefreshLastSuccessAt = 0;
  if (trainAutoRefreshAbortController) {
    try {
      trainAutoRefreshAbortController.abort();
    } catch {
      // ignore
    }
    trainAutoRefreshAbortController = null;
  }
}

function startTrainAutoRefresh(trainNumber, originCode = '', epochMs = null) {
  const num = String(trainNumber || '').trim();
  const origin = String(originCode || '').trim();
  const epoch = Number.isFinite(Number(epochMs)) ? Number(epochMs) : null;
  if (!num) return;

  // Se stiamo già monitorando lo stesso treno, non ricreiamo il timer.
  if (trainAutoRefreshTrainNumber === num && trainAutoRefreshOriginCode === origin && trainAutoRefreshEpochMs === epoch && trainAutoRefreshTimer) return;

  stopTrainAutoRefresh();
  trainAutoRefreshTrainNumber = num;
  trainAutoRefreshOriginCode = origin;
  trainAutoRefreshEpochMs = epoch;

  trainAutoRefreshTimer = setInterval(() => {
    if (!trainAutoRefreshTrainNumber) return;
    if (document.hidden) return;
    if (trainAutoRefreshInFlight) return;
    cercaStatoTreno(trainAutoRefreshTrainNumber, {
      silent: true,
      isAuto: true,
      originCode: trainAutoRefreshOriginCode,
      epochMs: trainAutoRefreshEpochMs,
    });
  }, TRAIN_AUTO_REFRESH_INTERVAL_MS);
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    // In pausa: abortiamo l'eventuale richiesta in corso.
    if (trainAutoRefreshAbortController) {
      try {
        trainAutoRefreshAbortController.abort();
      } catch {
        // ignore
      }
      trainAutoRefreshAbortController = null;
    }
    trainAutoRefreshInFlight = false;
    return;
  }

  // Tornati visibili: se è passato più di 1 intervallo dall'ultimo successo, aggiorniamo subito.
  if (trainAutoRefreshTrainNumber) {
    const now = Date.now();
    const stale = !trainAutoRefreshLastSuccessAt || now - trainAutoRefreshLastSuccessAt >= TRAIN_AUTO_REFRESH_INTERVAL_MS;
    if (stale && !trainAutoRefreshInFlight) {
      cercaStatoTreno(trainAutoRefreshTrainNumber, {
        silent: true,
        isAuto: true,
        originCode: trainAutoRefreshOriginCode,
        epochMs: trainAutoRefreshEpochMs,
      });
    }
  }
});

function setStationLoadingDisplay() {
  if (!stationInfoContainer) return;
  stationInfoContainer.innerHTML = `
    <div class="station-info-header">
      <div>
        <p class="station-info-region-text loading-indicator">
          <span class="loading-indicator__spinner" aria-hidden="true"></span>
          <span>Caricamento info stazione…</span>
        </p>
      </div>
    </div>
  `;
  stationInfoContainer.classList.remove('hidden');
  if (stationBoardContainer) {
    stationBoardContainer.classList.remove('hidden');
  }
  if (stationBoardList) {
    stationBoardList.innerHTML = `
      <div class="station-board-loading loading-indicator loading-indicator--centered">
        <span class="loading-indicator__spinner" aria-hidden="true"></span>
        <span>Caricamento tabellone…</span>
      </div>
    `;
  }
}

async function loadStationByCode(name, code) {
  try {
    await ensureStationCanonicalLoaded();
  } catch {
    // ignore
  }
  const normalizedCode = normalizeStationCode(code);
  if (!normalizedCode) {
    console.warn('Codice stazione non valido per la selezione rapida:', code);
    return;
  }

  const displayName = resolveStationDisplayName(normalizedCode, name) || normalizedCode;
  
  if (typeof addRecentStation === 'function') {
    addRecentStation({ id: normalizedCode, name: displayName });
  }

  selectedStation = { name: displayName, code: normalizedCode };
  stationBoardActiveTab = 'departures';

  if (stationQueryInput) {
    stationQueryInput.value = displayName;
  }
  if (stationList) {
    stationList.innerHTML = '';
    stationList.hidden = true;
  }

  setStationLoadingDisplay();
  scrollToSection(stationSearchSection);
  setInlineError(stationError, '');

  try {
    const [infoRes, depRes, arrRes] = await Promise.all([
      fetch(`${API_BASE}/api/stations/info?stationCode=${encodeURIComponent(normalizedCode)}`),
      fetch(`${API_BASE}/api/stations/departures?stationCode=${encodeURIComponent(normalizedCode)}&when=now`),
      fetch(`${API_BASE}/api/stations/arrivals?stationCode=${encodeURIComponent(normalizedCode)}&when=now`),
    ]);

    const info = infoRes.ok ? await infoRes.json() : null;
    const dep = depRes.ok ? await depRes.json() : null;
    const arr = arrRes.ok ? await arrRes.json() : null;

    const infoPayload = info?.ok ? info : null;
    stationBoardData = {
      departures: dep?.ok ? dep.data || [] : [],
      arrivals: arr?.ok ? arr.data || [] : [],
    };

    if (infoPayload) {
      renderStationInfoContent(selectedStation, infoPayload);
    } else if (stationInfoContainer) {
      stationInfoContainer.classList.remove('hidden');
      stationInfoContainer.innerHTML = `<p class="small muted">Informazioni non disponibili per ${escapeHtml(displayName)}.</p>`;
    }

    renderStationBoard('departures');
  } catch (err) {
    console.error('Errore caricamento dati stazione:', err);
    resetStationDisplay();
    setInlineError(stationError, 'Errore nel recupero delle informazioni della stazione.');
  }
}

function renderStationInfoContent(selection, infoPayload) {
  if (!stationInfoContainer) return;
  const stationDetails = infoPayload?.station || {};
  const coords = resolveStationCoords(selection?.code, selection?.name, stationDetails);
  const hasCoords = !!coords;
  const mapsLink = hasCoords ? `https://www.google.com/maps?q=${coords.lat},${coords.lon}` : null;
  const stationCodes = getStationCodeCandidates(selection, stationDetails, infoPayload);
  void stationCodes;

  stationInfoContainer.classList.remove('hidden');
  stationInfoContainer.innerHTML = `
    ${hasCoords ? `
      <div class="map-widget" id="stationMapWidget">
        <div class="map-widget-head">
          ${mapsLink
            ? `<a href="${mapsLink}" target="_blank" rel="noopener noreferrer" class="station-maps-btn">
                <picture aria-hidden="true">
                  <source srcset="/img/maps_white.svg" media="(prefers-color-scheme: dark)" />
                  <img src="/img/maps_black.svg" alt="" class="station-maps-icon" aria-hidden="true" />
                </picture>
                Maps
              </a>`
            : ''}
          <button type="button" class="map-recenter-btn" data-map-action="recenter">
            <picture aria-hidden="true">
              <source srcset="/img/gps_white.svg" media="(prefers-color-scheme: dark)" />
              <img src="/img/gps_black.svg" alt="" class="map-recenter-icon" aria-hidden="true" />
            </picture>
            Ricentra
          </button>
        </div>
        <div class="mini-map station-mini-map map-widget-body" id="stationMiniMap"></div>
      </div>
    ` : `<p class="small muted">Coordinate non disponibili.</p>`}
  `;

  if (hasCoords) {
    const displayName = resolveStationDisplayName(selection?.code, selection?.name) || 'Stazione';
    const root = stationInfoContainer.querySelector('#stationMapWidget');
    attachMapWidget(
      root,
      [{ ...coords, label: displayName }],
      { mode: 'point', title: `Stazione: ${displayName}`, stationZoom: 15 }
    );
  }
}

function buildBoardDelayBadge(delay, isCancelled) {
  if (isCancelled) {
    return '<span class="board-delay board-delay--cancelled">Cancellato</span>';
  }
  if (delay == null) {
    return '<span class="board-delay board-delay--ontime">In orario</span>';
  }
  if (delay > 0) {
    return `<span class="board-delay board-delay--late">+${delay} min</span>`;
  }
  if (delay < 0) {
    return `<span class="board-delay board-delay--early">${delay} min</span>`;
  }
  return '<span class="board-delay board-delay--ontime">In orario</span>';
}

function getBoardTrack(entry, type) {
  const result = { label: '', isReal: false };

  const effective = type === 'departures'
    ? entry.binarioEffettivoPartenzaDescrizione || entry.binarioEffettivoPartenza || entry.binarioEffettivo
    : entry.binarioEffettivoArrivoDescrizione || entry.binarioEffettivoArrivo || entry.binarioEffettivo;

  if (effective) {
    result.label = effective;
    result.isReal = true;
    return result;
  }

  const planned = type === 'departures'
    ? entry.binarioProgrammatoPartenzaDescrizione || entry.binarioProgrammatoPartenza
    : entry.binarioProgrammatoArrivoDescrizione || entry.binarioProgrammatoArrivo;

  if (planned) {
    result.label = planned;
  }

  return result;
}

function buildStationBoardRow(entry, type) {
  const isDeparture = type === 'departures';
  const rawTime = isDeparture
    ? entry.compOrarioPartenzaZero || entry.orarioPartenza || entry.origineZero
    : entry.compOrarioArrivoZero || entry.orarioArrivo || entry.destinazioneZero;
  const timeLabel = formatBoardClock(rawTime);
  const epochMs = parseToMillis(rawTime);
  const datasetEpoch = epochMs != null ? escapeHtml(String(epochMs)) : '';
  const routeLabelRaw = isDeparture
    ? (entry.destinazione || entry.destinazioneBreve || entry.compDestinazione || '-')
    : (entry.provenienza || entry.origine || entry.compOrigine || '-');
  const routeLabel = resolveStationDisplayName('', routeLabelRaw) || routeLabelRaw || '-';
  
  // Usa dati computed dal backend quando disponibili
  const computed = entry._computed || {};
  const category = entry.categoria || entry.compTipologiaTreno || entry.tipoTreno || 'Treno';
  const compTrainCode = entry.compNumeroTreno || entry.siglaTreno || '';
  const numericTrainCode = entry.numeroTreno || (compTrainCode.match(/\d+/)?.[0] ?? '');
  
  // Se backend ha calcolato trainKind, usa quello, altrimenti fallback a calcolo locale
  const trainKindMeta = (computed && computed.trainKind)
    ? {
        boardLabel: computed.trainKind.code || computed.trainKind.label,
        number: numericTrainCode,
        className: computed.trainKind.category === 'high-speed' ? 'train-title--fr' :
                   computed.trainKind.category === 'intercity' ? 'train-title--ic' :
                   computed.trainKind.category === 'regional' ? 'train-title--reg' :
                   computed.trainKind.code === 'ITA' ? 'train-title--ita' : '',
      }
    : resolveTrainKindFromCode(
        compTrainCode,
        entry.compTipologiaTreno,
        entry.categoriaDescrizione,
        category
      );
  
  const displayTrainName = trainKindMeta?.boardLabel || category || 'Treno';
  const displayTrainNumber = trainKindMeta?.number || numericTrainCode || compTrainCode || '';
  const trainLabel = `${displayTrainName} ${displayTrainNumber}`.trim();
  
  // Usa delay computed se disponibile
  const delay = computed.delay != null ? computed.delay : resolveDelay(entry.ritardo, entry.compRitardo);
  
  const isCancelled = entry.cancellato === true || entry.cancellata === true || entry.soppresso === true;
  const trackInfo = getBoardTrack(entry, type);
  const delayBadge = buildBoardDelayBadge(delay, isCancelled);
  const destPrefix = isDeparture ? 'per ' : 'da ';
  const ariaLabel = `${trainLabel} ${destPrefix}${routeLabel}`.trim();
  const searchTrainNumber = trainKindMeta?.number || numericTrainCode || compTrainCode || '';
  const datasetNumber = escapeHtml(searchTrainNumber);
  const trackClass = trackInfo.isReal ? 'col-track-pill col-track-pill--real' : 'col-track-pill';
  const boardTrainClass = trainKindMeta?.className || '';

  // New Layout mimicking solution-card
  return `
    <div class="station-board-card" role="button" tabindex="0" data-train-number="${datasetNumber}" data-epoch-ms="${datasetEpoch}" aria-label="${escapeHtml(ariaLabel)}">
      <div class="sb-row-main">
        <div class="sb-time-col">
            <div class="sb-time">${escapeHtml(timeLabel)}</div>
            ${delayBadge}
        </div>
        <div class="sb-info-col">
            <div class="sb-destination">${destPrefix}${escapeHtml(routeLabel)}</div>
            <div class="sb-train-info">
                <span class="sb-train-name ${boardTrainClass}">${escapeHtml(trainLabel)}</span>
            </div>
        </div>
      </div>
      <div class="sb-row-meta">
         ${trackInfo.label ? `<span class="${trackClass}">${escapeHtml(trackInfo.label)}</span>` : ''}
      </div>
    </div>
  `;
}

function renderStationBoard(view = 'departures') {
  if (!stationBoardContainer || !stationBoardList) return;
  stationBoardActiveTab = view;
  stationBoardContainer.classList.remove('hidden');
  stationBoardTabs.forEach((btn) => {
    const isActive = btn.dataset.board === view;
    btn.classList.toggle('is-active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

    const dataList = view === 'arrivals'
      ? (stationBoardData.arrivals || [])
      : (stationBoardData.departures || []);

  if (!Array.isArray(dataList) || dataList.length === 0) {
    stationBoardList.innerHTML = '<p class="station-board-empty">Nessuna corsa disponibile.</p>';
    return;
  }

  const rows = dataList.slice(0, 12).map((entry) => buildStationBoardRow(entry, view)).join('');
  stationBoardList.innerHTML = rows;
}

// AUTOCOMPLETE STAZIONI (ViaggiaTreno - Cerca Stazione) ----------------

async function fetchStations(query) {
  const q = query.trim();
  if (q.length < 2) {
    stationList.innerHTML = '';
    stationList.hidden = true;
    setInlineError(stationError, '');
    return;
  }

  try {
    await ensureStationIndexLoaded();
    const matches = findStationsLocal(q, 12);
    renderStationList(matches);
    setInlineError(stationError, matches.length ? '' : 'Nessuna stazione trovata.');
  } catch (err) {
    console.error('Errore autocomplete stazioni:', err);
    stationList.innerHTML = '';
    stationList.hidden = true;
    setInlineError(stationError, 'Errore nel caricamento dell\'indice stazioni.');
  }
}

const debouncedFetchStations = debounce(fetchStations, 250);

function renderStationList(items) {
  if (!Array.isArray(items) || items.length === 0) {
    stationList.innerHTML = '';
    stationList.hidden = true;
    return;
  }

  const parts = items.map(item => {
    const name = (item.name || item.nome || item.stazione || '').toString();
    const code = (item.code || item.id || item.idStazione || '').toString();
    const safeName = escapeHtml(name);
    const safeCode = escapeHtml(code);
    return `<li data-code="${safeCode}" data-name="${safeName}">${safeName} <span class="muted">(${safeCode})</span></li>`;
  });

  stationList.innerHTML = parts.join('');
  stationList.hidden = false;
}

stationQueryInput.addEventListener('input', (e) => {
  selectedStation = null;
  resetStationDisplay();
  setInlineError(stationError, '');
  debouncedFetchStations(e.target.value || '');
});

if (stationClearBtn) {
  stationClearBtn.addEventListener('click', () => {
    clearStationSearch();
    stationQueryInput?.focus();
  });
}

if (stationSearchBtn) {
  stationSearchBtn.addEventListener('click', async () => {
    const q = stationQueryInput.value.trim();
    if (!q) return;
    setInlineError(stationError, '');
    
    try {
      await ensureStationIndexLoaded();
      const matches = findStationsLocal(q, 1);
      if (matches.length > 0) {
        const first = matches[0];
        const name = first.name || first.stazione || '';
        const code = first.code || first.idStazione || '';
        if (name && code) {
          await loadStationByCode(name, code);
          return;
        }
      }
      setInlineError(stationError, 'Nessuna stazione trovata.');
    } catch (err) {
      console.error('Errore ricerca stazione manuale:', err);
      setInlineError(stationError, 'Errore nel caricamento dell\'indice stazioni.');
    }
  });
}

stationList.addEventListener('click', async (e) => {
  const li = e.target.closest('li');
  if (!li) return;

  const name = li.getAttribute('data-name') || '';
  const code = li.getAttribute('data-code') || '';
  await loadStationByCode(name, code);
});

if (stationBoardContainer) {
  stationBoardContainer.addEventListener('click', (e) => {
    const tab = e.target.closest('.station-board-tab');
    if (!tab) return;
    const view = tab.dataset.board === 'arrivals' ? 'arrivals' : 'departures';
    if (view === stationBoardActiveTab) return;
    renderStationBoard(view);
  });
}

if (stationBoardList) {
  const activateStationBoardRow = (row) => {
    if (!row) return;
    const trainNum = row.getAttribute('data-train-number') || '';
    if (!trainNum) return;
    const epochMsRaw = (row.getAttribute('data-epoch-ms') || '').trim();
    const epochMs = Number.isFinite(Number(epochMsRaw)) ? Number(epochMsRaw) : null;
    if (trainNumberInput) {
      trainNumberInput.value = trainNum;
    }
    cercaStatoTreno(trainNum, { useRememberedChoice: true, epochMs });
    scrollToSection(trainSearchSection);
  };

  stationBoardList.addEventListener('click', (e) => {
    const row = e.target.closest('.station-board-card');
    if (!row) return;
    activateStationBoardRow(row);
  });

  stationBoardList.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest('.station-board-card');
    if (!row) return;
    e.preventDefault();
    activateStationBoardRow(row);
  });
}

if (trainResult) {
  const activateStationShortcut = (node) => {
    if (!node) return;
    const encodedName = node.getAttribute('data-station-name') || '';
    const encodedCode = node.getAttribute('data-station-code') || '';
    const name = decodeDatasetValue(encodedName) || node.textContent?.trim() || '';
    const code = decodeDatasetValue(encodedCode);
    if (!code) return;
    loadStationByCode(name, code);
  };

  trainResult.addEventListener('click', (e) => {
    const target = e.target.closest('.station-stop-trigger');
    if (!target) return;
    e.preventDefault();
    activateStationShortcut(target);
  });

  trainResult.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target.closest('.station-stop-trigger');
    if (!target) return;
    e.preventDefault();
    activateStationShortcut(target);
  });
}


document.addEventListener('click', (e) => {
  if (e.target === stationQueryInput || stationList.contains(e.target)) return;
  stationList.innerHTML = '';
  stationList.hidden = true;
});

// UX: evita che i bottoni restino "selezionati" (focus) dopo click/tap.
// Quando un elemento viene rimosso dal DOM (es. chip preferiti), il focus può
// spostarsi sul successivo e dare l'impressione di selezione persistente.
// Applichiamo blur solo per interazioni pointer (mouse/touch), non da tastiera.
let lastInteractionWasPointer = false;

document.addEventListener(
  'pointerdown',
  () => {
    lastInteractionWasPointer = true;
  },
  true
);

document.addEventListener(
  'keydown',
  (e) => {
    // Se l'utente naviga con tastiera, non forziamo blur.
    if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') {
      lastInteractionWasPointer = false;
    }
  },
  true
);

document.addEventListener(
  'click',
  (e) => {
    if (!lastInteractionWasPointer) return;

    // Non togliere focus ai campi di input (serve per scrivere/navigare).
    if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;

    // Se l'utente ha cliccato/tappato un controllo interattivo, dopo l'azione
    // rimuovi il focus per evitare "selezioni" che restano dopo re-render/rimozioni.
    const clickedInteractive = e.target.closest(
      'button, a[href], summary, [role="button"], [tabindex]:not([tabindex="-1"])'
    );
    if (!clickedInteractive) return;

    const active = document.activeElement;
    if (!active || active === document.body) return;

    // Evita di "buttare fuori" il focus da input, se per qualche ragione fosse finito lì.
    if (active.closest && active.closest('input, textarea, select, [contenteditable="true"]')) return;

    if (typeof active.blur === 'function') active.blur();
  },
  true
);

// --- AUTOCOMPLETE SOLUZIONI (FROM / TO) ---------------------------------
// (Logica rimossa in favore di setupTripAutocomplete)


function buildIsoDateTime(dateStr, timeStr) {
  if (!dateStr) return null; // meglio bloccare prima

  const [year, month, day] = dateStr.split('-').map((x) => Number(x));
  if (!year || !month || !day) return null;

  let hours = 0;
  let minutes = 0;

  if (timeStr) {
    const parts = timeStr.split(':').map((x) => Number(x));
    if (parts.length >= 2) {
      hours = parts[0];
      minutes = parts[1];
    }
  }

  const d = new Date(year, month - 1, day, hours, minutes, 0);
  // Lefrecce usava stringhe tipo "2025-12-04T18:00:00.000"
  const iso = d.toISOString(); // "2025-12-04T17:00:00.000Z"
  // Per stare larghi, la lasciamo così lato backend e la aggiustiamo lì se serve
  return iso;
}


// RECENTI & PREFERITI ------------------------------------------------

const TRIP_RECENT_KEY = 'treninfo_recent_trips';
const STATION_RECENT_KEY = 'treninfo_recent_stations';
const TRIP_FAVORITES_KEY = 'treninfo_favorite_trips';
const STATION_FAVORITES_KEY = 'treninfo_favorite_stations';

const trainStorageContainer = document.getElementById('trainStorage');
const tripStorageContainer = document.getElementById('tripStorage');
const stationStorageContainer = document.getElementById('stationStorage');

// --- GENERIC STORAGE HELPERS ---

function loadStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveStorage(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch (e) {
    console.warn('Storage save failed', e);
  }
}

function addToStorage(key, item, uniqueKey = 'id', maxItems = MAX_RECENT) {
  const list = loadStorage(key);
  const filtered = list.filter(i => String(i[uniqueKey]) !== String(item[uniqueKey]));
  filtered.unshift(item);
  const trimmed = filtered.slice(0, Math.max(1, Number(maxItems) || MAX_RECENT));
  saveStorage(key, trimmed);
  return trimmed;
}

function removeFromStorage(key, uniqueVal, uniqueKey = 'id') {
  const list = loadStorage(key);
  const filtered = list.filter(i => String(i[uniqueKey]) !== String(uniqueVal));
  saveStorage(key, filtered);
  return filtered;
}

// --- RENDER CHIPS ---

function renderChips(container, list, type, onSelect, onRemove, onToggleFav, isFavCallback) {
  if (!container) return;

  const showFav = typeof onToggleFav === 'function';
  
  if (!list || list.length === 0) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }
  
  container.classList.remove('hidden');
  container.innerHTML = list.map((item, idx) => {
    let contentHtml = '';
    let icon = '';
    let id = '';
    let extraClass = '';
    
    if (type === 'train') {
      id = item.numero;
      // No icon for trains as requested
      const route = (item.origine && item.destinazione) 
        ? `${item.origine} → ${item.destinazione}` 
        : `Treno ${item.numero}`;

      const rawKindCode = (item.kindCode || item.kind || item.sigla || '').toString().trim().toUpperCase();
      const kindCode = /^[A-Z]{1,4}$/.test(rawKindCode) ? rawKindCode : '';
      const numberLabel = kindCode ? `${kindCode} ${item.numero}` : `Treno ${item.numero}`;
      
      const timeInfo = item.partenza ? `<span class="chip-time">${item.partenza}</span>` : '';
      
      contentHtml = `
        <div class="chip-train-info">
            <div class="chip-route">${escapeHtml(route)}</div>
            <div class="chip-meta">
                <span class="chip-number">${escapeHtml(numberLabel)}</span>
                ${timeInfo}
            </div>
        </div>
      `;
      extraClass = 'chip-type-train';

    } else if (type === 'trip') {
      id = `${item.from}|${item.to}`;
      contentHtml = `<span class="storage-chip-label">${escapeHtml(item.from)} → ${escapeHtml(item.to)}</span>`;
    } else if (type === 'station') {
      id = item.id;
      contentHtml = `<span class="storage-chip-label">${escapeHtml(item.name)}</span>`;
    }

    const isFav = isFavCallback ? isFavCallback(item) : false;
    
    return `
      <div class="storage-chip ${isFav ? 'favorite' : ''} ${extraClass}" role="button" tabindex="0" data-id="${escapeHtml(id)}">
        <div class="storage-chip-actions">
            ${showFav ? `
              <button type="button" class="storage-chip-btn storage-chip-fav ${isFav ? 'is-active' : ''}" title="${isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}" aria-label="${isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}">
                  <span class="storage-chip-fav-glyph" aria-hidden="true">${isFav ? '♥' : '♡'}</span>
              </button>
            ` : ''}
        </div>
        <span class="storage-chip-content">
            ${contentHtml}
        </span>
      </div>
    `;
  }).join('');
  
  // Add event listeners
  container.querySelectorAll('.storage-chip').forEach((chip, idx) => {
    const item = list[idx];
    const isFavNow = isFavCallback ? isFavCallback(item) : false;

    // Swipe SOLO sui recenti (non preferiti): verso sinistra per eliminare.
    if (!isFavNow && typeof onRemove === 'function') {
      attachSwipeToStorageChip(chip, {
        onDelete: () => onRemove(item),
      });
    }

    chip.addEventListener('click', (e) => {
      if (chip.__swipeSkipClick) {
        chip.__swipeSkipClick = false;
        return;
      }
      const favBtn = e.target.closest('.storage-chip-fav');
      
      if (favBtn) {
        e.stopPropagation();
        if (showFav) onToggleFav(list[idx]);
      } else {
        onSelect(list[idx]);
      }
    });
  });
}

function attachSwipeToStorageChip(chip, { onDelete }) {
  if (!chip) return;

  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastT = 0;
  let pointerId = null;
  let lockedAxis = null; // 'x' | 'y' | null
  let dragging = false;
  let dx = 0;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const resetVisual = () => {
    chip.classList.remove('is-swiping', 'swipe-ready-delete', 'swipe-ready-fav');
    chip.style.transition = '';
    chip.style.transform = '';
    chip.style.removeProperty('--swipe-pct');
  };

  const setDx = (nextDx) => {
    dx = nextDx;
    chip.style.transform = `translateX(${dx}px)`;
    chip.classList.toggle('swipe-ready-delete', dx < -72);
    // Feedback progressivo (0..1) per indicator "Elimina".
    const pct = Math.max(0, Math.min(1, Math.abs(dx) / 72));
    chip.style.setProperty('--swipe-pct', String(pct));
  };

  // Indicator "Elimina" (visual feedback)
  if (!chip.querySelector('.swipe-delete-indicator')) {
    const el = document.createElement('span');
    el.className = 'swipe-delete-indicator';
    el.setAttribute('aria-hidden', 'true');
    el.textContent = 'Elimina';
    chip.appendChild(el);
  }

  const onPointerDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    // Evita conflitti con click sul cuore
    if (e.target && e.target.closest && e.target.closest('.storage-chip-btn')) return;
    if (!e.isPrimary) return;

    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    lastX = e.clientX;
    lastT = performance.now();
    lockedAxis = null;
    dragging = false;
    dx = 0;

    try {
      chip.setPointerCapture(pointerId);
    } catch {
      // ignore
    }
  };

  const onPointerMove = (e) => {
    if (pointerId == null || e.pointerId !== pointerId) return;

    const now = performance.now();
    const moveX = e.clientX - startX;
    const moveY = e.clientY - startY;

    if (!lockedAxis) {
      const ax = Math.abs(moveX);
      const ay = Math.abs(moveY);
      if (ax < 6 && ay < 6) return;
      lockedAxis = ax > ay ? 'x' : 'y';
    }

    if (lockedAxis !== 'x') return;

    // Ora stiamo swipando: blocca il click successivo
    dragging = true;
    chip.__swipeSkipClick = true;
    chip.classList.add('is-swiping');

    // Evita scroll orizzontale/ghost click
    e.preventDefault();

    // Swipe solo a sinistra.
    const capped = clamp(moveX, -120, 0);
    setDx(capped);

    lastX = e.clientX;
    lastT = now;
  };

  const finish = (e) => {
    if (pointerId == null || (e && e.pointerId !== pointerId)) return;

    try {
      chip.releasePointerCapture(pointerId);
    } catch {
      // ignore
    }

    const shouldDelete = dx < -72 && typeof onDelete === 'function';

    chip.style.transition = 'transform 0.18s ease';

    if (dragging && shouldDelete) {
      const out = -window.innerWidth;
      chip.style.transform = `translateX(${out}px)`;
      window.setTimeout(() => {
        onDelete();
      }, 140);
    } else {
      // torna in posizione
      chip.style.transform = 'translateX(0px)';
      window.setTimeout(() => {
        resetVisual();
      }, 190);
    }

    pointerId = null;
    lockedAxis = null;
    dragging = false;
    dx = 0;
  };

  chip.addEventListener('pointerdown', onPointerDown, { passive: true });
  chip.addEventListener('pointermove', onPointerMove, { passive: false });
  chip.addEventListener('pointerup', finish, { passive: true });
  chip.addEventListener('pointercancel', finish, { passive: true });
}

function renderGroupedChips(container, groups, type, onSelect, onRemove, onToggleFav, isFavCallback) {
  if (!container) return;
  const favorites = Array.isArray(groups?.favorites) ? groups.favorites : [];
  const recents = Array.isArray(groups?.recents) ? groups.recents : [];
  const sections = [];

  if (favorites.length) sections.push({ title: 'Preferiti', items: favorites });
  if (recents.length) sections.push({ title: 'Recenti', items: recents });

  if (!sections.length) {
    container.innerHTML = '';
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');

  const allItems = [];
  const showFav = typeof onToggleFav === 'function';

  const renderOne = (item, idx) => {
    let contentHtml = '';
    let id = '';
    let extraClass = '';

    if (type === 'train') {
      id = item.numero;
      const route = (item.origine && item.destinazione)
        ? `${item.origine} → ${item.destinazione}`
        : `Treno ${item.numero}`;

      const rawKindCode = (item.kindCode || item.kind || item.sigla || '').toString().trim().toUpperCase();
      const kindCode = /^[A-Z]{1,4}$/.test(rawKindCode) ? rawKindCode : '';
      const numberLabel = kindCode ? `${kindCode} ${item.numero}` : `Treno ${item.numero}`;
      const timeInfo = item.partenza ? `<span class="chip-time">${escapeHtml(item.partenza)}</span>` : '';

      contentHtml = `
        <div class="chip-train-info">
            <div class="chip-route">${escapeHtml(route)}</div>
            <div class="chip-meta">
                <span class="chip-number">${escapeHtml(numberLabel)}</span>
                ${timeInfo}
            </div>
        </div>
      `;
      extraClass = 'chip-type-train';
    } else if (type === 'trip') {
      id = `${item.from}|${item.to}`;
      contentHtml = `<span class="storage-chip-label">${escapeHtml(item.from)} → ${escapeHtml(item.to)}</span>`;
    } else if (type === 'station') {
      id = item.id;
      contentHtml = `<span class="storage-chip-label">${escapeHtml(item.name)}</span>`;
    }

    const isFav = isFavCallback ? isFavCallback(item) : false;

    return `
      <div class="storage-chip ${isFav ? 'favorite' : ''} ${extraClass}" role="button" tabindex="0" data-idx="${idx}" data-id="${escapeHtml(id)}">
        <div class="storage-chip-actions">
          ${showFav ? `
            <button type="button" class="storage-chip-btn storage-chip-fav ${isFav ? 'is-active' : ''}" title="${isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}" aria-label="${isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}">
              <span class="storage-chip-fav-glyph" aria-hidden="true">${isFav ? '♥' : '♡'}</span>
            </button>
          ` : ''}
        </div>
        <span class="storage-chip-content">${contentHtml}</span>
      </div>
    `;
  };

  let nextIdx = 0;
  const sectionsHtml = sections.map((section) => {
    const chipsHtml = section.items.map((item) => {
      const idx = nextIdx;
      allItems[idx] = item;
      nextIdx += 1;
      return renderOne(item, idx);
    }).join('');

    return `
      <div class="storage-block">
        <div class="storage-block-head">
          <div class="storage-block-title">${escapeHtml(section.title)}</div>
          <div class="storage-block-count">${section.items.length}</div>
        </div>
        <div class="storage-block-list">${chipsHtml}</div>
      </div>
    `;
  }).join('');

  container.innerHTML = sectionsHtml;

  container.querySelectorAll('.storage-chip').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      if (chip.__swipeSkipClick) {
        chip.__swipeSkipClick = false;
        return;
      }
      const favBtn = e.target.closest('.storage-chip-fav');
      const idx = Number(chip.getAttribute('data-idx'));
      const item = allItems[idx];
      if (!item) return;

      if (favBtn) {
        e.stopPropagation();
        if (showFav) onToggleFav(item);
      } else {
        onSelect(item);
      }
    });

    // Swipe SOLO sui recenti (non preferiti): verso sinistra per eliminare.
    const idx = Number(chip.getAttribute('data-idx'));
    const item = allItems[idx];
    if (!item) return;
    const isFavNow = isFavCallback ? isFavCallback(item) : false;
    if (!isFavNow && typeof onRemove === 'function') {
      attachSwipeToStorageChip(chip, {
        onDelete: () => onRemove(item),
      });
    }
  });
}

function normalizeTripList(rawList) {
  if (!Array.isArray(rawList)) return [];
  const out = [];
  for (const raw of rawList) {
    if (!raw) continue;
    const from = String(raw.from || '').trim();
    const to = String(raw.to || '').trim();
    if (!from || !to) continue;
    const id = `${from}|${to}`;
    out.push({ id, from, to });
  }
  return out;
}

// --- TRAIN STORAGE ---

function buildFavoriteButtonInnerHtml(isFavorite) {
  const label = isFavorite ? 'Rimuovi dai preferiti' : 'Salva nei preferiti';
  const glyph = isFavorite ? '♥' : '♡';
  return `<span class="favorite-btn-heart" aria-hidden="true">${glyph}</span><span class="favorite-btn-text">${escapeHtml(label)}</span>`;
}

function updateTrainStorage() {
  const recents = loadStorage(RECENT_KEY);
  const favorites = loadStorage(FAVORITES_KEY);
  
  // Preferiti prima dei recenti (più naturale). De-duplica per numero.
  const favIds = new Set(favorites.map(i => String(i.numero)));
  const uniqueRecents = recents.filter(i => !favIds.has(String(i.numero)));

  renderGroupedChips(trainStorageContainer, { favorites, recents: uniqueRecents }, 'train',
    (item) => {
      trainNumberInput.value = item.numero;
      cercaStatoTreno(String(item.numero || '').trim(), { useRememberedChoice: true });
    }, 
    (item) => {
      // Remove
      if (favIds.has(String(item.numero))) {
         const newFavs = removeFromStorage(FAVORITES_KEY, item.numero, 'numero');
      } else {
         const newRecents = removeFromStorage(RECENT_KEY, item.numero, 'numero');
      }
      updateTrainStorage();
    },
    (item) => {
      // Toggle Fav
      const isFav = favIds.has(String(item.numero));
      if (isFav) {
        removeFromStorage(FAVORITES_KEY, item.numero, 'numero');
        // Add back to recents if not there? It's probably there or we should add it
        addToStorage(RECENT_KEY, item, 'numero', MAX_RECENT);
      } else {
        addToStorage(FAVORITES_KEY, item, 'numero', MAX_FAVORITES);
      }
      updateTrainStorage();
    },
    (item) => favIds.has(String(item.numero))
  );
}

function addRecentTrain(details) {
  if (!details || !details.numero) return;
  addToStorage(RECENT_KEY, {
    numero: details.numero,
    origine: details.origine,
    destinazione: details.destinazione,
    partenza: details.partenza,
    arrivo: details.arrivo,
    kindCode: details.kindCode || ''
  }, 'numero', MAX_RECENT);
  updateTrainStorage();
}

function isFavoriteTrain(numero) {
  const list = loadStorage(FAVORITES_KEY);
  return list.some(t => String(t.numero) === String(numero));
}

function toggleFavoriteTrain(data) {
  if (!data || !data.numero) return;
  const isFav = isFavoriteTrain(data.numero);
  if (isFav) {
    removeFromStorage(FAVORITES_KEY, data.numero, 'numero');
    // Ensure it's in recents so it doesn't disappear completely if it was just viewed
    addToStorage(RECENT_KEY, data, 'numero', MAX_RECENT);
  } else {
    addToStorage(FAVORITES_KEY, data, 'numero', MAX_FAVORITES);
  }
  updateTrainStorage();
}

function updateFavoriteActionButton(btn) {
  if (!btn) return;
  const num = btn.getAttribute('data-num');
  const isFav = isFavoriteTrain(num);
  btn.classList.toggle('is-active', isFav);
  btn.innerHTML = buildFavoriteButtonInnerHtml(isFav);
}

// --- TRIP STORAGE ---

function updateTripStorage() {
  const recents = normalizeTripList(loadStorage(TRIP_RECENT_KEY));
  const favorites = normalizeTripList(loadStorage(TRIP_FAVORITES_KEY));

  // Migrazione soft: assicura che in storage ci sia sempre la forma {id,from,to}
  saveStorage(TRIP_RECENT_KEY, recents);
  saveStorage(TRIP_FAVORITES_KEY, favorites);

  const favIds = new Set(favorites.map(i => `${i.from}|${i.to}`));
  const uniqueRecents = recents.filter(i => !favIds.has(`${i.from}|${i.to}`));

  renderGroupedChips(tripStorageContainer, { favorites, recents: uniqueRecents }, 'trip',
    (item) => {
      tripFromInput.value = item.from;
      tripToInput.value = item.to;
      // Optional: trigger search automatically?
      // tripSearchBtn.click();
    },
    (item) => {
      const id = `${item.from}|${item.to}`;
      if (favIds.has(id)) {
        removeFromStorage(TRIP_FAVORITES_KEY, id, 'id');
      } else {
        removeFromStorage(TRIP_RECENT_KEY, id, 'id');
      }
      updateTripStorage();
    },
    (item) => {
      const id = `${item.from}|${item.to}`;
      const normalized = { ...item, id };
      const isFav = favIds.has(id);
      if (isFav) {
        removeFromStorage(TRIP_FAVORITES_KEY, id, 'id');
        addToStorage(TRIP_RECENT_KEY, normalized, 'id', MAX_RECENT);
      } else {
        addToStorage(TRIP_FAVORITES_KEY, normalized, 'id', MAX_FAVORITES);
      }
      updateTripStorage();
    },
    (item) => favIds.has(`${item.from}|${item.to}`)
  );
}

function addRecentTrip(from, to) {
  if (!from || !to) return;
  const id = `${from}|${to}`;
  addToStorage(TRIP_RECENT_KEY, { id, from, to }, 'id', MAX_RECENT);
  updateTripStorage();
}

// --- STATION STORAGE ---

function updateStationStorage() {
  const recents = loadStorage(STATION_RECENT_KEY);
  const favorites = loadStorage(STATION_FAVORITES_KEY);
  const favIds = new Set(favorites.map(i => String(i.id)));
  const uniqueRecents = recents.filter(i => !favIds.has(String(i.id)));

  renderGroupedChips(stationStorageContainer, { favorites, recents: uniqueRecents }, 'station',
    (item) => {
      const input = document.getElementById('stationQuery');
      if (input) {
        input.value = item.name;
        // Trigger search
        loadStationByCode(item.name, item.id);
      }
    },
    (item) => {
      if (favIds.has(String(item.id))) {
        removeFromStorage(STATION_FAVORITES_KEY, item.id, 'id');
      } else {
        removeFromStorage(STATION_RECENT_KEY, item.id, 'id');
      }
      updateStationStorage();
    },
    (item) => {
      const isFav = favIds.has(String(item.id));
      if (isFav) {
        removeFromStorage(STATION_FAVORITES_KEY, item.id, 'id');
        addToStorage(STATION_RECENT_KEY, item, 'id', MAX_RECENT);
      } else {
        addToStorage(STATION_FAVORITES_KEY, item, 'id', MAX_FAVORITES);
      }
      updateStationStorage();
    },
    (item) => favIds.has(String(item.id))
  );
}

function addRecentStation(station) {
  if (!station || !station.name) return;
  addToStorage(STATION_RECENT_KEY, { id: station.id, name: station.name }, 'id', MAX_RECENT);
  updateStationStorage();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  updateTrainStorage();
  updateTripStorage();
  updateStationStorage();
  ensureStationIndexLoaded();
});

// Old init calls removed
// renderFavoriteTrains();
// renderRecentTrains();

if (trainResult) {
  trainResult.addEventListener('click', (e) => {
    const notifBtn = e.target.closest('.notification-current-btn');
    if (notifBtn) {
      e.preventDefault();
      if (notifBtn.disabled) return;

      const num = (notifBtn.getAttribute('data-num') || '').trim();
      const originCode = decodeDatasetValue(notifBtn.getAttribute('data-origin-code') || '');
      const technical = decodeDatasetValue(notifBtn.getAttribute('data-technical') || '');
      const epochRaw = decodeDatasetValue(notifBtn.getAttribute('data-epoch-ms') || '');
      const epochMs = Number.isFinite(Number(epochRaw)) ? Number(epochRaw) : null;

      (async () => {
        const permission = await ensureBrowserNotificationPermission();
        if (permission !== 'granted') {
          notifBtn.textContent = permission === 'denied' ? 'Notifiche bloccate' : 'Attiva notifiche';
          return;
        }

        const target = buildTrainNotificationTarget({ trainNumber: num, originCode, technical, epochMs });
        if (!target) return;

        const settings = loadTrainNotificationsSettings();
        const savedKey = trainNotificationTargetKey(settings.target);
        const currentKey = trainNotificationTargetKey(target);
        const isActiveForThis = settings.enabled && savedKey && currentKey === savedKey;

        if (isActiveForThis) {
          saveTrainNotificationsSettings({ enabled: false, target: null, lastDigest: '', lastNotifiedAt: 0 });
          notifBtn.classList.remove('is-active');
          notifBtn.textContent = 'Attiva notifiche';
        } else {
          const digest = lastRenderedTrainStatusPayload ? computeTrainNotificationDigest(lastRenderedTrainStatusPayload) : '';
          saveTrainNotificationsSettings({ enabled: true, target, lastDigest: digest || '', lastNotifiedAt: 0 });
          notifBtn.classList.add('is-active');
          notifBtn.textContent = 'Notifiche attive';
        }
      })();

      return;
    }

    const favBtn = e.target.closest('.favorite-current-btn');
    if (favBtn) {
      const data = {
        numero: favBtn.getAttribute('data-num') || '',
        kindCode: decodeDatasetValue(favBtn.getAttribute('data-kind') || ''),
        origine: decodeDatasetValue(favBtn.getAttribute('data-orig') || ''),
        destinazione: decodeDatasetValue(favBtn.getAttribute('data-dest') || ''),
        partenza: decodeDatasetValue(favBtn.getAttribute('data-dep') || ''),
        arrivo: decodeDatasetValue(favBtn.getAttribute('data-arr') || ''),
      };
      toggleFavoriteTrain(data);
      updateFavoriteActionButton(favBtn);
    }
  });
}

// LOGICA STATO TRENO --------------------------------------------------

function getTrainKindInfo(d) {
  const metadata = resolveTrainKindFromCode(
    d.compNumeroTreno,
    d.siglaTreno,
    d.compTipologiaTreno,
    d.categoriaDescrizione,
    d.tipoTreno
  );

  if (metadata) {
    return { label: metadata.detailLabel, kindClass: metadata.className };
  }

  const rawType = (d.compNumeroTreno || '').toString().toUpperCase();
  if (!rawType) return { label: '', kindClass: '' };
  return { label: rawType, kindClass: '' };
}

function getTrainKindShortCode(d) {
  const metadata = resolveTrainKindFromCode(
    d?.compNumeroTreno,
    d?.siglaTreno,
    d?.compTipologiaTreno,
    d?.categoriaDescrizione,
    d?.tipoTreno
  );

  const direct = (metadata?.shortCode || '').toString().trim().toUpperCase();
  if (/^[A-Z]{1,4}$/.test(direct)) {
    // Tutte le sigle che iniziano per R (es. RXP) le trattiamo come REG (escluso RJ).
    if (direct.startsWith('R') && direct !== 'RJ') return 'REG';
    return direct;
  }

  const detail = (metadata?.detailLabel || '').toString().toUpperCase();
  const board = (metadata?.boardLabel || '').toString().toUpperCase();

  if (detail.includes('INTERCITY NOTTE') || board.includes('INTERCITY NOTTE')) return 'ICN';
  if (detail.includes('EUROCITY') || board.includes('EUROCITY')) return 'EC';
  if (detail.includes('EURONIGHT') || board.includes('EURONIGHT')) return 'EN';
  if (detail.includes('INTERCITY') || board.includes('INTERCITY')) return 'IC';
  if (detail.includes('REGIOEXPRESS') || board.includes('REGIOEXPRESS')) return 'REX';
  if (detail.includes('LEONARDO') || board.includes('LEONARDO')) return 'LEX';
  if (detail.includes('INTERREGIONALE') || board.includes('INTERREGIONALE')) return 'IREG';
  if (detail.includes('BUS') || board.includes('BUS')) return 'BUS';
  if (detail.includes('FRECCIAROSSA') || board.includes('FRECCIAROSSA')) return 'FR';
  if (detail.includes('FRECCIARGENTO') || board.includes('FRECCIARGENTO')) return 'FA';
  if (detail.includes('FRECCIABIANCA') || board.includes('FRECCIABIANCA')) return 'FB';
  if (detail.includes('REGIONALE VELOCE') || board.includes('REGIONALE VELOCE')) return 'RV';
  if (detail.includes('REGIONALE') || board.includes('REGIONALE')) return 'REG';

  return '';
}

function getLastRealStopIndex(fermate) {
  const hasAnyRealDeparture = fermate.some((f) => parseToMillis(f?.partenzaReale) != null);
  let last = -1;
  fermate.forEach((f, i) => {
    const arrRealMs = parseToMillis(f?.arrivoReale) ?? (hasAnyRealDeparture ? parseToMillis(f?.effettiva) : null);
    const depRealMs = parseToMillis(f?.partenzaReale);
    if (arrRealMs || depRealMs) last = i;
  });
  return last;
}

function getLastDepartedStopIndex(fermate) {
  const hasAnyRealDeparture = fermate.some((f) => parseToMillis(f?.partenzaReale) != null);
  let last = -1;
  const finalIdx = fermate.length - 1;
  fermate.forEach((f, i) => {
    const depRealMs = parseToMillis(f?.partenzaReale);
    if (depRealMs) {
      last = i;
      return;
    }
    if (i === finalIdx && hasAnyRealDeparture) {
      const arrRealMs = parseToMillis(f?.arrivoReale) ?? parseToMillis(f?.effettiva);
      if (arrRealMs) last = i;
    }
  });
  return last;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function pickFirstValidTime(...values) {
  for (const raw of values) {
    if (raw == null) continue;
    const ms = parseToMillis(raw);
    if (ms != null) return ms;
  }
  return null;
}

function romanToInt(roman) {
  const s = String(roman || '').toUpperCase();
  if (!s) return null;
  // Validazione roman numeral standard (1..3999)
  if (!/^(M{0,3})(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(s)) {
    return null;
  }

  const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  let prev = 0;
  for (let i = s.length - 1; i >= 0; i -= 1) {
    const val = values[s[i]];
    if (!val) return null;
    if (val < prev) total -= val;
    else {
      total += val;
      prev = val;
    }
  }
  return total;
}

function normalizeTrackLabel(label) {
  const raw = String(label || '').trim();
  if (!raw) return '';

  // Converte solo un numerale romano iniziale (es. "XV", "IV Est")
  const match = raw.match(/^([IVXLCDM]+)\b(.*)$/i);
  if (!match) return raw;
  const romanToken = match[1];
  const rest = match[2] || '';
  const parsed = romanToInt(romanToken);
  if (parsed == null) return raw;
  return `${parsed}${rest}`.trim();
}

function extractTrackInfo(stop) {
  if (!stop) {
    return { label: '', isReal: false, planned: '', actual: '' };
  }

  const actualRaw = stop.binarioEffettivoArrivoDescrizione ||
    stop.binarioEffettivoPartenzaDescrizione ||
    stop.binarioEffettivoArrivo ||
    stop.binarioEffettivoPartenza ||
    '';

  const plannedRaw = stop.binarioProgrammatoArrivoDescrizione ||
    stop.binarioProgrammatoPartenzaDescrizione ||
    stop.binarioProgrammatoArrivo ||
    stop.binarioProgrammatoPartenza ||
    '';

  const actual = normalizeTrackLabel(actualRaw);
  const planned = normalizeTrackLabel(plannedRaw);

  const label = actual || planned || '';

  return {
    label,
    isReal: Boolean(actual),
    planned,
    actual,
  };
}

function normalizeStationName(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function findStopIndexByName(fermate, name) {
  const target = normalizeStationName(name);
  if (!target) return -1;
  for (let i = 0; i < fermate.length; i += 1) {
    const current = normalizeStationName(fermate[i].stazione || fermate[i].stazioneNome);
    if (current && current === target) {
      return i;
    }
  }
  return -1;
}

function normalizeInfoText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function isGenericCancellationText(value) {
  const txt = normalizeInfoText(value).toLowerCase();
  if (!txt) return true;
  const genericSet = new Set([
    'treno cancellato',
    'treno cancellato.',
    'treno soppresso',
    'treno soppresso.',
    'corsa soppressa',
    'corsa soppressa.',
    'corsa cancellata',
    'corsa cancellata.',
  ]);
  if (genericSet.has(txt)) return true;
  return false;
}

function extractCancellationDetailsFromText(text) {
  const normalized = normalizeInfoText(text);
  if (!normalized) return null;

  const details = {};

  const segmentMatch = normalized.match(/treno\s+cancellato\s+da\s+(.+?)\s+a\s+(.+?)(?:\.|$)/i);
  if (segmentMatch) {
    details.cancelledFrom = segmentMatch[1].trim();
    details.cancelledTo = segmentMatch[2].trim();
  }

  const arriveMatch = normalized.match(/arriva\s+a\s+([^\.]+?)(?:\.|$)/i);
  if (arriveMatch) {
    details.terminatedAt = arriveMatch[1].trim();
  }

  const limitedMatch = normalized.match(/corsa\s+limitata\s+(?:a|fino a)\s+([^\.]+?)(?:\.|$)/i);
  if (limitedMatch && !details.terminatedAt) {
    details.terminatedAt = limitedMatch[1].trim();
  }

  if (!details.cancelledFrom && details.terminatedAt) {
    details.cancelledFrom = details.terminatedAt;
  }

  return Object.keys(details).length ? details : null;
}

function detectOperationalDisruption(d, fermate, lastRealIdx) {
  const infoChunks = [];
  const normalizedSubtitle = normalizeInfoText(d.subTitle);
  if (normalizedSubtitle) infoChunks.push(normalizedSubtitle);

  const normalizedVariation = normalizeInfoText(d.compVariazionePercorso);
  if (normalizedVariation) infoChunks.push(normalizedVariation);

  if (Array.isArray(d.compProvvedimenti)) {
    d.compProvvedimenti.forEach((txt) => {
      const clean = normalizeInfoText(txt);
      if (clean) infoChunks.push(clean);
    });
  }

  const lowerChunks = infoChunks.map((txt) => txt.toLowerCase());

  const cancelledByFlag = d.trenoSoppresso === true;
  const cancellationKeywords = ['cancell', 'soppress'];
  const cancelledByText = lowerChunks.some((txt) =>
    cancellationKeywords.some((kw) => txt.includes(kw))
  );

  const isCancelled = cancelledByFlag || cancelledByText;

  const partialKeywords = [
    'limitato',
    'limitata',
    'termina',
    'terminato',
    'fermo a',
    'fermato a',
    'ferma a',
    'interrotto',
    'interrotta',
    'limitazione',
  ];

  let isPartial = false;
  if (!isCancelled) {
    const hasSuppressedStops = Array.isArray(d.fermateSoppresse) && d.fermateSoppresse.length > 0;
    const subtitleLower = normalizedSubtitle.toLowerCase();
    const variationLower = normalizedVariation.toLowerCase();

    isPartial = hasSuppressedStops ||
      partialKeywords.some((kw) => subtitleLower.includes(kw) || variationLower.includes(kw));

    if (!isPartial) {
      isPartial = lowerChunks.some((txt) => partialKeywords.some((kw) => txt.includes(kw)));
    }
  }

  const firstStop = fermate[0] || null;
  const lastStop = fermate[fermate.length - 1] || null;
  const originName = firstStop?.stazione || d.origine || '';
  const destinationName = lastStop?.stazione || d.destinazione || '';

  const originRealDeparture = firstStop
    ? parseToMillis(
        firstStop.partenzaReale ??
        firstStop.effettiva ??
        firstStop.arrivoReale ??
        null
      )
    : null;
  const hasDeparted = (originRealDeparture != null) || lastRealIdx >= 0;

  let partialStation = null;
  let cancellationType = null; // 'FULL_SUPPRESSION' | 'SEGMENT'
  let cancellationSegment = null;

  const parsedDetails = infoChunks
    .map(extractCancellationDetailsFromText)
    .find(Boolean);

  if ((isPartial || isCancelled) && fermate.length > 0) {
    const idx = Math.max(0, lastRealIdx);
    const terminationStop = fermate[idx];
    const terminationName = terminationStop?.stazione || d.stazioneUltimoRilevamento || null;
    partialStation = terminationName;

    if (!originRealDeparture && lastRealIdx < 0) {
      cancellationType = 'FULL_SUPPRESSION';
      cancellationSegment = {
        origin: originName,
        destination: destinationName,
      };
    } else {
      const nextPlannedStop = fermate[idx + 1] || null;
      const shouldMarkSegment = Boolean(parsedDetails) || (idx < fermate.length - 1) || isPartial;
      if (shouldMarkSegment) {
        cancellationType = 'SEGMENT';
        cancellationSegment = {
          terminatedAt: parsedDetails?.terminatedAt || terminationName,
          cancelledFrom: parsedDetails?.cancelledFrom || terminationName || originName,
          cancelledTo: parsedDetails?.cancelledTo || destinationName || nextPlannedStop?.stazione || '',
          destination: destinationName,
          nextPlanned: nextPlannedStop?.stazione || null,
        };
      }
    }
  }

  const reasonText = infoChunks[0] || '';

  let finalType = cancellationType;
  if (!finalType) {
    if (!hasDeparted && (isCancelled || parsedDetails?.cancelledTo)) {
      finalType = 'FULL_SUPPRESSION';
    } else if (isPartial || isCancelled || parsedDetails) {
      finalType = 'SEGMENT';
    }
  }

  if (finalType === 'SEGMENT' && !cancellationSegment) {
    cancellationSegment = {
      terminatedAt: partialStation,
      cancelledFrom: partialStation || originName,
      cancelledTo: parsedDetails?.cancelledTo || destinationName,
      destination: destinationName,
      nextPlanned: null,
    };
  }

  if (finalType === 'FULL_SUPPRESSION' && !cancellationSegment) {
    cancellationSegment = {
      origin: originName,
      destination: destinationName,
    };
  }

  const finalIsCancelled = finalType === 'FULL_SUPPRESSION';
  const finalIsPartial = finalType === 'SEGMENT';

  return {
    isCancelled: finalIsCancelled,
    isPartial: finalIsPartial,
    partialStation,
    reasonText,
    cancellationType: finalType,
    cancellationSegment,
  };
}

function getLastOperationalStopIndex(journey, fermate, lastRealIdx, lastDepartedIdx) {
  const fallback = Math.max(
    typeof lastRealIdx === 'number' ? lastRealIdx : -1,
    typeof lastDepartedIdx === 'number' ? lastDepartedIdx : -1
  );

  if (!journey || journey.state !== 'PARTIAL') {
    return fallback;
  }

  const disruption = journey.disruption || {};
  const candidateNames = [
    { name: disruption.cancellationSegment?.terminatedAt, offset: 0 },
    { name: disruption.partialStation, offset: 0 },
    { name: disruption.cancellationSegment?.cancelledFrom, offset: -1 },
  ];

  for (const candidate of candidateNames) {
    if (!candidate.name) continue;
    const idx = findStopIndexByName(fermate, candidate.name);
    if (idx >= 0) {
      const adjusted = Math.max(-1, idx + (candidate.offset || 0));
      return adjusted;
    }
  }

  return fallback;
}

function computeTravelProgress(fermate, lastDepartedIdx, now = Date.now()) {
  const nextIdx = lastDepartedIdx + 1;
  if (lastDepartedIdx < 0 || nextIdx >= fermate.length) {
    return { nextIdx: -1, progress: null };
  }

  const from = fermate[lastDepartedIdx];
  const to = fermate[nextIdx];

  const depMs = pickFirstValidTime(
    from.partenzaReale,
    from.partenzaPrevista,
    from.partenza_teorica,
    from.partenzaTeorica,
    from.programmata
  );

  const arrMs = pickFirstValidTime(
    to.arrivoReale,
    to.effettiva,
    to.arrivoPrevista,
    to.arrivo_teorico,
    to.arrivoTeorico,
    to.programmata
  );

  if (depMs == null || arrMs == null || arrMs <= depMs) {
    return { nextIdx, progress: null };
  }

  const rawProgress = (now - depMs) / (arrMs - depMs);
  return { nextIdx, progress: clamp01(rawProgress) };
}

function deriveTimelineFromTimes(fermate, { journeyState, globalDelay, now = Date.now() } = {}) {
  const stops = Array.isArray(fermate) ? fermate : [];
  const total = stops.length;

  if (total === 0) {
    return {
      mode: 'UNKNOWN',
      currentIdx: -1,
      fromIdx: -1,
      toIdx: -1,
      progress: null,
      activeSegment: false,
      linePastIdx: -1,
      preDepartureAtOrigin: false,
    };
  }

  const hasAnyRealDeparture = stops.some((f) => parseToMillis(f?.partenzaReale) != null);

  let journeyBaseMs = null;
  for (const f of stops) {
    journeyBaseMs = pickFirstValidTime(
      f.programmata,
      f.partenza_teorica,
      f.partenzaTeorica,
      f.arrivo_teorico,
      f.arrivoTeorica
    );
    if (journeyBaseMs != null) break;
  }

  const preDepartureAtOrigin =
    journeyState === 'PLANNED' &&
    Boolean(extractTrackInfo(stops[0])?.isReal);

  // Se lo stato è "Pianificato", evitiamo di dedurre movimenti solo dagli orari.
  // Eccezione: binario effettivo all'origine (preDepartureAtOrigin).
  if (journeyState === 'PLANNED') {
    return {
      mode: 'PRE',
      currentIdx: preDepartureAtOrigin ? 0 : -1,
      fromIdx: -1,
      toIdx: -1,
      progress: null,
      activeSegment: false,
      linePastIdx: -1,
      preDepartureAtOrigin,
    };
  }

  const getStopArrivalRealMs = (idx) => {
    const f = stops[idx];
    if (!f) return null;
    return parseToMillis(f?.arrivoReale) ?? (hasAnyRealDeparture ? parseToMillis(f?.effettiva) : null);
  };

  const getStopDepartureRealMs = (idx) => {
    const f = stops[idx];
    if (!f) return null;
    return parseToMillis(f?.partenzaReale);
  };

  const getStopArrivalPredMs = (idx) => {
    const f = stops[idx];
    if (!f) return null;
    const raw = f?.arrivo_teorico ?? f?.arrivoTeorica ?? f?.programmata;
    if (raw == null) return null;
    const delay = getPredictionDelayMinutes(f?.ritardoArrivo, globalDelay, false);
    const minutes = Number.isFinite(delay) ? delay : 0;
    return computePredictedMillis(raw, minutes, journeyBaseMs) ?? parseToMillis(raw);
  };

  const getStopDeparturePredMs = (idx) => {
    const f = stops[idx];
    if (!f) return null;
    const raw = f?.partenza_teorica ?? f?.partenzaTeorica ?? f?.programmata;
    if (raw == null) return null;
    const delay = getPredictionDelayMinutes(f?.ritardoPartenza, globalDelay, false);
    const minutes = Number.isFinite(delay) ? delay : 0;
    return computePredictedMillis(raw, minutes, journeyBaseMs) ?? parseToMillis(raw);
  };

  const firstDep = getStopDeparturePredMs(0);
  if (firstDep != null && now < firstDep) {
    return {
      mode: 'PRE',
      currentIdx: preDepartureAtOrigin ? 0 : -1,
      fromIdx: -1,
      toIdx: -1,
      progress: null,
      activeSegment: false,
      linePastIdx: -1,
      preDepartureAtOrigin,
    };
  }

  // Timeline “onesta”: decidiamo STOPPED/MOVING/DONE solo da evidenze reali.
  // STOPPED: arrivo reale alla fermata i, ma nessuna partenza reale (o non ancora partito).
  for (let i = 1; i < total; i += 1) {
    const arrReal = getStopArrivalRealMs(i);
    if (arrReal == null || now < arrReal) continue;
    const depReal = i < total - 1 ? getStopDepartureRealMs(i) : null;
    if (depReal == null || now < depReal) {
      return {
        mode: 'STOPPED',
        currentIdx: i,
        fromIdx: -1,
        toIdx: -1,
        progress: null,
        activeSegment: false,
        linePastIdx: i - 1,
        preDepartureAtOrigin: false,
      };
    }
  }

  // MOVING: esiste una partenza reale dalla fermata i e non abbiamo ancora un arrivo reale alla i+1.
  for (let i = 0; i < total - 1; i += 1) {
    const depReal = getStopDepartureRealMs(i);
    if (depReal == null || now < depReal) continue;

    const nextArrReal = getStopArrivalRealMs(i + 1);
    if (nextArrReal != null && now >= nextArrReal) continue;

    const nextArrPred = getStopArrivalPredMs(i + 1);
    let progress = null;
    if (nextArrPred != null && nextArrPred > depReal) {
      const rawProgress = (now - depReal) / (nextArrPred - depReal);
      const clamped = clamp01(rawProgress);
      // Se non c'è ancora arrivo reale, evitiamo di arrivare a 100% “finto”.
      progress = nextArrReal == null && clamped >= 1 ? 0.98 : clamped;
    }

    return {
      mode: 'MOVING',
      currentIdx: i,
      fromIdx: i,
      toIdx: i + 1,
      progress,
      activeSegment: true,
      linePastIdx: i - 1,
      preDepartureAtOrigin: false,
    };
  }

  const lastArrReal = getStopArrivalRealMs(total - 1);
  if (lastArrReal != null && now >= lastArrReal) {
    return {
      mode: 'DONE',
      currentIdx: total - 1,
      fromIdx: -1,
      toIdx: -1,
      progress: null,
      activeSegment: false,
      linePastIdx: total - 2,
      preDepartureAtOrigin: false,
    };
  }

  // Fallback conservativo: niente "posizione certa".
  return {
    mode: 'UNKNOWN',
    currentIdx: -1,
    fromIdx: -1,
    toIdx: -1,
    progress: null,
    activeSegment: false,
    linePastIdx: -1,
    preDepartureAtOrigin,
  };
}

function getActiveSegmentFillPercents(progress) {
  const p = typeof progress === 'number' ? clamp01(progress) : 0;
  const bottomPct = p <= 0.5 ? (p / 0.5) * 100 : 100;
  const topPct = p <= 0.5 ? 0 : ((p - 0.5) / 0.5) * 100;
  return {
    bottomPct: Math.max(0, Math.min(100, Math.round(bottomPct))),
    topPct: Math.max(0, Math.min(100, Math.round(topPct))),
  };
}

function getTimelineFillStyleAttr(idx, lastDepartedIdx, timelineProgress, activeSegment) {
  if (!activeSegment) return '';
  if (!timelineProgress || typeof timelineProgress.progress !== 'number') return '';

  const { bottomPct, topPct } = getActiveSegmentFillPercents(timelineProgress.progress);
  if (idx === lastDepartedIdx) {
    return ` style="--timeline-fill-bottom-pct: ${bottomPct}"`;
  }
  if (idx === lastDepartedIdx + 1) {
    return ` style="--timeline-fill-top-pct: ${topPct}"`;
  }
  return '';
}

function getTimelineClassNames(idx, totalStops, lastDepartedIdx, journeyState, alertBoundaryIdx) {
  const safeLastDeparted = typeof lastDepartedIdx === 'number' ? lastDepartedIdx : -1;
  const safeAlertBoundary = typeof alertBoundaryIdx === 'number'
    ? alertBoundaryIdx
    : Math.max(safeLastDeparted, -1);
  const hasPrevious = idx > 0;
  const hasNext = idx < totalStops - 1;
  const isCancelled = journeyState === 'CANCELLED';
  const isPartial = journeyState === 'PARTIAL';

  let topClass = hasPrevious
    ? (idx - 1 <= safeLastDeparted ? 'line-top-past' : 'line-top-future')
    : 'line-top-none';

  let bottomClass = hasNext
    ? (idx <= safeLastDeparted ? 'line-bottom-past' : 'line-bottom-future')
    : 'line-bottom-none';

  if (isCancelled) {
    if (hasPrevious) topClass = 'line-top-alert';
    if (hasNext) bottomClass = 'line-bottom-alert';
  } else if (isPartial) {
    if (hasPrevious && idx - 1 >= safeAlertBoundary) {
      topClass = 'line-top-alert';
    }
    if (hasNext && idx >= safeAlertBoundary) {
      bottomClass = 'line-bottom-alert';
    }
  }

  return `${topClass} ${bottomClass}`;
}

function computeJourneyState(d) {
  const fermate = Array.isArray(d.fermate) ? d.fermate : [];
  const now = Date.now();

  if (fermate.length === 0) {
    return {
      state: 'UNKNOWN',
      pastCount: 0,
      total: 0,
      minutesToDeparture: null,
      disruption: { reasonText: '', partialStation: null },
    };
  }

  const total = fermate.length;
  const first = fermate[0];
  const last = fermate[fermate.length - 1];

  const firstProg = parseToMillis(first.partenza_teorica ?? first.partenzaTeorica ?? first.programmata);
  const lastArrReal = parseToMillis(last.arrivoReale ?? last.effettiva);

  const lastRealIdx = getLastRealStopIndex(fermate);
  const pastCount = lastRealIdx >= 0 ? lastRealIdx + 1 : 0;
  const disruption = detectOperationalDisruption(d, fermate, lastRealIdx);

  let state = 'UNKNOWN';
  let minutesToDeparture = null;

  if (disruption.isCancelled) {
    state = 'CANCELLED';
  } else if (disruption.isPartial) {
    state = 'PARTIAL';
  } else if (pastCount === 0) {
    if (firstProg && firstProg > now) {
      state = 'PLANNED';
      minutesToDeparture = Math.round((firstProg - now) / 60000);
    } else {
      state = 'PLANNED';
    }
  } else {
    state = 'RUNNING';
  }

  return { state, pastCount, total, minutesToDeparture, disruption };
}

function findCurrentStopInfo(d) {
  const fermate = Array.isArray(d.fermate) ? d.fermate : [];
  if (fermate.length === 0) return { currentStop: null, currentIndex: -1 };

  const lastKnownStation =
    d.stazioneUltimoRilevamento ||
    (d.localitaUltimoRilevamento && d.localitaUltimoRilevamento.nomeLungo) ||
    '';

  // 1) Se RFI ti dice proprio "ultima stazione rilevata = X", usiamo quella
  if (lastKnownStation) {
    const idx = fermate.findIndex((f) =>
      (f.stazione || '').toUpperCase() === lastKnownStation.toUpperCase()
    );
    if (idx >= 0) {
      return { currentStop: fermate[idx], currentIndex: idx };
    }
  }

  // 2) Altrimenti, usiamo l'ultima fermata che ha effettivi.
  const lastRealIdx = getLastRealStopIndex(fermate);
  if (lastRealIdx >= 0) {
    return { currentStop: fermate[lastRealIdx], currentIndex: lastRealIdx };
  }

  // 3) Se proprio non c'è nulla, non sappiamo dove sia
  return { currentStop: null, currentIndex: -1 };
}

function getGlobalDelayMinutes(d) {
  const direct = parseDelayMinutes(d.ritardo);
  if (direct != null) return direct;
  if (Array.isArray(d.compRitardo)) {
    const txt = d.compRitardo[0] || '';
    const match = txt.match(/(-?\d+)\s*min/);
    if (match) {
      const parsed = Number(match[1]);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
}

function getCompletionChip(d, journey, globalDelay) {
  const hasSuppressedStops = Array.isArray(d.fermateSoppresse) && d.fermateSoppresse.length > 0;
  const trenoSoppresso = d.trenoSoppresso === true;

  if (trenoSoppresso || hasSuppressedStops) {
    return {
      className: 'completion-bad',
      text: 'Viaggio soppresso / variazione di percorso',
    };
  }

  if (journey.state !== 'COMPLETED') return null;

  return {
    className: 'completion-ok',
    text: `Viaggio concluso in anticipo di ${Math.abs(globalDelay)} min`,
  };
}

function buildPositionText(journey, currentInfo, fermate, lastOperationalIdx) {
  const total = journey.total || (Array.isArray(fermate) ? fermate.length : 0);
  const currentIndex = currentInfo.currentIndex;
  if (total <= 0) return '';

  if (journey.state === 'PARTIAL') {
    const disruptionInfo = journey.disruption || {};
    const terminationName =
      disruptionInfo.cancellationSegment?.terminatedAt ||
      disruptionInfo.partialStation ||
      (lastOperationalIdx >= 0
        ? (fermate[lastOperationalIdx]?.stazione || fermate[lastOperationalIdx]?.stazioneNome || '')
        : '');

    const hasReachedTermination =
      lastOperationalIdx >= 0 && currentIndex >= lastOperationalIdx;

    const friendlyStop = terminationName || "l'ultima fermata utile";
    const positionLabel = `fermata ${Math.min(currentIndex + 1, total)} di ${total}`;

    if (!hasReachedTermination) {
      return `Corsa limitata: termina a ${friendlyStop} (${positionLabel}).`;
    }
    return `Corsa interrotta a ${friendlyStop} (${positionLabel}).`;
  } else if (journey.state === 'RUNNING' && total > 0) {
    if (currentIndex == null || currentIndex < 0) return '';
    return `Fermata ${currentIndex + 1} di ${total}.`;
  } else if (journey.state === 'PLANNED' && journey.minutesToDeparture != null) {
    const human = humanizeDeltaMinutes(journey.minutesToDeparture);
    return `Partenza prevista ${human}.`;
  }

  return '';
}

function buildPrimaryStatus(d, journey, currentInfo) {
  const origin = d.origine || '';
  const destination = d.destinazione || '';
  const kindInfo = getTrainKindInfo(d);
  const globalDelay = getGlobalDelayMinutes(d);
  const disruption = journey.disruption || {};
  const cancellationType = disruption.cancellationType || null;
  const cancellationSegment = disruption.cancellationSegment || null;
  const cancellationReasonText = normalizeInfoText(disruption.reasonText);
  const enrichedCancellationReason =
    cancellationReasonText && !isGenericCancellationText(cancellationReasonText)
      ? cancellationReasonText
      : '';
  const enrichedCancellationIsOfficial = /cancell|soppress/i.test(enrichedCancellationReason);

  let title = '';
  if (kindInfo.label) title = `${kindInfo.label} ${d.numeroTreno || ''}`.trim();
  else title = `Treno ${d.numeroTreno || ''}`.trim();

  let subtitle = '';
  if (origin || destination) subtitle = `${origin || '?'} → ${destination || '?'}`;

  let mainLine = '';
  let infoLine = '';
  switch (journey.state) {
    case 'PLANNED': {
      if (journey.minutesToDeparture != null) {
        const human = humanizeDeltaMinutes(journey.minutesToDeparture);
        mainLine = `Il treno deve ancora partire, partenza ${human}.`;
      } else {
        mainLine = 'Il treno risulta pianificato.';
      }
      break;
    }
    case 'RUNNING': {
      const fermate = Array.isArray(d.fermate) ? d.fermate : [];
      const { currentIndex, currentStop } = currentInfo;
      if (currentStop && currentIndex >= 0) {
        const name = currentStop.stazione || 'stazione sconosciuta';
        const depReal = parseToMillis(currentStop.partenzaReale);
        const arrReal = parseToMillis(currentStop.arrivoReale ?? currentStop.effettiva);
        if (arrReal && !depReal) {
          mainLine = `Il treno è fermo a ${name}.`;
        } else {
          const next = fermate[currentIndex + 1];
          if (next) {
            mainLine = `Il treno è in viaggio tra ${name} e ${next.stazione || 'stazione successiva'}.`;
          } else {
            mainLine = `Il treno è in prossimità di ${name}.`;
          }
        }
      } else {
        mainLine = 'Il treno è in viaggio.';
      }
      break;
    }
    case 'CANCELLED':
      if (cancellationType === 'FULL_SUPPRESSION') {
        const originName = cancellationSegment?.origin || origin || 'la stazione di origine';
        const destinationName = cancellationSegment?.destination || destination || '';
        if (enrichedCancellationIsOfficial) {
          mainLine = enrichedCancellationReason;
          infoLine = destinationName
            ? `Tratta prevista: ${originName} → ${destinationName}.`
            : 'La corsa non è mai partita.';
        } else {
          mainLine = `Corsa soppressa: il treno non è mai partito da ${originName}.`;
          infoLine = destinationName
            ? `Tratta prevista: ${originName} → ${destinationName}.`
            : 'La corsa non è mai partita.';
        }
      } else if (cancellationType === 'SEGMENT') {
        const terminatedAt = cancellationSegment?.terminatedAt || disruption.partialStation;
        const cancelledFrom = cancellationSegment?.cancelledFrom || terminatedAt || 'la tratta interessata';
        const cancelledTo = cancellationSegment?.cancelledTo || cancellationSegment?.destination || destination || 'la destinazione prevista';
        if (enrichedCancellationIsOfficial) {
          mainLine = enrichedCancellationReason;
          infoLine = terminatedAt
            ? `Ultima fermata servita: ${terminatedAt}. La corsa non prosegue verso ${cancelledTo}.`
            : `La corsa non prosegue verso ${cancelledTo}.`;
        } else {
          mainLine = `Treno cancellato da ${cancelledFrom} a ${cancelledTo}.`;
          infoLine = terminatedAt
            ? `Ultima fermata servita: ${terminatedAt}. La corsa non prosegue verso ${cancelledTo}.`
            : `La corsa non prosegue verso ${cancelledTo}.`;
        }
      } else if (disruption.partialStation) {
        if (enrichedCancellationIsOfficial) {
          mainLine = enrichedCancellationReason;
          infoLine = `Ultima fermata servita: ${disruption.partialStation}.`;
        } else {
          mainLine = `Treno cancellato e fermo a ${disruption.partialStation}.`;
          infoLine = '';
        }
      } else if (currentInfo.currentStop && currentInfo.currentStop.stazione) {
        if (enrichedCancellationIsOfficial) {
          mainLine = enrichedCancellationReason;
          infoLine = `Ultimo rilevamento: ${currentInfo.currentStop.stazione}.`;
        } else {
          mainLine = `Treno cancellato e fermo a ${currentInfo.currentStop.stazione}.`;
          infoLine = '';
        }
      } else if (d.stazioneUltimoRilevamento) {
        if (enrichedCancellationIsOfficial) {
          mainLine = enrichedCancellationReason;
          infoLine = `Ultimo rilevamento: ${d.stazioneUltimoRilevamento}.`;
        } else {
          mainLine = `Treno cancellato e fermo a ${d.stazioneUltimoRilevamento}.`;
          infoLine = '';
        }
      } else {
        mainLine = enrichedCancellationReason || 'Il treno è stato cancellato.';
        infoLine = '';
      }
      break;
    case 'PARTIAL': {
      const station =
        disruption.partialStation ||
        (currentInfo.currentStop && currentInfo.currentStop.stazione);
      if (cancellationType === 'SEGMENT') {
        const cancelledTo = cancellationSegment?.cancelledTo || cancellationSegment?.destination || destination || 'la destinazione prevista';
        const cancelledFrom = cancellationSegment?.cancelledFrom || station || 'la tratta interessata';
        if (enrichedCancellationIsOfficial) {
          mainLine = enrichedCancellationReason;
          infoLine = station
            ? `Ultima fermata servita: ${station}.`
            : `La corsa non proseguirà verso ${cancelledTo}.`;
        } else {
          mainLine = `Treno cancellato da ${cancelledFrom} a ${cancelledTo}.`;
          infoLine = station
            ? `Ultima fermata servita: ${station}.`
            : 'La corsa non proseguirà verso la destinazione prevista.';
        }
      } else {
        mainLine = station
          ? `Il treno ha terminato la corsa a ${station}.`
          : 'Il treno ha terminato la corsa prima della destinazione prevista.';
        infoLine = enrichedCancellationReason || 'La corsa non proseguirà verso la destinazione prevista.';
      }
      break;
    }
    default:
      mainLine = 'Lo stato del treno non è chiaro.';
  }

  let delayLine = '';
  const rfiReason = normalizeInfoText(disruption.reasonText);
  let delaySubLine = '';
  if (globalDelay != null && journey.state !== 'CANCELLED') {
    const v = Number(globalDelay);

    let chipClass = 'delay-chip-on';
    let label = 'In orario';

    if (!Number.isNaN(v)) {
      if (v > 0) {
        // ritardo → arancione scuro
        chipClass = 'delay-chip-late';
        label = `${v} min. ritardo`;
      } else if (v < 0) {
        // anticipo → azzurrino
        chipClass = 'delay-chip-early';
        label = `${Math.abs(v)} min. anticipo`;
      }
    }
    delayLine = `<span class="delay-chip ${chipClass}">${label}</span>`;
  }

  const isCancellationState = journey.state === 'CANCELLED' || journey.state === 'PARTIAL';
  if (isCancellationState && rfiReason) {
    delaySubLine = rfiReason;
  }

  if (!delaySubLine) {
    const rawMotivo =
      d.compVariazionePercorso ||
      d.compMotivoRitardo ||
      d.subTitle ||
      '';
    const normalizedMotivo = normalizeInfoText(rawMotivo);
    if (normalizedMotivo && !isCancellationState) {
      delaySubLine = normalizedMotivo;
    }
  }

  if (!delaySubLine && infoLine) {
    delaySubLine = infoLine;
  }
  return {
    title,
    subtitle,
    mainLine,
    delayLine,
    delaySubLine,
    trainKind: kindInfo.label,
    globalDelay,
    kindClass: kindInfo.kindClass,
  };
}

// RENDER --------------------------------------------------------------

function renderTrainStatus(payload) {
  const d = payload && payload.data;
  lastRenderedTrainStatusPayload = payload;
  trainResult.innerHTML = '';
  if (!d) {
    const msg = payload && payload.message
      ? payload.message
      : 'Nessun dato disponibile per questo treno.';
    trainResult.innerHTML = `<p class='muted'>${msg}</p>`;
    return { concluded: false };
  }

  // Usa dati computed dal backend quando disponibili
  const computed = payload.computed || {};
  const journey = computed.journeyState 
    ? { state: computed.journeyState.state } 
    : computeJourneyState(d);
  const fermate = Array.isArray(d.fermate) ? d.fermate : [];
  const globalDelay = computed.globalDelay != null 
    ? computed.globalDelay 
    : getGlobalDelayMinutes(d);
  
  const timelineState = deriveTimelineFromTimes(fermate, {
    journeyState: journey.state,
    globalDelay,
  });
  const mapSegment = (timelineState?.activeSegment === true &&
    Number.isFinite(timelineState?.fromIdx) &&
    Number.isFinite(timelineState?.toIdx) &&
    typeof timelineState?.progress === 'number' &&
    timelineState?.progress != null)
    ? { fromIdx: timelineState.fromIdx, toIdx: timelineState.toIdx, progress: timelineState.progress }
    : null;
  const mapPastIdx = Number.isFinite(timelineState?.linePastIdx) ? Number(timelineState.linePastIdx) : null;

  const isConcludedAtLastStop = (() => {
    if (journey.state === 'CANCELLED' || journey.state === 'PARTIAL') return false;
    if (!Array.isArray(fermate) || fermate.length === 0) return false;
    const lastIdx = fermate.length - 1;
    if (timelineState?.mode !== 'STOPPED') return false;
    if (timelineState?.currentIdx !== lastIdx) return false;
    const lastStop = fermate[lastIdx];
    const arrRealMs = parseToMillis(lastStop?.arrivoReale ?? lastStop?.effettiva);
    return arrRealMs != null;
  })();
  const currentInfo = {
    currentStop: timelineState.currentIdx >= 0 ? fermate[timelineState.currentIdx] : null,
    currentIndex: timelineState.currentIdx,
  };
  const { departure: plannedDeparture, arrival: plannedArrival } = getPlannedTimes(fermate);
  const lastRealIdx = fermate.length > 0 ? getLastRealStopIndex(fermate) : -1;
  const lastDepartedIdx = fermate.length > 0 ? getLastDepartedStopIndex(fermate) : -1;
  const lastOperationalIdx = fermate.length > 0
    ? getLastOperationalStopIndex(journey, fermate, lastRealIdx, lastDepartedIdx)
    : -1;
  const primary = buildPrimaryStatus(d, journey, currentInfo);
  const trainMeta = {
    numero: d.numeroTreno || d.numeroTrenoEsteso || payload.originCode || '',
    origine: d.origine || '',
    destinazione: d.destinazione || '',
    partenza: plannedDeparture,
    arrivo: plannedArrival,
    kindCode: getTrainKindShortCode(d),
  };
  const trainIsFavorite = trainMeta.numero ? isFavoriteTrain(trainMeta.numero) : false;
  const notifState = getCurrentTrainNotificationState(payload);
  const notifSupported = (typeof window !== 'undefined') && ('Notification' in window);
  const notifPermission = notifSupported ? Notification.permission : 'unsupported';

  const lastDetectionMillis = parseToMillis(d.oraUltimoRilevamento);
  const lastDetectionAgeMinutes = lastDetectionMillis != null
    ? (Date.now() - lastDetectionMillis) / 60000
    : null;
  const lastDetectionIsStale = lastDetectionAgeMinutes != null && lastDetectionAgeMinutes > 10;
  const lastDetectionTitle = lastDetectionIsStale
    ? 'Ultimo rilevamento più vecchio di 10 minuti'
    : '';
  const lastDetectionTrailText = (() => {
    if (isConcludedAtLastStop) return '';
    if (!d.oraUltimoRilevamento) return '';

    const time0 = formatTimeFlexible(d.oraUltimoRilevamento);
    const station0 = d.stazioneUltimoRilevamento ? String(d.stazioneUltimoRilevamento).trim() : '';
    const base0 = `${time0}${station0 ? ` - ${station0}` : ''}`.trim();
    if (!base0 || base0 === '-') return '';
    return base0;
  })();
  const lastDetectionInlineHtml = lastDetectionTrailText
    ? `<p class="train-last-inline"${lastDetectionTitle ? ` title='${escapeHtml(lastDetectionTitle)}'` : ''}>${escapeHtml(lastDetectionTrailText)}</p>`
    : '';
  const lastDetectionStaleHtml = lastDetectionIsStale
    ? `<div class="train-last-stale-note">Dati non aggiornati da oltre 10 min</div>`
    : '';

  const badgeLabelMap = {
    PLANNED: 'Pianificato',
    RUNNING: 'In viaggio',
    COMPLETED: 'Concluso',
    CANCELLED: 'Soppresso',
    PARTIAL: 'Cancellato parz.',
    UNKNOWN: 'Sconosciuto',
  };

  const stateKey = isConcludedAtLastStop ? 'COMPLETED' : (journey.state || 'UNKNOWN');
  const badgeStateClass = `badge-status-${stateKey.toLowerCase()}`;
  const badgeStateLabel = badgeLabelMap[stateKey] || badgeLabelMap.UNKNOWN;

  const favoriteBtnHtml = trainMeta.numero
    ? `<button type="button" class="favorite-current-btn${trainIsFavorite ? ' is-active' : ''}" data-num="${trainMeta.numero}" data-kind="${encodeDatasetValue(trainMeta.kindCode || '')}" data-orig="${encodeDatasetValue(trainMeta.origine)}" data-dest="${encodeDatasetValue(trainMeta.destinazione)}" data-dep="${encodeDatasetValue(trainMeta.partenza || '')}" data-arr="${encodeDatasetValue(trainMeta.arrivo || '')}">${buildFavoriteButtonInnerHtml(trainIsFavorite)}</button>`
    : '';

  const notifBtnDisabled = !notifSupported || notifPermission === 'denied' || !trainMeta.numero;
  const notifBtnLabel = (() => {
    if (!trainMeta.numero) return '';
    if (!notifSupported) return 'Notifiche non supportate';
    if (notifPermission === 'denied') return 'Notifiche bloccate';
    if (notifState.enabled && notifState.matches) return 'Notifiche attive';
    return 'Attiva notifiche';
  })();

  const notifBtnHtml = trainMeta.numero
    ? `<button type="button" class="notification-current-btn${(notifState.enabled && notifState.matches) ? ' is-active' : ''}" data-num="${trainMeta.numero}" data-origin-code="${encodeDatasetValue(payload?.originCode || '')}" data-technical="${encodeDatasetValue(payload?.technical || '')}" data-epoch-ms="${encodeDatasetValue(String(payload?.referenceTimestamp ?? ''))}" ${notifBtnDisabled ? 'disabled' : ''}>${escapeHtml(notifBtnLabel)}</button>`
    : '';

  const headerIconAlt = normalizeTrainShortCode(trainMeta.kindCode) || 'Treno';
  const headerIconHtml = getTrainKindIconMarkup(trainMeta.kindCode, { alt: headerIconAlt, imgClass: 'train-logo-img', ariaHidden: true });

  const headerHtml = `
    <div class='train-header'>
      <div class='train-main'>
        <div class='train-title-row'>
          <span class='train-logo' aria-hidden='true' data-kind='${escapeHtml(normalizeTrainShortCode(trainMeta.kindCode))}'>
            ${headerIconHtml}
          </span>
          <h2 class='train-title'>${primary.title || 'Dettagli treno'}</h2>
          <span class='badge-status ${badgeStateClass}'>
            ${badgeStateLabel}
          </span>
        </div>
        <div class='train-route'>
          <span class='route-main'>${primary.subtitle || ''}</span>
        </div>
        <div class='train-times'>
          <span>Partenza <strong>${plannedDeparture}</strong></span>
          <span>Arrivo <strong>${plannedArrival}</strong></span>
        </div>
      </div>
    </div>
  `;

  const currentIndex = currentInfo.currentIndex;
  const positionText = buildPositionText(journey, currentInfo, fermate, lastOperationalIdx);

  const primaryMainLine = isConcludedAtLastStop
    ? 'Il treno ha concluso il viaggio.'
    : primary.mainLine;

  const primaryHtml = `
    <div class='train-primary-stat'>
      <p class='train-primary-main'>${primaryMainLine}</p>
      ${primary.delayLine
      ? `<p class="train-primary-sub">${primary.delayLine}</p>`
      : ''
    }
      ${lastDetectionInlineHtml || ''}
      ${lastDetectionStaleHtml}
      ${primary.delaySubLine
      ? `<p class="train-primary-subtitle">
        <picture>
          <source srcset="/img/info_white.svg" media="(prefers-color-scheme: dark)" />
          <img src="/img/info_black.svg" alt="Info" class="icon-inline" />
        </picture>
        ${primary.delaySubLine}
      </p>`
      : ''
    }
      ${positionText
      ? `<p class='train-primary-meta'>${positionText}</p>`
      : ''
    }
      ${(favoriteBtnHtml || notifBtnHtml)
        ? `<div class='favorite-current-wrapper'>${notifBtnHtml || ''}${favoriteBtnHtml || ''}</div>`
        : ''}
    </div>
  `;

  const routePoints = buildTrainRoutePoints(fermate, 220);
  const showRouteMap = routePoints.length >= 1;
  const originLabel = resolveStationDisplayName('', trainMeta.origine) || trainMeta.origine || '';
  const destLabel = resolveStationDisplayName('', trainMeta.destinazione) || trainMeta.destinazione || '';
  const routeMapAriaTitle = originLabel && destLabel ? `Percorso treno: ${originLabel} → ${destLabel}` : 'Percorso treno';
  const activeStop = timelineState.currentIdx >= 0 ? fermate[timelineState.currentIdx] : null;
  const activeStopCode = activeStop ? getStopStationCode(activeStop) : '';
  const activeStopName = activeStop ? (activeStop.stazione || activeStop.stazioneNome || '') : '';
  const routeMapHtml = showRouteMap
    ? `
      <div class="train-route-map">
        <div class="map-widget" id="trainMapWidget">
          <div class="map-widget-head">
            <button type="button" class="map-recenter-btn" data-map-action="goto-active">
              <picture aria-hidden="true">
                <source srcset="/img/stop_white.svg" media="(prefers-color-scheme: dark)" />
                <img src="/img/stop_black.svg" alt="" class="map-recenter-icon" aria-hidden="true" />
              </picture>
              Vedi fermata
            </button>
            <button type="button" class="map-recenter-btn" data-map-action="recenter">
              <picture aria-hidden="true">
                <source srcset="/img/gps_white.svg" media="(prefers-color-scheme: dark)" />
                <img src="/img/gps_black.svg" alt="" class="map-recenter-icon" aria-hidden="true" />
              </picture>
              Ricentra
            </button>
          </div>
          <div class="mini-map train-mini-map map-widget-body" id="trainMiniMap"></div>
        </div>
      </div>
    `
    : '';

  // Tabella fermate ---------------------------------------------------

  let tableHtml = '';
  if (fermate.length > 0) {
    const hasAnyRealDeparture = fermate.some((f) => parseToMillis(f?.partenzaReale) != null);
    const timelineCurrentIndex = timelineState.currentIdx;
    const preDepartureAtOrigin = timelineState.preDepartureAtOrigin === true;
    const activeSegment = timelineState.activeSegment === true && journey.state === 'RUNNING';
    const timelineProgress = activeSegment
      ? { nextIdx: timelineState.toIdx, progress: timelineState.progress }
      : { nextIdx: -1, progress: null };
    const lastDepartedIdxForFill = activeSegment ? timelineState.fromIdx : -1;
    const linePastIdx = Number.isFinite(timelineState.linePastIdx) ? timelineState.linePastIdx : -1;

    // Base per costruire millis quando un orario è solo HH:mm/HHmm
    let journeyBaseMs = null;
    for (const f of fermate) {
      journeyBaseMs = pickFirstValidTime(
        f.programmata,
        f.partenza_teorica,
        f.partenzaTeorica,
        f.arrivo_teorico,
        f.arrivoTeorica
      );
      if (journeyBaseMs != null) break;
    }

    const rows = fermate.map((f, idx) => {
      const isCurrent = timelineCurrentIndex === idx;
      const isFirstStop = idx === 0;
      const isLastStop = idx === fermate.length - 1;
      const showArrival = !isFirstStop;
      const showDeparture = !isLastStop;
      const withinOperationalPlan =
        journey.state !== 'PARTIAL' || lastOperationalIdx < 0 || idx <= lastOperationalIdx;

      const arrProgRaw = f.arrivo_teorico ?? f.arrivoTeorico ?? f.programmata;
      const depProgRaw = f.partenza_teorica ?? f.partenzaTeorica ?? f.programmata;

      const hasRealArrival = f.arrivoReale != null || (hasAnyRealDeparture && f.effettiva != null);
      const hasRealDeparture = f.partenzaReale != null;

      const arrRealRaw = f.arrivoReale ?? (hasAnyRealDeparture ? f.effettiva : null);
      const depRealRaw = f.partenzaReale ?? null;

      // Orario probabile (calcolato): programmato + ritardo (ignoriamo totalmente le "prevista" dalle API)
      let arrPredMs = null;
      let depPredMs = null;

      const arrProg = arrProgRaw ? formatTimeFlexible(arrProgRaw) : '-';
      const depProg = depProgRaw ? formatTimeFlexible(depProgRaw) : '-';

      const arrProgHH = hhmmFromRaw(arrProgRaw);
      const depProgHH = hhmmFromRaw(depProgRaw);
      const arrRealHH = hhmmFromRaw(arrRealRaw);
      const depRealHH = hhmmFromRaw(depRealRaw);

      const ritArr = resolveDelay(f.ritardoArrivo, globalDelay);
      const ritDep = resolveDelay(f.ritardoPartenza, globalDelay);
      const predArrDelay = getPredictionDelayMinutes(f.ritardoArrivo, globalDelay, hasRealArrival);
      const predDepDelay = getPredictionDelayMinutes(f.ritardoPartenza, globalDelay, hasRealDeparture);

      const shouldPredictArrival =
        (journey.state === 'RUNNING' || journey.state === 'PARTIAL') &&
        showArrival &&
        !hasRealArrival &&
        idx >= timelineCurrentIndex &&
        withinOperationalPlan &&
        Number.isFinite(predArrDelay) &&
        predArrDelay !== 0 &&
        arrProgRaw != null;

      const shouldPredictDeparture =
        (journey.state === 'RUNNING' || journey.state === 'PARTIAL') &&
        showDeparture &&
        !hasRealDeparture &&
        idx >= timelineCurrentIndex &&
        withinOperationalPlan &&
        Number.isFinite(predDepDelay) &&
        predDepDelay !== 0 &&
        depProgRaw != null;

      if (shouldPredictArrival) {
        arrPredMs = computePredictedMillis(arrProgRaw, predArrDelay, journeyBaseMs);
      }

      if (shouldPredictDeparture) {
        depPredMs = computePredictedMillis(depProgRaw, predDepDelay, journeyBaseMs);
      }

      const trackInfo = extractTrackInfo(f);
      const trackClass = trackInfo.isReal ? 'col-track-pill col-track-pill--real' : 'col-track-pill';

      // stato riga (passato / corrente / futuro)
      let rowClass = '';
      if (isCurrent) {
        rowClass = 'stop-current';
      } else if (linePastIdx >= 0 && idx <= linePastIdx) {
        // tutte le fermate fino all'ultima con effettivi → passate
        rowClass = 'stop-past';
      } else {
        rowClass = 'stop-future';
      }

      // stato dettagliato del "pallino" sulla fermata corrente
      // - stop-here: treno arrivato ma non ancora partito (lampeggia)
      // - stop-moving: treno già ripartito dalla fermata corrente (pieno verde)
      if (isCurrent) {
        if (hasRealArrival && !hasRealDeparture) {
          rowClass += ' stop-here';
        } else if (activeSegment) {
          rowClass += ' stop-moving';
        }

        if (preDepartureAtOrigin && idx === 0) {
          rowClass += ' stop-preboard';
        }
      }

      const isNextStop = activeSegment && idx === timelineProgress.nextIdx;
      if (isNextStop) {
        rowClass += ' stop-next';
      }

      const isCancelledStop =
        journey.state === 'CANCELLED' ||
        (journey.state === 'PARTIAL' && lastOperationalIdx >= 0 && idx > lastOperationalIdx);

      if (isCancelledStop) {
        rowClass += ' stop-cancelled';
      }

      const timelineClasses = getTimelineClassNames(
        idx,
        fermate.length,
        linePastIdx,
        journey.state,
        lastOperationalIdx
      );
      const timelineStyleAttr = getTimelineFillStyleAttr(idx, lastDepartedIdxForFill, timelineProgress, activeSegment);

      let stopTagHtml = '';
      if (journey.state === 'RUNNING') {
        if (isCurrent) {
          if (hasRealArrival && !hasRealDeparture) {
            stopTagHtml = '<span class="stop-tag stop-tag-current">Fermo</span>';
          } else if (activeSegment) {
            stopTagHtml = '<span class="stop-tag stop-tag-current">Partito</span>';
          }
        } else if (isNextStop) {
          stopTagHtml = '<span class="stop-tag stop-tag-next">In arrivo</span>';
        }
      }


      // effettivi: verde solo se HHmm coincide con il programmato
      let arrivalEffClass = '';
      if (hasRealArrival && arrRealRaw) {
        if (arrProgHH && arrRealHH && arrProgHH === arrRealHH) {
          arrivalEffClass = 'delay-ok';
        } else if (Number.isFinite(ritArr)) {
          if (ritArr < 0) arrivalEffClass = 'delay-early';
          else arrivalEffClass = 'delay-mid';
        }
      }

      let departEffClass = '';
      if (hasRealDeparture && depRealRaw) {
        if (depProgHH && depRealHH && depProgHH === depRealHH) {
          departEffClass = 'delay-ok';
        } else if (Number.isFinite(ritDep)) {
          if (ritDep < 0) departEffClass = 'delay-early';
          else departEffClass = 'delay-mid';
        }
      }

      // ARRIVO: riga effettivo / previsto
      let arrivalLine = '';
      if (showArrival) {
        if (hasRealArrival && arrRealRaw) {
          arrivalLine = `<span class="time-actual ${arrivalEffClass}">${formatTimeFlexible(arrRealRaw)}</span>`;
        } else if (arrPredMs != null) {
          const forecastClass = predArrDelay < 0 ? 'forecast-early' : 'forecast-late';
          arrivalLine = `<span class="time-actual ${forecastClass} time-predicted"><span class="time-predicted-mark">≈</span>&nbsp;${formatTimeFromMillis(arrPredMs)}</span>`;
        }
      }

      // PARTENZA: riga effettivo / previsto
      let departLine = '';
      if (showDeparture) {
        if (hasRealDeparture && depRealRaw) {
          departLine = `<span class="time-actual ${departEffClass}">${formatTimeFlexible(depRealRaw)}</span>`;
        } else if (depPredMs != null) {
          const forecastClass = predDepDelay < 0 ? 'forecast-early' : 'forecast-late';
          departLine = `<span class="time-actual ${forecastClass} time-predicted"><span class="time-predicted-mark">≈</span>&nbsp;${formatTimeFromMillis(depPredMs)}</span>`;
        }
      }

      const arrivalScheduledDisplay = showArrival ? arrProg : '--';
      const departureScheduledDisplay = showDeparture ? depProg : '--';
      const stationNameRaw = f.stazione || f.stazioneNome || '-';
      const stationCode = getStopStationCode(f);
      const stationName = resolveStationDisplayName(stationCode, stationNameRaw) || stationNameRaw || '-';
      const safeStationName = escapeHtml(stationName || '-');
      const encodedStationName = encodeDatasetValue(stationName || '');
      const encodedStationCode = stationCode ? encodeDatasetValue(stationCode) : '';
      const stationAriaLabel = escapeHtml(`Apri dettagli stazione ${stationName || ''}`.trim());
      const stationDataAttrs = `data-station-name="${encodedStationName}"${encodedStationCode ? ` data-station-code="${encodedStationCode}"` : ''} aria-label="${stationAriaLabel || 'Apri stazione'}"`;

      return `
        <tr class="${rowClass}">
          <td class="col-idx" aria-label="Fermata ${idx + 1}">
            <span class="timeline-line ${timelineClasses}"${timelineStyleAttr}></span>
          </td>
          <td>
            <div class="st-name station-stop-trigger station-stop-trigger--text" role="button" tabindex="0" ${stationDataAttrs}>
              ${safeStationName}
              ${stopTagHtml}
            </div>
          </td>
          <td>
            <div class="time-block">
              <span class="time-scheduled">${arrivalScheduledDisplay}</span>
              ${arrivalLine}
            </div>
          </td>
          <td>
            <div class="time-block">
              <span class="time-scheduled">${departureScheduledDisplay}</span>
              ${departLine}
            </div>
          </td>
          <td class="col-track">
            ${trackInfo.label
              ? `<span class="${trackClass}" title="${trackInfo.isReal ? 'Binario effettivo' : 'Binario programmato'}">${trackInfo.label}</span>`
              : '<span class="soft"></span>'}
          </td>
        </tr>
      `;
    }).join('');

    // Generate mobile card HTML
    const cardRows = fermate.map((f, idx) => {
      const isCurrent = timelineCurrentIndex === idx;
      const isFirstStop = idx === 0;
      const isLastStop = idx === fermate.length - 1;
      const showArrival = !isFirstStop;
      const showDeparture = !isLastStop;
      const withinOperationalPlan =
        journey.state !== 'PARTIAL' || lastOperationalIdx < 0 || idx <= lastOperationalIdx;

      const arrProgRaw = f.arrivo_teorico ?? f.arrivoTeorico ?? f.programmata;
      const depProgRaw = f.partenza_teorica ?? f.partenzaTeorica ?? f.programmata;

      const hasRealArrival = f.arrivoReale != null || (hasAnyRealDeparture && f.effettiva != null);
      const hasRealDeparture = f.partenzaReale != null;

      const arrRealRaw = f.arrivoReale ?? (hasAnyRealDeparture ? f.effettiva : null);
      const depRealRaw = f.partenzaReale ?? null;

      let arrPredMs = null;
      let depPredMs = null;

      const arrProg = arrProgRaw ? formatTimeFlexible(arrProgRaw) : '-';
      const depProg = depProgRaw ? formatTimeFlexible(depProgRaw) : '-';

      const arrProgHH = hhmmFromRaw(arrProgRaw);
      const depProgHH = hhmmFromRaw(depProgRaw);
      const arrRealHH = hhmmFromRaw(arrRealRaw);
      const depRealHH = hhmmFromRaw(depRealRaw);

      const ritArr = resolveDelay(f.ritardoArrivo, globalDelay);
      const ritDep = resolveDelay(f.ritardoPartenza, globalDelay);
      const predArrDelay = getPredictionDelayMinutes(f.ritardoArrivo, globalDelay, hasRealArrival);
      const predDepDelay = getPredictionDelayMinutes(f.ritardoPartenza, globalDelay, hasRealDeparture);

      const shouldPredictArrival =
        (journey.state === 'RUNNING' || journey.state === 'PARTIAL') &&
        showArrival &&
        !hasRealArrival &&
        idx >= timelineCurrentIndex &&
        withinOperationalPlan &&
        Number.isFinite(predArrDelay) &&
        predArrDelay !== 0 &&
        arrProgRaw != null;

      const shouldPredictDeparture =
        (journey.state === 'RUNNING' || journey.state === 'PARTIAL') &&
        showDeparture &&
        !hasRealDeparture &&
        idx >= timelineCurrentIndex &&
        withinOperationalPlan &&
        Number.isFinite(predDepDelay) &&
        predDepDelay !== 0 &&
        depProgRaw != null;

      if (shouldPredictArrival) {
        arrPredMs = computePredictedMillis(arrProgRaw, predArrDelay, journeyBaseMs);
      }

      if (shouldPredictDeparture) {
        depPredMs = computePredictedMillis(depProgRaw, predDepDelay, journeyBaseMs);
      }

      const trackInfo = extractTrackInfo(f);
      const cardTrackClass = trackInfo.isReal ? 'stop-card-track stop-card-track--real' : 'stop-card-track';

      let rowClass = '';
      if (isCurrent) {
        rowClass = 'stop-current';
      } else if (linePastIdx >= 0 && idx <= linePastIdx) {
        rowClass = 'stop-past';
      } else {
        rowClass = 'stop-future';
      }

      if (isCurrent) {
        if (hasRealArrival && !hasRealDeparture) {
          rowClass += ' stop-here';
        } else if (activeSegment) {
          rowClass += ' stop-moving';
        }

        if (preDepartureAtOrigin && idx === 0) {
          rowClass += ' stop-preboard';
        }
      }

      const isNextStop = activeSegment && idx === timelineProgress.nextIdx;
      if (isNextStop) {
        rowClass += ' stop-next';
      }

      const isCancelledStop =
        journey.state === 'CANCELLED' ||
        (journey.state === 'PARTIAL' && lastOperationalIdx >= 0 && idx > lastOperationalIdx);
      if (isCancelledStop) {
        rowClass += ' stop-cancelled';
      }

      const timelineClasses = getTimelineClassNames(
        idx,
        fermate.length,
        linePastIdx,
        journey.state,
        lastOperationalIdx
      );
      const timelineStyleAttr = getTimelineFillStyleAttr(idx, lastDepartedIdxForFill, timelineProgress, activeSegment);

      let stopTagHtml = '';
      if (journey.state === 'RUNNING') {
        if (isCurrent) {
          if (hasRealArrival && !hasRealDeparture) {
            stopTagHtml = '<span class="stop-tag stop-tag-current">Fermo</span>';
          } else if (activeSegment) {
            stopTagHtml = '<span class="stop-tag stop-tag-current">Partito</span>';
          }
        } else if (isNextStop) {
          stopTagHtml = '<span class="stop-tag stop-tag-next">In arrivo</span>';
        }
      }

      let arrivalEffClass = '';
      if (hasRealArrival && arrRealRaw) {
        if (arrProgHH && arrRealHH && arrProgHH === arrRealHH) {
          arrivalEffClass = 'delay-ok';
        } else if (Number.isFinite(ritArr)) {
          if (ritArr < 0) arrivalEffClass = 'delay-early';
          else arrivalEffClass = 'delay-mid';
        }
      }

      let departEffClass = '';
      if (hasRealDeparture && depRealRaw) {
        if (depProgHH && depRealHH && depProgHH === depRealHH) {
          departEffClass = 'delay-ok';
        } else if (Number.isFinite(ritDep)) {
          if (ritDep < 0) departEffClass = 'delay-early';
          else departEffClass = 'delay-mid';
        }
      }

      let arrivalActual = '';
      let arrivalActualClass = '';
      if (showArrival) {
        if (hasRealArrival && arrRealRaw) {
          arrivalActual = formatTimeFlexible(arrRealRaw);
          arrivalActualClass = arrivalEffClass || 'delay-ok';
        } else if (arrPredMs != null) {
          arrivalActual = `<span class="time-predicted-mark">≈</span>&nbsp;${formatTimeFromMillis(arrPredMs)}`;
          arrivalActualClass = `${predArrDelay < 0 ? 'forecast-early' : 'forecast-late'} time-predicted`;
        }
      }

      let departureActual = '';
      let departureActualClass = '';
      if (showDeparture) {
        if (hasRealDeparture && depRealRaw) {
          departureActual = formatTimeFlexible(depRealRaw);
          departureActualClass = departEffClass || 'delay-ok';
        } else if (depPredMs != null) {
          departureActual = `<span class="time-predicted-mark">≈</span>&nbsp;${formatTimeFromMillis(depPredMs)}`;
          departureActualClass = `${predDepDelay < 0 ? 'forecast-early' : 'forecast-late'} time-predicted`;
        }
      }

      if (!arrivalActual) {
        arrivalActualClass = 'soft';
      }
      if (!departureActual) {
        departureActualClass = 'soft';
      }

      const arrivalActualDisplay = showArrival && arrivalActual ? arrivalActual : '--:--';
      const departureActualDisplay = showDeparture && departureActual ? departureActual : '--:--';

      const arrivalPlannedDisplay = showArrival ? arrProg : '--';
      const departurePlannedDisplay = showDeparture ? depProg : '--';

      const stationCode = getStopStationCode(f);
      const stazioneNameRaw = f.stazione || f.stazioneNome || '-';
      const stazioneName = resolveStationDisplayName(stationCode, stazioneNameRaw) || stazioneNameRaw || '-';
      const safeStationName = escapeHtml(stazioneName || '-');
      const encodedStationName = encodeDatasetValue(stazioneName || '');
      const encodedStationCode = stationCode ? encodeDatasetValue(stationCode) : '';
      const stationAriaLabel = escapeHtml(`Apri dettagli stazione ${stazioneName || ''}`.trim());
      const stationDataAttrs = `data-station-name="${encodedStationName}"${encodedStationCode ? ` data-station-code="${encodedStationCode}"` : ''} aria-label="${stationAriaLabel || 'Apri stazione'}"`;

      return `
        <div class="stop-card ${rowClass} station-stop-trigger station-stop-trigger--card" role="button" tabindex="0" ${stationDataAttrs}>
          <div class="stop-card-timeline">
            <div class="timeline-line stop-card-line ${timelineClasses}"${timelineStyleAttr}></div>
            <div class="stop-card-dot"></div>
          </div>
          <div class="stop-card-content">
            <div class="stop-card-header">
              <div class="stop-card-name">
                ${safeStationName}
                ${stopTagHtml}
              </div>
              ${trackInfo.label ? `<div class="${cardTrackClass}" title="${trackInfo.isReal ? 'Binario effettivo' : 'Binario programmato'}">${trackInfo.label}</div>` : ''}
            </div>
            <div class="stop-card-times">
              ${showArrival ? `
              <div class="stop-card-time">
                <div class="stop-card-time-label">Arrivo</div>
                <div class="stop-card-time-values">
                  <span class="stop-card-time-planned">${arrivalPlannedDisplay}</span>
                  <span class="stop-card-time-actual ${arrivalActualClass}">${arrivalActualDisplay}</span>
                </div>
              </div>` : ''}
              ${showDeparture ? `
              <div class="stop-card-time">
                <div class="stop-card-time-label">Partenza</div>
                <div class="stop-card-time-values">
                  <span class="stop-card-time-planned">${departurePlannedDisplay}</span>
                  <span class="stop-card-time-actual ${departureActualClass}">${departureActualDisplay}</span>
                </div>
              </div>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');

    const stopsBodyHtml = `
      <div class="stops-table-wrapper">
        <div class="stops-table-cards stops-table-cards--full">
          ${cardRows}
        </div>
      </div>
    `;

    tableHtml = `
      <details class="train-stops-collapse" aria-label="Elenco fermate" data-stop-count="${fermate.length}" open>
        <summary class="train-stops-summary">
          <span class="train-stops-summary-inner">
            <span class="train-stops-summary-title">Fermate</span>
            <span class="train-stops-summary-count">${fermate.length}</span>
          </span>
        </summary>
        <div class="train-stops-collapse-body">
          ${stopsBodyHtml}
        </div>
      </details>
    `;
  }

  const jsonDebugHtml = isDebugUiEnabled()
    ? `
      <details class='json-debug'>
        <summary>Dettagli raw (JSON ViaggiaTreno)</summary>
        <pre>${escapeHtml(JSON.stringify(d, null, 2))}</pre>
      </details>
    `
    : '';

  trainResult.innerHTML = headerHtml + primaryHtml + routeMapHtml + tableHtml + jsonDebugHtml;

  if (showRouteMap) {
    const root = trainResult.querySelector('#trainMapWidget');
    attachMapWidget(root, routePoints, {
      mode: 'route',
      title: routeMapAriaTitle,
      maxFitZoom: 12,
      activeCode: activeStopCode,
      activeLabel: activeStopName,
      activeZoom: 15,
      segment: mapSegment,
      pastStopIdx: mapPastIdx,
    });
  }

  return { concluded: isConcludedAtLastStop };
}

function isDebugUiEnabled() {
  try {
    if (typeof window === 'undefined') return false;
    const p = new URLSearchParams(window.location.search || '');
    return p.has('debug');
  } catch {
    return false;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function loadTrainChoiceByNumber() {
  try {
    const raw = localStorage.getItem(TRAIN_CHOICE_BY_NUMBER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveTrainChoiceByNumber(nextMap) {
  try {
    localStorage.setItem(TRAIN_CHOICE_BY_NUMBER_KEY, JSON.stringify(nextMap || {}));
  } catch {
    // ignore
  }
}

function rememberTrainChoice(trainNumber, choice) {
  const num = String(trainNumber || '').trim();
  if (!num) return;
  const originCode = String(choice?.originCode || '').trim();
  const technical = String(choice?.technical || '').trim();
  const epochMs = Number.isFinite(Number(choice?.epochMs)) ? Number(choice.epochMs) : null;
  if (!originCode && !technical) return;

  const map = loadTrainChoiceByNumber();
  map[num] = {
    originCode,
    technical,
    epochMs,
    updatedAt: Date.now(),
  };

  // Limita la crescita (tieni i 30 più recenti)
  const entries = Object.entries(map)
    .map(([k, v]) => [k, v])
    .sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));
  const trimmed = entries.slice(0, 30);
  const out = {};
  for (const [k, v] of trimmed) out[k] = v;
  saveTrainChoiceByNumber(out);
}

function getRememberedTrainChoice(trainNumber) {
  const num = String(trainNumber || '').trim();
  if (!num) return null;
  const map = loadTrainChoiceByNumber();
  const v = map[num];
  if (!v || typeof v !== 'object') return null;
  const originCode = String(v.originCode || '').trim();
  const technical = String(v.technical || '').trim();
  if (!originCode && !technical) return null;
  const epochMs = Number.isFinite(Number(v.epochMs)) ? Number(v.epochMs) : null;
  return { originCode, technical, epochMs };
}

function renderTrainNumberDisambiguationMenu(trainNumber, choices) {
  const safeNum = escapeHtml(trainNumber);
  const items = (Array.isArray(choices) ? choices : [])
    .map((choice) => {
      const displayRaw = String(choice?.display || 'Treno');
      const display = escapeHtml(displayRaw);
      const originCodeRaw = String(choice?.originCode || '').trim().toUpperCase();
      const originCode = escapeHtml(originCodeRaw);
      const technical = escapeHtml(choice?.technical || '');
      const epochMs = Number.isFinite(Number(choice?.epochMs)) ? String(Number(choice.epochMs)) : '';

      const kindMeta = resolveTrainKindFromCode(displayRaw);
      const kindCode = normalizeTrainShortCode(kindMeta?.shortCode);
      // Se non riconosciamo il tipo (o non abbiamo un logo dedicato), NON mostriamo un logo generico (crea confusione).
      const showIcon = !!kindCode && (Boolean(TRAIN_KIND_ICON_SRC[kindCode]) || REGIONAL_ICON_CODES.has(kindCode));
      const iconAlt = kindCode || '';
      const iconHtml = showIcon
        ? `<span class="train-pick-icon" aria-hidden="true">${getTrainKindIconMarkup(kindCode, { alt: iconAlt })}</span>`
        : '';
      const btnClass = showIcon ? 'train-pick-btn' : 'train-pick-btn train-pick-btn--no-icon';
      return `
        <button
          type="button"
          class="${btnClass}"
          data-origin-code="${originCode}"
          data-technical="${technical}"
          data-epoch-ms="${escapeHtml(epochMs)}"
          data-kind="${escapeHtml(kindCode)}"
        >
          ${iconHtml}
          <span class="train-pick-btn-text">
            <span class="train-pick-btn-title">${display}</span>
          </span>
        </button>
      `;
    })
    .join('');

  trainResult.innerHTML = `
    <div class="train-pick" role="group" aria-label="Selezione treno">
      <div class="train-pick-head">
        <div class="train-pick-title">Più treni con numero <strong>${safeNum}</strong></div>
        <div class="train-pick-sub muted">Scegli quello che vuoi monitorare.</div>
      </div>
      <div class="train-pick-list">${items}</div>
    </div>
  `;

  trainResult.querySelectorAll('.train-pick-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const originCode = (btn.getAttribute('data-origin-code') || '').trim();
      const technical = (btn.getAttribute('data-technical') || '').trim();
      const epochMsRaw = (btn.getAttribute('data-epoch-ms') || '').trim();
      const epochMs = Number.isFinite(Number(epochMsRaw)) ? Number(epochMsRaw) : null;
      rememberTrainChoice(trainNumber, { originCode, technical, epochMs });
      cercaStatoTreno(trainNumber, { originCode, technical, epochMs });
    });
  });
}

// HANDLER RICERCA -----------------------------------------------------

async function cercaStatoTreno(trainNumberOverride = '', options = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  const silent = !!opts.silent;
  const isAuto = !!opts.isAuto;
  const useRememberedChoice = !!opts.useRememberedChoice;
  let originCode = String(opts.originCode || '').trim();
  let technical = String(opts.technical || '').trim();
  const epochMsOpt = Number.isFinite(Number(opts.epochMs)) ? Number(opts.epochMs) : null;
  let epochMs = epochMsOpt;

  trainError.textContent = '';
  if (!silent) {
    trainResult.innerHTML = '';
  }

  const overrideValue = typeof trainNumberOverride === 'string' ? trainNumberOverride : '';
  const num = (overrideValue || trainNumberInput.value || '').trim();
  if (!num) {
    trainError.textContent = 'Inserisci un numero di treno.';
    return;
  }

  // Se non ci hanno passato hint, prova a riusare una scelta precedente SOLO se richiesto.
  // (Esempio: auto-refresh o click da liste/soluzioni). Nella ricerca manuale vogliamo far scegliere.
  if (!originCode && !technical && (isAuto || useRememberedChoice)) {
    const remembered = getRememberedTrainChoice(num);
    if (remembered) {
      originCode = remembered.originCode;
      technical = remembered.technical;
      if (epochMs == null && Number.isFinite(Number(remembered.epochMs))) {
        epochMs = Number(remembered.epochMs);
      }
    }
  }

  if (!silent) {
    trainResult.innerHTML = `
      <div class="loading-indicator loading-indicator--centered" role="status" aria-live="polite">
        <span class="loading-indicator__spinner" aria-hidden="true"></span>
        <span>Caricamento stato treno…</span>
      </div>
    `;
  }

  try {
    if (trainAutoRefreshAbortController) {
      try {
        trainAutoRefreshAbortController.abort();
      } catch {
        // ignore
      }
    }

    trainAutoRefreshAbortController = new AbortController();
    trainAutoRefreshInFlight = true;

    const params = new URLSearchParams({ trainNumber: num });
    if (originCode) params.set('originCode', originCode);
    if (technical) params.set('technical', technical);
    if (epochMs != null) params.set('epochMs', String(epochMs));

    const res = await fetch(`${API_BASE}/api/trains/status?${params.toString()}`, {
      signal: trainAutoRefreshAbortController.signal,
    });

    if (!res.ok) {
      trainError.textContent = `Errore HTTP dal backend: ${res.status}`;
      if (!silent) trainResult.innerHTML = '';
      return;
    }

    const data = await res.json();

    if (!data.ok) {
      trainError.textContent = data.error || 'Errore logico dal backend.';
      if (!silent) trainResult.innerHTML = '';
      return;
    }

    if (data.needsSelection && Array.isArray(data.choices) && data.choices.length) {
      // In auto-refresh (silent) non mostriamo menu: serve una scelta esplicita.
      if (!silent) {
        try {
          await ensureStationIndexLoaded();
        } catch {
          // ignore
        }
        renderTrainNumberDisambiguationMenu(num, data.choices);
      }
      return;
    }

    if (!data.data) {
      if (!silent) {
        trainResult.innerHTML = `<p class='muted'>${data.message || 'Nessun treno trovato.'}</p>`;
      }
      return;
    }

    const dd = data.data;

    // Notifiche: valuta su ogni snapshot (anche in auto-refresh).
    try {
      maybeSendTrainNotification(data);
    } catch {
      // ignore
    }

    // Se il backend ci dice quale origin/technical ha risolto, ricordiamocelo.
    if (data.originCode || data.technical || data.referenceTimestamp) {
      rememberTrainChoice(num, {
        originCode: data.originCode,
        technical: data.technical,
        epochMs: data.referenceTimestamp,
      });
    }
    const { departure, arrival } = getPlannedTimes(dd.fermate);
    if (!isAuto) {
      const kindCode = getTrainKindShortCode(dd);
      addRecentTrain({
        numero: dd.numeroTreno || num,
        origine: dd.origine,
        destinazione: dd.destinazione,
        partenza: departure,
        arrivo: arrival,
        kindCode,
      });
    }

    try {
      await ensureStationIndexLoaded();
    } catch {
      // ignore
    }
    const renderResult = renderTrainStatus(data);

    trainAutoRefreshLastSuccessAt = Date.now();
    if (renderResult?.concluded) {
      stopTrainAutoRefresh();
    } else {
      startTrainAutoRefresh(dd.numeroTreno || num, data.originCode || originCode, data.referenceTimestamp);
    }
  } catch (err) {
    // Abort è normale quando cambiamo treno o la tab va in background.
    if (err && (err.name === 'AbortError' || err.code === 20)) {
      return;
    }
    console.error('Errore fetch train status:', err);
    trainError.textContent = 'Errore di comunicazione con il backend locale.';
    if (!silent) trainResult.innerHTML = '';
  } finally {
    trainAutoRefreshInFlight = false;
    trainAutoRefreshAbortController = null;
  }
}

trainSearchBtn.addEventListener('click', () => cercaStatoTreno());

trainNumberInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    cercaStatoTreno();
  }
});

if (trainClearBtn) {
  trainClearBtn.addEventListener('click', () => {
    clearTrainSearch();
    trainNumberInput?.focus();
  });
}

// --- RICERCA SOLUZIONI (LeFrecce) ----------------------------------------

// Set default date/time
if (tripDateInput) {
  tripDateInput.valueAsDate = new Date();
}
if (tripTimeInput) {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  tripTimeInput.value = `${hh}:${mm}`;
}

function setupTripAutocomplete(input, list, onSelect) {
  if (!input || !list) return;

  input.addEventListener('input', debounce(async (e) => {
    const query = e.target.value.trim();
    if (query.length < 2) {
      list.innerHTML = '';
      return;
    }

    try {
      // Usa endpoint specifico LeFrecce
      const res = await fetch(`${API_BASE}/api/lefrecce/autocomplete?query=${encodeURIComponent(query)}`);
      const json = await res.json();
      
      list.innerHTML = '';
      if (json.ok && json.data && json.data.length > 0) {
        json.data.forEach(station => {
          const li = document.createElement('li');
          li.textContent = station.name;
          li.addEventListener('click', () => {
            input.value = station.name;
            list.innerHTML = '';
            onSelect(station);
          });
          list.appendChild(li);
        });
      }
    } catch (err) {
      console.error('Autocomplete error', err);
    }
  }, 300));

  // Hide list on blur (delayed)
  input.addEventListener('blur', () => {
    setTimeout(() => {
      list.innerHTML = '';
    }, 200);
  });
}

setupTripAutocomplete(tripFromInput, tripFromList, (station) => {
  tripFromId = station.id;
});

if (tripFromInput) {
  tripFromInput.addEventListener('input', () => {
    tripFromId = null;
  });
}

setupTripAutocomplete(tripToInput, tripToList, (station) => {
  tripToId = station.id;
});

if (tripToInput) {
  tripToInput.addEventListener('input', () => {
    tripToId = null;
  });
}

if (tripSwapBtn) {
  tripSwapBtn.addEventListener('click', () => {
    if (!tripFromInput || !tripToInput) return;

    const fromValue = tripFromInput.value;
    const toValue = tripToInput.value;
    tripFromInput.value = toValue;
    tripToInput.value = fromValue;

    const fromId = tripFromId;
    tripFromId = tripToId;
    tripToId = fromId;

    if (tripFromList) tripFromList.innerHTML = '';
    if (tripToList) tripToList.innerHTML = '';
    setInlineError(tripError, '');

    tripSwapBtn.classList.remove('is-animating');
    // forziamo reflow per ri-triggerare l'animazione anche su click ravvicinati
    void tripSwapBtn.offsetWidth;
    tripSwapBtn.classList.add('is-animating');
    window.setTimeout(() => {
      tripSwapBtn.classList.remove('is-animating');
    }, 220);
  });
}

if (tripSearchBtn) {
  tripSearchBtn.addEventListener('click', async () => {
    const fromName = tripFromInput.value.trim();
    const toName = tripToInput.value.trim();

    setInlineError(tripError, '');

    if (!fromName || !toName) {
      setInlineError(tripError, 'Inserisci stazione di partenza e arrivo.');
      return;
    }

    if (typeof addRecentTrip === 'function') {
      addRecentTrip(fromName, toName);
    }
    
    const date = tripDateInput.value;
    const time = tripTimeInput.value;
    
    if (!date) {
      setInlineError(tripError, 'Seleziona una data.');
      return;
    }

    tripResults.innerHTML = `
      <div class="loading-indicator loading-indicator--centered" role="status" aria-live="polite">
        <span class="loading-indicator__spinner" aria-hidden="true"></span>
        <span>Caricamento soluzioni…</span>
      </div>
    `;

    try {
      const params = new URLSearchParams({
        date: date,
        time: time || '00:00'
      });

      // Se abbiamo gli ID, usiamoli. Altrimenti usiamo i nomi.
      if (tripFromId) params.append('fromId', tripFromId);
      else params.append('fromName', fromName);

      if (tripToId) params.append('toId', tripToId);
      else params.append('toName', toName);

      // Pagination (offset/limit)
      const limit = 10;
      const baseParams = new URLSearchParams(params.toString());
      baseParams.delete('offset');
      baseParams.delete('limit');

      tripPaginationState = {
        baseParams: baseParams.toString(),
        offset: 0,
        limit,
        solutions: [],
        requestedDate: date,
        requestedTime: time || '00:00',
        hasMore: true,
        loading: true,
      };

      const firstPageParams = new URLSearchParams(tripPaginationState.baseParams);
      firstPageParams.set('offset', String(tripPaginationState.offset));
      firstPageParams.set('limit', String(tripPaginationState.limit));

      const res = await fetch(`${API_BASE}/api/solutions?${firstPageParams.toString()}`);
      const json = await res.json();

      if (!json.ok) {
        tripResults.innerHTML = '';
        setInlineError(tripError, `Errore: ${json.error || 'Sconosciuto'}`);
        tripPaginationState = null;
        return;
      }

      setInlineError(tripError, '');
      const pageSolutions = Array.isArray(json.solutions) ? json.solutions : [];
      tripPaginationState.solutions = pageSolutions;
      tripPaginationState.offset += pageSolutions.length;
      tripPaginationState.hasMore = pageSolutions.length === tripPaginationState.limit;
      tripPaginationState.loading = false;

      renderTripResults(tripPaginationState.solutions, {
        requestedDate: tripPaginationState.requestedDate,
        requestedTime: tripPaginationState.requestedTime,
        showLoadMoreButton: tripPaginationState.hasMore,
        loadMoreLoading: false,
      });

    } catch (err) {
      console.error(err);
      tripResults.innerHTML = '';
      setInlineError(tripError, 'Errore di rete.');
      tripPaginationState = null;
    }
  });
}

function renderTripResults(solutions, context = {}) {
  if (!solutions || solutions.length === 0) {
    tripResults.innerHTML = '<div class="info">Nessuna soluzione trovata.</div>';
    return;
  }

  const requestedDateKey = (context.requestedDate || '').toString().trim();
  const toLocalDateKey = (dt) => {
    const d = dt instanceof Date ? dt : new Date(dt);
    if (Number.isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  const formatItDayLong = (dt) => {
    const d = dt instanceof Date ? dt : new Date(dt);
    if (Number.isNaN(d.getTime())) return '';
    const formatted = new Intl.DateTimeFormat('it-IT', {
      weekday: 'long',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    }).format(d);
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  };

  const solutionsByDay = new Map();
  for (const item of solutions) {
    const sol = item?.solution || item;
    const depDateObj = new Date(sol?.departureTime);
    const depDateKey = !Number.isNaN(depDateObj.getTime()) ? toLocalDateKey(depDateObj) : 'unknown';
    if (!solutionsByDay.has(depDateKey)) solutionsByDay.set(depDateKey, []);
    solutionsByDay.get(depDateKey).push(item);
  }

  const isValidDateKey = (k) => /^\d{4}-\d{2}-\d{2}$/.test(String(k || ''));
  const asMidnightDate = (k) => {
    if (!isValidDateKey(k)) return null;
    const d = new Date(`${k}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  let orderedDayKeys = Array.from(solutionsByDay.keys());
  if (requestedDateKey) {
    orderedDayKeys = orderedDayKeys.filter((k) => k !== requestedDateKey);
    orderedDayKeys.sort((a, b) => String(a).localeCompare(String(b)));
    orderedDayKeys.unshift(requestedDateKey);
  } else {
    orderedDayKeys.sort((a, b) => String(a).localeCompare(String(b)));
  }

  const seen = new Set();
  orderedDayKeys = orderedDayKeys.filter((k) => {
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  let html = '<div class="solutions-list">';

  orderedDayKeys.forEach((dayKey, groupIdx) => {
    const groupItems = solutionsByDay.get(dayKey) || [];
    if (groupItems.length === 0) return;

    let groupLabel = '';
    if (dayKey === 'unknown') {
      groupLabel = 'Data non disponibile';
    } else {
      const d = asMidnightDate(dayKey);
      groupLabel = d ? formatItDayLong(d) : dayKey;
    }

    html += `<div class="solutions-day-label" data-day="${escapeHtml(String(dayKey))}">${escapeHtml(groupLabel)}</div>`;

    groupItems.forEach(item => {
    // A volte l'oggetto è { solution: {...}, ... } altre volte è direttamente la soluzione
    const sol = item.solution || item;

    const depDateObj = new Date(sol.departureTime);
    const arrDateObj = new Date(sol.arrivalTime);
    const depDayKey = toLocalDateKey(depDateObj);
    const arrDayKey = toLocalDateKey(arrDateObj);
    const depTime = depDateObj.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const arrTime = arrDateObj.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const duration = sol.duration || '-'; 

    const isPast = !Number.isNaN(depDateObj.getTime()) && depDateObj.getTime() < Date.now();
    const whenHtml = isPast ? '<div class="sol-when">Questa soluzione è nel passato</div>' : '';
    const endDayHtml = (!isPast && depDayKey && arrDayKey && depDayKey !== arrDayKey)
      ? `<div class="sol-end-day">Termina ${escapeHtml(formatItDayLong(arrDateObj))}</div>`
      : '';
    
    // Treni: cerchiamo in diverse proprietà possibili.
    // Priorità a 'nodes' o 'solutionSegments' che contengono orari e stazioni per ogni tratta.
    const vehicleList = sol.nodes || sol.solutionSegments || sol.segments || sol.trains || sol.vehicles || [];

    const buildTrainIdentFromNode = (n) => {
      let ident = '';
      let num = '';
      const t = n?.train || n;

      if (t?.name && /^\d+$/.test(t.name)) {
        num = t.name;
        const cat = t.acronym || t.denomination || t.trainCategory || 'Treno';
        ident = `${cat} ${num}`;
      } else if (t?.number) {
        num = t.number;
        const cat = t.acronym || t.trainCategory || 'Treno';
        ident = `${cat} ${num}`;
      } else if (typeof t?.trainIdentifier === 'string') {
        ident = t.trainIdentifier;
      } else if (t?.transportMeanIdentifier) {
        ident = t.transportMeanIdentifier;
      } else if (t?.transportMeanAcronym && t?.transportMeanName) {
         ident = `${t.transportMeanAcronym} ${t.transportMeanName}`;
      } else {
         ident = t?.trainName || t?.acronym || t?.transportMeanName || 'Treno';
      }

      ident = (ident || '').toString().trim();
      if (!num) {
        const match = ident.match(/(\d+)/);
        if (match) num = match[0];
      }
      if (!ident || ident === num) ident = 'Treno ' + (num || '');
      return ident;
    };
    
    const deriveKindCodeFromIdent = (ident, t) => {
      const meta = resolveTrainKindFromCode(
        ident,
        t?.acronym,
        t?.denomination,
        t?.trainCategory,
        t?.trainName,
        t?.transportMeanIdentifier,
        t?.transportMeanAcronym,
        t?.transportMeanName
      );
      return normalizeTrainShortCode(meta?.shortCode);
    };

    // Helper per determinare la classe CSS in base al tipo di treno
    const getTrainTypeClass = (kindCode, ident) => {
      const k = normalizeTrainShortCode(kindCode);
      if (['FR', 'FA', 'FB', 'TGV', 'RJ', 'ITA', 'ES', 'ESC'].includes(k)) return 'train-type-fr';
      if (['IC', 'ICN', 'EC', 'EN'].includes(k)) return 'train-type-ic';
      if (['R', 'REG', 'RV', 'REX', 'RE', 'IREG', 'IR', 'LEX', 'SUB', 'MET', 'SFM', 'D', 'DIR', 'DD', 'ACC', 'MXP', 'FL', 'PEXP', 'PE', 'TEXP', 'CEXP', 'BUS', 'BU'].includes(k)) return 'train-type-reg';

      const s = (ident || '').toUpperCase();
      if (s.includes('EUROCITY') || s.includes('EC ') || s.includes('EURONIGHT') || s.includes('EN ')) return 'train-type-ec';
      return 'train-type-other';
    };

    // Helper per generare il badge del treno
    const getTrainBadge = (n, options = {}) => {
      const clickable = options.clickable !== false;
        let ident = '';
        let num = '';
        const t = n.train || n;

        if (t.name && /^\d+$/.test(t.name)) {
            num = t.name;
            const cat = t.acronym || t.denomination || t.trainCategory || 'Treno';
            ident = `${cat} ${num}`;
        } else if (t.number) {
            num = t.number;
            const cat = t.acronym || t.trainCategory || 'Treno';
            ident = `${cat} ${num}`;
        } else if (typeof t.trainIdentifier === 'string') {
            ident = t.trainIdentifier;
        } else if (t.transportMeanIdentifier) {
            ident = t.transportMeanIdentifier;
        } else if (t.transportMeanAcronym && t.transportMeanName) {
             ident = `${t.transportMeanAcronym} ${t.transportMeanName}`;
        } else {
             ident = t.trainName || t.acronym || t.transportMeanName || 'Treno';
        }
        
        ident = ident.trim();
        if (!num) {
            const match = ident.match(/(\d+)/);
            if (match) num = match[0];
        }
        if (!ident || ident === num) ident = 'Treno ' + (num || '');

        const kindCode = deriveKindCodeFromIdent(ident, t);
        const typeClass = getTrainTypeClass(kindCode, ident);
        const badgeIconAlt = kindCode || 'Treno';
        const logoHtml = `<span class=\"train-badge-icon\" aria-hidden=\"true\">${getTrainKindIconMarkup(kindCode, { alt: badgeIconAlt })}</span>`;

        if (num && clickable) {
          return `<button type="button" class="train-badge train-link ${typeClass}" data-num="${num}" data-kind="${escapeHtml(kindCode)}" title="Vedi stato treno ${num}">${logoHtml} ${ident}</button>`;
        }
        return `<span class="train-badge ${typeClass}" data-kind="${escapeHtml(kindCode)}">${logoHtml} ${ident}</span>`;
    };

    const solutionIconCodes = Array.from(
        new Set(
            vehicleList
              .map((node) => {
                  const ident = buildTrainIdentFromNode(node);
                  const t = node?.train || node;
            const code = deriveKindCodeFromIdent(ident, t);
            if (code && code.startsWith('R') && code !== 'RJ') return 'REG';
            return REGIONAL_ICON_CODES.has(code) ? 'REG' : code;
              })
              .filter(Boolean)
        )
    );

    const buildSolutionIconsHtml = (codes) => {
      if (!codes || codes.length === 0) return '';

      const renderIcon = (code) => {
        const alt = code;
        return `<span class=\"sol-train-icon\" data-kind=\"${escapeHtml(code)}\">${getTrainKindIconMarkup(code, { alt })}</span>`;
      };

      const parts = [];
      codes.forEach((code, idx) => {
        if (idx > 0) parts.push('<span class="sol-train-plus">+</span>');
        parts.push(renderIcon(code));
      });

      return `<span class="sol-times-icons" aria-hidden="true">${parts.join('')}</span>`;
    };

    const solutionIconsHtml = buildSolutionIconsHtml(solutionIconCodes);

    let trainsHtml = '';
    let segmentsHtml = '';

    const formatItMoney = (amount) => {
      if (amount === null || amount === undefined || amount === '') return '';
      const n = typeof amount === 'number'
        ? amount
        : Number(String(amount).replace(',', '.'));
      if (!Number.isFinite(n)) return '';

      const rounded = Math.round(n);
      const isIntLike = Math.abs(n - rounded) < 1e-9;
      if (isIntLike) {
        return new Intl.NumberFormat('it-IT', {
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(rounded);
      }

      return new Intl.NumberFormat('it-IT', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n);
    };

    const extractTrainNumber = (t) => {
      if (!t) return '';
      if (t.name && /^\d+$/.test(t.name)) return t.name;
      if (t.number && /^\d+$/.test(String(t.number))) return String(t.number);
      const ident = String(
        t.trainIdentifier ||
        t.transportMeanIdentifier ||
        t.trainName ||
        t.acronym ||
        t.transportMeanName ||
        ''
      );
      const m = ident.match(/(\d+)/);
      return m ? m[1] : '';
    };

    const formatTime = (d) => {
      if (!d) return '--:--';
      const date = new Date(d);
      return Number.isNaN(date.getTime())
        ? '--:--'
        : date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    };

    if (vehicleList.length > 1) {
      // Vista riassuntiva (con cambi)
      const changes = vehicleList.length - 1;
      const changesLabel = changes === 1 ? 'cambio' : 'cambi';
      trainsHtml = `<span class="train-badge badge-summary">${changes} ${changesLabel}</span>`;
    } else {
      // Diretto: badge con icona bolt.svg
      trainsHtml = `<span class="train-badge badge-summary badge-direct"><picture aria-hidden="true"><source srcset="img/bolt_white.svg" media="(prefers-color-scheme: dark)" /><img src="img/bolt_black.svg" alt="" class="badge-bolt" /></picture> diretto</span>`;
    }

    // Dettagli viaggio: sempre presenti quando abbiamo almeno un mezzo
    if (vehicleList.length > 0) {
      let innerSegments = '<div class="sol-segments">';
      vehicleList.forEach((node, idx) => {
        const tNode = node?.train || node;
        const nodeTrainNum = extractTrainNumber(tNode);
        const nodeIdent = buildTrainIdentFromNode(node);
        const nodeKind = deriveKindCodeFromIdent(nodeIdent, tNode);

        const compactTrainLabel = (() => {
          const num = String(nodeTrainNum || '').trim();
          const kind = String(nodeKind || '').trim();
          if (kind && num) return `${kind} ${num}`;
          if (num) return `Treno ${num}`;
          return String(nodeIdent || 'Treno').trim() || 'Treno';
        })();

        const nodeIconAlt = nodeKind ? String(nodeKind) : 'Treno';
        const nodeIconHtml = `<span class="sol-segment-train-icon" aria-hidden="true">${getTrainKindIconMarkup(nodeKind, { alt: nodeIconAlt })}</span>`;

        const dep = formatTime(node.departureTime);
        const arr = formatTime(node.arrivalTime);
        const origin = node.origin || node.startLocation || '';
        const dest = node.destination || node.endLocation || '';

        const safeOrigin = escapeHtml(origin);
        const safeDest = escapeHtml(dest);

        const itineraryInnerHtml = `
            <span class="sol-itinerary-time">${dep}</span>
            <span class="sol-itinerary-station">${safeOrigin}</span>
            <span class="sol-itinerary-arrow" aria-hidden="true">→</span>
            <span class="sol-itinerary-time">${arr}</span>
            <span class="sol-itinerary-station">${safeDest}</span>
        `;

        const segmentInnerHtml = `
            <span class="sol-segment-train">${nodeIconHtml}${escapeHtml(compactTrainLabel)}</span>
            <span class="sol-segment-itinerary"><span class="sol-itinerary-compact">${itineraryInnerHtml}</span></span>
        `;

        const segmentRowHtml = nodeTrainNum
          ? `<button type="button" class="sol-segment-row train-link" data-num="${escapeHtml(nodeTrainNum)}" title="Vedi stato treno ${escapeHtml(nodeTrainNum)}">${segmentInnerHtml}</button>`
          : `<div class="sol-segment-row">${segmentInnerHtml}</div>`;

        innerSegments += `
            <div class="sol-segment">
                ${segmentRowHtml}
            </div>
        `;

        if (idx < vehicleList.length - 1) {
          const nextNode = vehicleList[idx + 1];
          const arrDate = new Date(node.arrivalTime);
          const nextDepDate = new Date(nextNode.departureTime);

          if (!Number.isNaN(arrDate.getTime()) && !Number.isNaN(nextDepDate.getTime())) {
            const diffMs = nextDepDate - arrDate;
            const diffMins = Math.floor(diffMs / 60000);
            innerSegments += `<div class="sol-transfer">&#x21C6; Cambio a ${safeDest} <span class="transfer-time">· ${diffMins} min</span></div>`;
          } else {
            innerSegments += `<div class="sol-transfer">&#x21C6; Cambio a ${safeDest}</div>`;
          }
        }
      });
      innerSegments += '</div>';

      segmentsHtml = `
          <details class="sol-details">
              <summary class="sol-summary">
                  <span class="sol-summary-text">Dettagli viaggio</span>
                  <span class="sol-summary-icon">▼</span>
              </summary>
              ${innerSegments}
          </details>
      `;
    }

    // Prezzo
    const rawAmount =
      (sol.price && sol.price.amount !== undefined ? sol.price.amount : undefined) ??
      (item.price && item.price.amount !== undefined ? item.price.amount : undefined) ??
      (sol.minPrice && sol.minPrice.amount !== undefined ? sol.minPrice.amount : undefined);

    const formattedAmount = formatItMoney(rawAmount);
    const price = formattedAmount ? `${formattedAmount}€` : 'N/A';

    html += `
      <div class="solution-card">
        <div class="sol-header">
            <div class="sol-info">
                <div class="sol-times">
                  <div class="sol-time">${depTime}</div>
                  <div class="sol-arrow">→</div>
                  <div class="sol-time">${arrTime}</div>
                  ${solutionIconsHtml}
                </div>
                <div class="sol-meta">
                    <div class="sol-duration">${duration}</div>
                  ${whenHtml}
                  ${endDayHtml}
                    <div class="sol-trains">${trainsHtml}</div>
                </div>
            </div>
            <div class="sol-price-box">
                <div class="sol-price">${price}</div>
            </div>
        </div>
        ${segmentsHtml}
      </div>
    `;
    });
  });
  
  html += '</div>';

  const showLoadMoreButton = Boolean(context.showLoadMoreButton);
  const loadMoreLoading = Boolean(context.loadMoreLoading);
  if (showLoadMoreButton) {
    const label = loadMoreLoading ? 'Caricamento…' : 'Carica altre soluzioni';
    const disabledAttr = loadMoreLoading ? 'disabled' : '';
    html += `<div class="solutions-actions"><button type="button" id="tripLoadMoreBtn" ${disabledAttr}>${label}</button></div>`;
  }

  tripResults.innerHTML = html;
}

if (tripResults) {
  tripResults.addEventListener('click', (e) => {
    const loadMore = e.target.closest('#tripLoadMoreBtn');
    if (loadMore) {
      if (!tripPaginationState || tripPaginationState.loading || !tripPaginationState.hasMore) return;

      (async () => {
        try {
          tripPaginationState.loading = true;
          renderTripResults(tripPaginationState.solutions, {
            requestedDate: tripPaginationState.requestedDate,
            requestedTime: tripPaginationState.requestedTime,
            showLoadMoreButton: true,
            loadMoreLoading: true,
          });

          const nextParams = new URLSearchParams(tripPaginationState.baseParams);
          nextParams.set('offset', String(tripPaginationState.offset));
          nextParams.set('limit', String(tripPaginationState.limit));
          const res = await fetch(`${API_BASE}/api/solutions?${nextParams.toString()}`);
          const json = await res.json();

          if (!json.ok) {
            setInlineError(tripError, `Errore: ${json.error || 'Sconosciuto'}`);
            tripPaginationState.loading = false;
            renderTripResults(tripPaginationState.solutions, {
              requestedDate: tripPaginationState.requestedDate,
              requestedTime: tripPaginationState.requestedTime,
              showLoadMoreButton: tripPaginationState.hasMore,
              loadMoreLoading: false,
            });
            return;
          }

          const pageSolutions = Array.isArray(json.solutions) ? json.solutions : [];
          tripPaginationState.solutions = tripPaginationState.solutions.concat(pageSolutions);
          tripPaginationState.offset += pageSolutions.length;
          tripPaginationState.hasMore = pageSolutions.length === tripPaginationState.limit;
          tripPaginationState.loading = false;

          renderTripResults(tripPaginationState.solutions, {
            requestedDate: tripPaginationState.requestedDate,
            requestedTime: tripPaginationState.requestedTime,
            showLoadMoreButton: tripPaginationState.hasMore,
            loadMoreLoading: false,
          });
        } catch (err) {
          console.error(err);
          setInlineError(tripError, 'Errore di rete.');
          if (tripPaginationState) tripPaginationState.loading = false;
          if (tripPaginationState?.solutions?.length) {
            renderTripResults(tripPaginationState.solutions, {
              requestedDate: tripPaginationState.requestedDate,
              requestedTime: tripPaginationState.requestedTime,
              showLoadMoreButton: tripPaginationState.hasMore,
              loadMoreLoading: false,
            });
          }
        }
      })();

      return;
    }

    const btn = e.target.closest('.train-link');
    if (btn) {
      const num = btn.getAttribute('data-num');
      if (num) {
        if (trainNumberInput) trainNumberInput.value = num;
        cercaStatoTreno(num, { useRememberedChoice: true });
        scrollToSection(trainSearchSection);
      }
    }
  });
}

if (tripClearBtn) {
  tripClearBtn.addEventListener('click', () => {
    setInlineError(tripError, '');
    if (tripFromInput) tripFromInput.value = '';
    if (tripToInput) tripToInput.value = '';
    if (tripDateInput) tripDateInput.value = '';
    if (tripTimeInput) tripTimeInput.value = '';
    if (tripResults) tripResults.innerHTML = '';
    tripFromId = null;
    tripToId = null;
    tripPaginationState = null;
  });
}
  const activeIndex = (() => {
    if (activeIndexOverride != null) return activeIndexOverride;
    const activeCodeRaw = (opts.activeCode || '').toString().trim();
    const activeCodeKey = activeCodeRaw ? normalizeStationCode(activeCodeRaw) : '';
    if (activeCodeKey) {
      const idx = cleaned.findIndex((p) => normalizeStationCode(p.code) === activeCodeKey);
      if (idx >= 0) return idx;
    }
    const activeLabelKey = normalizeStationSearchKey((opts.activeLabel || '').toString());
    if (activeLabelKey) {
      const idx = cleaned.findIndex((p) => normalizeStationSearchKey(p.label) === activeLabelKey);
      if (idx >= 0) return idx;
    }
    return null;
  })();
