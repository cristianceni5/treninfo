// Developed by Cristian Ceni 2025 dhn missile
// Aggiornato il backend per l'app mobile sennò era un casino
// src/app.js - Backend ViaggiaTreno per Netlify Functions

const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();

// Carica stations.json per normalizzazione nomi stazioni
let stationsMap = {};
let stationsById = {};
let stationsByLefrecce = {};
try {
  const stationsPath = path.join(__dirname, '..', 'stations.json');
  const stationsData = JSON.parse(fs.readFileSync(stationsPath, 'utf8'));
  // Crea mappe per lookup veloce
  stationsData.forEach(station => {
    if (station.id) {
      stationsMap[station.id] = station.name || station.id;
      stationsById[station.id] = station;
      if (station.lefrecceId) {
        stationsByLefrecce[station.lefrecceId] = station;
      }
    }
  });
  console.log(`✅ Caricati ${Object.keys(stationsMap).length} nomi stazioni da stations.json`);
  console.log(`✅ ${Object.keys(stationsByLefrecce).length} stazioni con lefrecceId`);
} catch (err) {
  console.warn('⚠️ Impossibile caricare stations.json:', err.message);
}

// ============================================================================
// CORS Configuration
// ============================================================================
// Se vuoi restringere le origini, imposta la variabile d'ambiente:
// CORS_ORIGINS="https://tuodominio.com,http://localhost:5173"
const CORS_ORIGINS = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Alcune richieste (curl/server-to-server) non hanno origin.
      if (!origin) return callback(null, true);
      // Default: comportamento attuale (tutto aperto) se non configuri nulla.
      if (CORS_ORIGINS.length === 0) return callback(null, true);
      if (CORS_ORIGINS.includes(origin)) return callback(null, true);
      return callback(new Error('CORS origin non permessa'), false);
    },
  })
);

// ============================================================================
// Middleware
// ============================================================================

// Parser JSON per body delle richieste POST
app.use(express.json());

// Rimuove il prefisso /.netlify/functions/api quando deployato su Netlify
app.use((req, res, next) => {
  if (req.path.startsWith('/.netlify/functions/api')) {
    req.url = req.url.replace('/.netlify/functions/api', '');
  }
  next();
});

// ============================================================================
// Configurazione API Base URLs
// ============================================================================

// Base URL per le API ViaggiaTreno REST
const BASE_URL = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';

// Base URL per tabellone HTML (versione "new")
const BASE_URL_BOARD = 'http://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno';

// Base URL per API LeFrecce (ricerca soluzioni di viaggio)
const LEFRECCE_BASE = 'https://www.lefrecce.it/Channels.Website.BFF.WEB';

// ============================================================================
// Helper Fetch con Timeout
// ============================================================================

// Timeout per richieste HTTP in millisecondi (default: 12 secondi)
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 12000);

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

// Helper per fetch testo
async function fetchText(url) {
  const resp = await fetchWithTimeout(url);
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status} per ${url}`);
    err.status = resp.status;
    throw err;
  }
  return resp.text();
}

// Helper per fetch JSON
async function fetchJson(url) {
  const resp = await fetchWithTimeout(url);
  if (resp.status === 204) {
    const err = new Error('204 No Content');
    err.status = 204;
    throw err;
  }
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status} per ${url}`);
    err.status = resp.status;
    throw err;
  }
  return resp.json();
}

// Parser per valori booleani da query string o body
function parseBool(val, defaultVal = false) {
  if (val === undefined || val === null) return defaultVal;
  if (typeof val === 'boolean') return val;
  const s = String(val).toLowerCase().trim();
  if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(s)) return false;
  return defaultVal;
}

// ============================================================================
// Utility per Gestione Timestamp e Date
// ============================================================================

// In ambienti serverless (es. Netlify) il timezone di sistema può essere UTC.
// I timestamp RFI sono epoch millis: per visualizzare l'orario corretto in Italia
// formattiamo esplicitamente in Europe/Rome.
const APP_TIME_ZONE = process.env.APP_TIME_ZONE || 'Europe/Rome';
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

function parseToMillis(raw) {
  if (raw == null) return null;
  if (typeof raw === 'number') {
    if (!Number.isNaN(raw) && raw > 1e11 && raw < 1e13) return raw;
    return null;
  }

  const str = String(raw).trim();
  if (!str) return null;

  if (/^\d+$/.test(str)) {
    if (str.length === 13) return Number(str);
    if (str.length === 12 || str.length === 14) {
      const year = Number(str.slice(0, 4));
      const month = Number(str.slice(4, 6)) - 1;
      const day = Number(str.slice(6, 8));
      const hour = Number(str.slice(8, 10));
      const minute = Number(str.slice(10, 12));
      const second = str.length === 14 ? Number(str.slice(12, 14)) : 0;
      const d = new Date(year, month, day, hour, minute, second);
      const ms = d.getTime();
      return Number.isNaN(ms) ? null : ms;
    }
  }

  // Gestione formato HH:mm senza data
  const hhmm = str.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (hhmm) {
    const hour = Number(hhmm[1]);
    const minute = Number(hhmm[2]);
    // Data fittizia: 1970-01-01
    return new Date(1970, 0, 1, hour, minute, 0, 0).getTime();
  }

  const parsed = Date.parse(str);
  return Number.isNaN(parsed) ? null : parsed;
}

function pickFirstTimeMs(source = {}, keys = []) {
  for (const key of keys) {
    if (!key) continue;
    const value = source[key];
    const ms = parseToMillis(value);
    if (ms != null) return ms;
  }
  return null;
}

function getScheduledDepartureMs(data) {
  const stops = Array.isArray(data?.fermate) ? data.fermate : [];
  if (!stops.length) return null;
  const first = stops[0];
  return (
    pickFirstTimeMs(first, [
      'partenza_teorica',
      'partenzaTeorica',
      'partenzaProgrammata',
      'programmata',
      'partenza',
    ]) ||
    pickFirstTimeMs(data, ['orarioPartenza', 'orarioPartenzaZero'])
  );
}

function getActualArrivalMs(data) {
  const stops = Array.isArray(data?.fermate) ? data.fermate : [];
  if (!stops.length) return null;
  const last = stops[stops.length - 1];
  return (
    pickFirstTimeMs(last, [
      'arrivoReale',
      'arrivo_reale',
      'arrivoRealeZero',
      'arrivoEffettivo',
      'arrivoRealeTTT',
    ]) || pickFirstTimeMs(last, ['partenzaReale', 'partenza_reale'])
  );
}

function runLooksFuture(data, nowMs) {
  const departureMs = getScheduledDepartureMs(data);
  if (!departureMs) return false;
  const TWELVE_HOURS = 12 * 60 * 60 * 1000;
  return departureMs - nowMs > TWELVE_HOURS;
}

function trainStillRunning(data, nowMs) {
  if (!data) return false;
  if (runLooksFuture(data, nowMs)) return false;
  const arrivalMs = getActualArrivalMs(data);
  if (arrivalMs && arrivalMs <= nowMs) {
    return false;
  }
  return true;
}

async function fetchTrainStatusSnapshot(originCode, trainNumber, epochMs) {
  const url = `${BASE_URL}/andamentoTreno/${encodeURIComponent(
    originCode
  )}/${encodeURIComponent(trainNumber)}/${epochMs}`;
  try {
    return await fetchJson(url);
  } catch (err) {
    if (err.status === 204) {
      return null;
    }
    throw err;
  }
}

// ============================================================================
// Helper: Funzioni per Campi Computed
// ============================================================================

/**
 * Regole per determinare il tipo treno.
 * Ogni regola ha un array di pattern da cercare nei campi JSON RFI,
 * più le etichette da mostrare in UI e la categoria semantica.
 */
const TRAIN_KIND_RULES = [
  // Alta velocità (ordinati per specificity)
  {
    matches: ['FRECCIAROSSA', 'FRECCIAROSSA AV', 'FRECCIAROSSAAV', 'FR', 'FR AV', 'FRAV', 'FR EC', 'FRECCIAROSSA EC'],
    boardLabel: 'FR',
    detailLabel: 'FR',
    category: 'high-speed',
  },
  {
    matches: ['FRECCIARGENTO', 'FRECCIARGENTO AV', 'FRECCIARGENTOAV', 'FA', 'FA AV'],
    boardLabel: 'FA',
    detailLabel: 'FA',
    category: 'high-speed',
  },
  {
    matches: ['FRECCIABIANCA', 'FB'],
    boardLabel: 'FB',
    detailLabel: 'FB',
    category: 'intercity',
  },
  {
    matches: ['ITALO', 'ITALO AV', 'ITALOAV', 'NTV', 'ITA'],
    boardLabel: 'ITA',
    detailLabel: 'ITA',
    category: 'high-speed',
  },
  {
    matches: ['TGV'],
    boardLabel: 'TGV',
    detailLabel: 'TGV',
    category: 'high-speed',
  },
  {
    matches: ['EUROSTAR', 'EUROSTAR CITY', 'EUROSTARCITY', 'ES', 'ESC', 'ES CITY', 'ES AV', 'ESAV', 'ES FAST'],
    boardLabel: 'ES',
    detailLabel: 'ES',
    category: 'high-speed',
  },
  // Intercity (ordinati per specificity)
  {
    matches: ['INTERCITY NOTTE', 'INTERCITYNOTTE', 'ICN'],
    boardLabel: 'ICN',
    detailLabel: 'ICN',
    category: 'intercity',
  },
  {
    matches: ['INTERCITY', 'IC'],
    boardLabel: 'IC',
    detailLabel: 'IC',
    category: 'intercity',
  },
  {
    matches: ['EUROCITY', 'EC'],
    boardLabel: 'EC',
    detailLabel: 'EC',
    category: 'intercity',
  },
  {
    matches: ['EURONIGHT', 'EN'],
    boardLabel: 'EN',
    detailLabel: 'EN',
    category: 'intercity',
  },
  {
    matches: ['RAILJET', 'RJ'],
    boardLabel: 'RJ',
    detailLabel: 'RJ',
    category: 'intercity',
  },
  {
    matches: ['ESPRESSO', 'EXP'],
    boardLabel: 'EXP',
    detailLabel: 'EXP',
    category: 'intercity',
  },
  // Regionali (ordinati per specificity - prima i più specifici)
  {
    matches: ['REGIONALE VELOCE', 'REGIONALEVELOCE', 'RV', 'RGV'],
    boardLabel: 'RV',
    detailLabel: 'RV',
    category: 'regional',
  },
  {
    matches: ['REGIONALE', 'REG'],
    boardLabel: 'REG',
    detailLabel: 'REG',
    category: 'regional',
  },
  {
    matches: ['INTERREGIONALE', 'IR'],
    boardLabel: 'IREG',
    detailLabel: 'IREG',
    category: 'regional',
  },
  {
    matches: ['REGIOEXPRESS', 'REGIO EXPRESS', 'RE'],
    boardLabel: 'REX',
    detailLabel: 'REX',
    category: 'regional',
  },
  {
    matches: ['LEONARDO EXPRESS', 'LEONARDOEXPRESS', 'LEONARDO', 'LEX'],
    boardLabel: 'LEX',
    detailLabel: 'LEX',
    category: 'regional',
  },
  {
    matches: ['MALPENSA EXPRESS', 'MALPENSAEXPRESS', 'MXP'],
    boardLabel: 'MXP',
    detailLabel: 'MXP',
    category: 'regional',
  },
  {
    matches: ['TROPEA EXPRESS', 'TROPEAEXPRESS', 'TROPEA', 'TEXP'],
    boardLabel: 'TEXP',
    detailLabel: 'TEXP',
    category: 'regional',
  },
  {
    matches: ['CIVITAVECCHIA EXPRESS', 'CIVITAVECCHIAEXPRESS', 'CIVITAVECCHIA', 'CEXP'],
    boardLabel: 'CEXP',
    detailLabel: 'CEXP',
    category: 'regional',
  },
  {
    matches: ['PANORAMA EXPRESS', 'PANORAMAEXPRESS', 'PE'],
    boardLabel: 'PEXP',
    detailLabel: 'PEXP',
    category: 'regional',
  },
  {
    matches: ['DIRETTISSIMO', 'DD'],
    boardLabel: 'DD',
    detailLabel: 'DD',
    category: 'regional',
  },
  {
    matches: ['DIRETTO', 'DIR'],
    boardLabel: 'DIR',
    detailLabel: 'DIR',
    category: 'regional',
  },
  {
    matches: ['ACCELERATO', 'ACC'],
    boardLabel: 'ACC',
    detailLabel: 'ACC',
    category: 'regional',
  },
  {
    matches: ['SUBURBANO', 'SERVIZIO SUBURBANO', 'SUB'],
    boardLabel: 'SUB',
    detailLabel: 'SUB',
    category: 'regional',
  },
  {
    matches: ['METROPOLITANO', 'MET', 'METROPOLITANA', 'SFM'],
    boardLabel: 'MET',
    detailLabel: 'MET',
    category: 'regional',
  },
  {
    matches: ['FERROVIE LAZIALI', 'FL'],
    boardLabel: 'FL',
    detailLabel: 'FL',
    category: 'regional',
  },
  {
    matches: ['AIRLINK'],
    boardLabel: 'Airlink',
    detailLabel: 'Airlink',
    category: 'regional',
  },
  // Pattern generici (DEVONO stare alla fine per non matchare troppo presto)
  {
    matches: ['R'],
    boardLabel: 'R',
    detailLabel: 'R',
    category: 'regional',
  },
  // Bus
  {
    matches: ['BUS', 'BU', 'FI'],
    boardLabel: 'BUS',
    detailLabel: 'BUS',
    category: 'bus',
  },
];

/**
 * Risolve il tipo di treno analizzando i campi categoriaDescrizione, categoria, tipoTreno, compNumeroTreno.
 * Restituisce { code, label, category } dove:
 * - code: codice breve (es. "FR", "IC", "REG")
 * - label: etichetta estesa (es. "FR AV", "Intercity")
 * - category: categoria semantica (high-speed, intercity, regional, bus, unknown)
 */
function resolveTrainKind(...rawValues) {
  for (const raw of rawValues) {
    if (!raw) continue;
    const normalized = String(raw)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');

    // Prima estrai la sigla iniziale se presente (es. "FR 9544" → "FR", "REG 12345" → "REG")
    const prefixMatch = normalized.match(/^([A-Z]{1,4})\b/);
    const prefix = prefixMatch ? prefixMatch[1] : '';
    
    // Cerca prima usando la sigla estratta (più preciso)
    if (prefix) {
      for (const rule of TRAIN_KIND_RULES) {
        if (rule.matches.includes(prefix)) {
          return {
            code: rule.boardLabel,
            label: rule.detailLabel,
            category: rule.category,
          };
        }
      }
    }

    // Altrimenti cerca nella stringa completa (match esatto, non substring)
    for (const rule of TRAIN_KIND_RULES) {
      if (rule.matches.includes(normalized)) {
        return {
          code: rule.boardLabel,
          label: rule.detailLabel,
          category: rule.category,
        };
      }
    }
  }
  return { code: 'UNK', label: 'Sconosciuto', category: 'unknown' };
}

/**
 * Calcola il ritardo globale in minuti.
 * Priorità: campo ritardo (number), poi parsing da compRitardo[0].
 * Ritorna number (può essere negativo = anticipo) o null se non disponibile.
 */
function computeGlobalDelay(data) {
  // Priorità: campo ritardo diretto, poi parsing da compRitardo
  if (data.ritardo != null && !Number.isNaN(Number(data.ritardo))) {
    return Number(data.ritardo);
  }
  if (Array.isArray(data.compRitardo) && data.compRitardo.length > 0) {
    const txt = data.compRitardo[0] || '';
    const match = txt.match(/(-?\d+)\s*min/);
    if (match) {
      const parsed = Number(match[1]);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
}

/**
 * Determina lo stato della corsa (PLANNED, RUNNING, COMPLETED, CANCELLED, PARTIAL, UNKNOWN).
 * Analizza:
 * - trenoSoppresso: true → CANCELLED
 * - fermateSoppresse non vuoto → PARTIAL
 * - presenza orari reali → RUNNING o COMPLETED
 * - assenza orari reali → PLANNED
 */
function computeJourneyState(data) {
  const fermate = Array.isArray(data.fermate) ? data.fermate : [];
  const hasSuppressed = Array.isArray(data.fermateSoppresse) && data.fermateSoppresse.length > 0;
  const isCancelled = data.trenoSoppresso === true;

  if (isCancelled) {
    return { state: 'CANCELLED', label: 'Soppresso' };
  }
  if (hasSuppressed) {
    return { state: 'PARTIAL', label: 'Parziale' };
  }

  const hasAnyReal = fermate.some((f) => f.partenzaReale != null || f.arrivoReale != null);
  if (!hasAnyReal) {
    return { state: 'PLANNED', label: 'Pianificato' };
  }

  const lastStop = fermate[fermate.length - 1];
  const hasLastArrival = lastStop && (lastStop.arrivoReale != null || lastStop.partenzaReale != null);
  if (hasLastArrival) {
    return { state: 'COMPLETED', label: 'Concluso' };
  }

  return { state: 'RUNNING', label: 'In viaggio' };
}

/**
 * Identifica la fermata attuale del treno.
 * Priorità:
 * 1. Campo stazioneUltimoRilevamento
 * 2. Ultima fermata con orario reale (partenzaReale o arrivoReale)
 * Restituisce { stationName, stationCode, index, timestamp } o null.
 */
function computeCurrentStop(data) {
  const fermate = Array.isArray(data.fermate) ? data.fermate : [];
  if (!fermate.length) return null;

  const lastKnownStation = data.stazioneUltimoRilevamento || '';
  if (lastKnownStation) {
    const idx = fermate.findIndex((f) =>
      (f.stazione || '').toUpperCase() === lastKnownStation.toUpperCase()
    );
    if (idx >= 0) {
      const stationId = fermate[idx].id || '';
      return {
        stationName: stationsMap[stationId] || normalizeStationName(fermate[idx].stazione),
        stationCode: stationId,
        index: idx,
        timestamp: data.oraUltimoRilevamento || null,
      };
    }
  }

  // Fallback: ultima fermata con orario reale
  for (let i = fermate.length - 1; i >= 0; i--) {
    if (fermate[i].partenzaReale != null || fermate[i].arrivoReale != null) {
      const stationId = fermate[i].id || '';
      return {
        stationName: stationsMap[stationId] || normalizeStationName(fermate[i].stazione),
        stationCode: stationId,
        index: i,
        timestamp: fermate[i].partenzaReale || fermate[i].arrivoReale,
      };
    }
  }

  return null;
}

/**
 * Calcola la prossima fermata del treno basandosi sulla fermata attuale.
 * @returns {string|null} Nome della prossima fermata o null
 */
function computeNextStop(data, currentStop) {
  const fermate = Array.isArray(data.fermate) ? data.fermate : [];
  if (!fermate.length || !currentStop) return null;
  
  const currentIndex = currentStop.index;
  if (currentIndex == null || currentIndex < 0) return null;
  
  // Cerca la prossima fermata non soppressa
  for (let i = currentIndex + 1; i < fermate.length; i++) {
    const fermata = fermate[i];
    const soppressa = fermata.tipoFermata === 'S' || fermata.soppresso === true;
    if (!soppressa) {
      const stationId = fermata.id || '';
      return stationsMap[stationId] || normalizeStationName(fermata.stazione) || null;
    }
  }
  
  return null;
}

/**
 * Formatta ora e luogo dell'ultimo rilevamento.
 * @returns {string|null} Formato: "18:35-PM Rovezzano" o null
 */
function formatLastDetection(data) {
  const time = data.oraUltimoRilevamento;
  const station = data.stazioneUltimoRilevamento;
  
  if (!time || !station) return null;
  
  // Normalizza nome stazione se possibile
  const fermate = Array.isArray(data.fermate) ? data.fermate : [];
  const matchingStop = fermate.find(f => 
    f.stazione && f.stazione.toUpperCase() === station.toUpperCase()
  );
  const normalizedStation = matchingStop ? (stationsMap[matchingStop.id] || normalizeStationName(station)) : normalizeStationName(station);
  
  // Formatta l'ora
  const formattedTime = formatTime(time);
  if (!formattedTime) return null;

  return `${formattedTime} ${normalizedStation}`;
}

/**
 * Restituisce lo stato semplificato del treno per visualizzazione rapida.
 * @returns {string} "programmato", "partito", "soppresso", "concluso", "parziale"
 */
function getSimpleTrainState(journeyState) {
  if (!journeyState || !journeyState.state) return 'programmato';
  
  const stateMap = {
    'PLANNED': 'programmato',
    'RUNNING': 'partito',
    'COMPLETED': 'concluso',
    'CANCELLED': 'soppresso',
    'PARTIAL': 'parziale',
  };
  
  return stateMap[journeyState.state] || 'programmato';
}

/**
 * Formatta un orario da timestamp RFI (es. 1736524800000 o stringa) in formato HH:mm
 */
function formatTime(timestamp) {
  if (!timestamp) return null;
  const ms = parseToMillis(timestamp);
  if (!ms) return null;
  const formatter = getItTimeFormatter();
  if (formatter) {
    try {
      return formatter.format(new Date(ms));
    } catch {
      // fallback sotto
    }
  }

  // Fallback: usa il timezone di sistema
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

/**
 * Calcola l'orario probabile sommando il ritardo (deltaTempo) all'orario programmato.
 * @param {number|string} scheduledTimestamp - Timestamp orario programmato
 * @param {number} delayMinutes - Ritardo in minuti (può essere negativo per anticipo)
 * @returns {string|null} Orario probabile in formato HH:mm
 */
function computeProbableTime(scheduledTimestamp, delayMinutes) {
  if (!scheduledTimestamp) return null;
  const scheduledMs = parseToMillis(scheduledTimestamp);
  if (!scheduledMs) return null;
  
  const delayMs = Number.isFinite(delayMinutes) ? delayMinutes * 60 * 1000 : 0;
  const probableMs = scheduledMs + delayMs;
  return formatTime(probableMs);
}

/**
 * Formatta il deltaTempo come stringa con segno (es. "+5", "-3", "0")
 */
function formatDeltaTempo(delayMinutes) {
  if (!Number.isFinite(delayMinutes)) return null;
  if (delayMinutes === 0) return '0';
  return delayMinutes > 0 ? `+${delayMinutes}` : String(delayMinutes);
}

/**
 * Normalizza un nome stazione: Title Case invece di UPPERCASE
 */
function normalizeStationName(name) {
  if (!name) return '';
  // Converti in title case
  return name
    .toLowerCase()
    .split(' ')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Formatta una singola fermata con tutte le info essenziali
 */
function formatStop(stop, globalDelay) {
  if (!stop) return null;
  
  const delay = Number.isFinite(globalDelay) ? globalDelay : 0;
  
  // Normalizza nome stazione usando stations.json se disponibile
  const stationId = stop.id || '';
  const normalizedName = stationsMap[stationId] || normalizeStationName(stop.stazione) || '';
  
  // Orari programmati
  const orarioArrivoProgrammato = formatTime(stop.arrivo_teorico || stop.arrivo_teorica || stop.arrivoTeorica || stop.arrivoProgrammata);
  const orarioPartenzaProgrammato = formatTime(stop.partenza_teorica || stop.partenzaTeorica || stop.partenzaProgrammata);
  
  // Orari reali (quando disponibili)
  const orarioArrivoReale = formatTime(stop.arrivoReale);
  const orarioPartenzaReale = formatTime(stop.partenzaReale);
  
  // Orari probabili: solo se NON c'è il reale
  const orarioArrivoProbabile = orarioArrivoReale ? null : computeProbableTime(stop.arrivo_teorico || stop.arrivo_teorica || stop.arrivoTeorica || stop.arrivoProgrammata, delay);
  const orarioPartenzaProbabile = orarioPartenzaReale ? null : computeProbableTime(stop.partenza_teorica || stop.partenzaTeorica || stop.partenzaProgrammata, delay);
  
  return {
    stazione: normalizedName,
    id: stationId,
    progressivo: stop.progressivo != null ? stop.progressivo : null,
    
    orarioArrivoProgrammato,
    orarioPartenzaProgrammato,
    orarioArrivoProbabile,
    orarioPartenzaProbabile,
    orarioArrivoReale,
    orarioPartenzaReale,
    
    // Binari
    binarioProgrammato: stop.binarioProgrammatoArrivoDescrizione || stop.binarioProgrammatoPartenzaDescrizione || null,
    binarioReale: stop.binarioEffettivoArrivoDescrizione || stop.binarioEffettivoPartenzaDescrizione || null,
    binarioVariato: stop.binarioEffettivoArrivoDescrizione !== stop.binarioProgrammatoArrivoDescrizione ||
                     stop.binarioEffettivoPartenzaDescrizione !== stop.binarioProgrammatoPartenzaDescrizione,
    
    // Stato fermata
    soppressa: stop.tipoFermata === 'S' || stop.soppresso === true || false,
    
    // Info aggiuntive
    actualFermataType: stop.actualFermataType || null,
    tipoFermata: stop.tipoFermata || null,
  };
}

/**
 * Estrae il messaggio RFI (es. "treno soppresso da A a B")
 */
function extractRfiMessage(data) {
  if (!data) return null;
  
  // Possibili campi per messaggi RFI
  const messages = [];
  
  if (data.subTitle) messages.push(data.subTitle);
  if (data.motivoRitardo) messages.push(data.motivoRitardo);
  if (data.descrizioneTreno) messages.push(data.descrizioneTreno);
  
  // Messaggi da compRitardoAndamento
  if (Array.isArray(data.compRitardoAndamento)) {
    data.compRitardoAndamento.forEach(msg => {
      if (msg && typeof msg === 'string') messages.push(msg);
    });
  }
  
  // Informazioni sulla soppressione
  if (data.trenoSoppresso) {
    if (Array.isArray(data.fermateSoppresse) && data.fermateSoppresse.length > 0) {
      const first = data.fermateSoppresse[0];
      const last = data.fermateSoppresse[data.fermateSoppresse.length - 1];
      messages.unshift(`Treno soppresso da ${first} a ${last}`);
    } else {
      messages.unshift('Treno completamente soppresso');
    }
  }
  
  return messages.filter(Boolean).join(' • ') || null;
}

/**
 * Estrae info aggiuntive (es. "carrozza business in testa al treno")
 */
function extractAdditionalInfo(data) {
  if (!data) return null;
  
  const info = [];
  
  // SubTitle (info generali sul treno)
  if (data.subTitle && typeof data.subTitle === 'string' && data.subTitle.trim()) {
    info.push(data.subTitle.trim());
  }
  
  // Info composizione treno
  if (data.compImgCambiNumero && Array.isArray(data.compImgCambiNumero)) {
    info.push(...data.compImgCambiNumero.filter(Boolean));
  }
  
  // Info orientamento treno (es. "Executive in testa")
  if (Array.isArray(data.compOrientamento) && data.compOrientamento.length > 0) {
    // Prendi solo la prima lingua (italiano)
    const orientamento = data.compOrientamento[0];
    if (orientamento && typeof orientamento === 'string') {
      info.push(orientamento);
    }
  } else if (Array.isArray(data.descOrientamento) && data.descOrientamento.length > 0) {
    // Fallback su descOrientamento
    const orientamento = data.descOrientamento[0];
    if (orientamento && typeof orientamento === 'string') {
      info.push(orientamento);
    }
  }
  
  // Info orari speciali
  if (Array.isArray(data.compOrarioPartenzaZeroEffettivo)) {
    info.push(...data.compOrarioPartenzaZeroEffettivo.filter(Boolean));
  }
  
  // Info servizi e provvedimenti
  if (data.provvedimento && data.provvedimento !== 0 && typeof data.provvedimento === 'string') {
    info.push(data.provvedimento);
  }
  if (data.circolante === false) {
    info.push('Non circolante');
  }
  
  return info.filter(Boolean).join(' • ') || null;
}

/**
 * Arricchisce i dati RFI con campi computati e formattati.
 * Restituisce un oggetto con:
 * - tipologiaTreno: REG, IC, FR, FA, ecc.
 * - numeroTreno: 18828
 * - orarioPartenzaProg: "19:20"
 * - orarioArrivoProg: "22:30"
 * - deltaTempo: "+5" o "-3" o "0"
 * - fermate: array con info formattate
 * - messaggioRfi: "treno soppresso da A a B"
 * - infoAgg: "carrozza business in testa al treno"
 */
function enrichTrainData(data) {
  if (!data) return null;

  const trainKind = resolveTrainKind(
    data.categoriaDescrizione,
    data.categoria,
    data.tipoTreno,
    data.compNumeroTreno
  );

  const globalDelay = computeGlobalDelay(data);
  const journeyState = computeJourneyState(data);
  const currentStop = computeCurrentStop(data);
  
  // Estrai numero treno
  const numeroTreno = String(data.numeroTreno || data.numeroTrenoEsteso || '').trim();
  
  // Calcola orari programmati di partenza e arrivo
  const fermate = Array.isArray(data.fermate) ? data.fermate : [];
  const primaFermata = fermate[0];
  const ultimaFermata = fermate[fermate.length - 1];
  
  // Usa compOrarioPartenza come fallback se non c'è nella prima fermata
  let orarioPartenzaProg = primaFermata 
    ? formatTime(primaFermata.partenza_teorica || primaFermata.partenzaTeorica || primaFermata.partenzaProgrammata)
    : null;
  if (!orarioPartenzaProg && data.compOrarioPartenza) {
    orarioPartenzaProg = String(data.compOrarioPartenza).trim();
  }
    
  // Usa compOrarioArrivo come fallback se non c'è nell'ultima fermata
  let orarioArrivoProg = ultimaFermata
    ? formatTime(ultimaFermata.arrivo_teorico || ultimaFermata.arrivo_teorica || ultimaFermata.arrivoTeorica || ultimaFermata.arrivoProgrammata)
    : null;
  if (!orarioArrivoProg && data.compOrarioArrivo) {
    orarioArrivoProg = String(data.compOrarioArrivo).trim();
  }
  
  // Orari reali (effettivi) di partenza e arrivo
  const orarioPartenzaReale = primaFermata ? formatTime(primaFermata.partenzaReale) : null;
  const orarioArrivoReale = ultimaFermata ? formatTime(ultimaFermata.arrivoReale) : null;
  
  // Formatta le fermate
  const fermateFormattate = fermate.map(stop => formatStop(stop, globalDelay));
  
  // Estrai messaggi e info aggiuntive
  const messaggioRfi = extractRfiMessage(data);
  const infoAgg = extractAdditionalInfo(data);
  
  // Calcola prossima fermata e formato rilevamento
  const prossimaFermata = computeNextStop(data, currentStop);
  const oraLuogoRilevamento = formatLastDetection(data);
  const statoTreno = getSimpleTrainState(journeyState);

  return {
    // Campi originali (mantenuti per compatibilità)
    trainKind,
    globalDelay,
    journeyState,
    currentStop,
    
    // Nuovi campi formattati
    tipologiaTreno: trainKind.code,
    numeroTreno,
    origine: primaFermata ? (stationsMap[primaFermata.id] || normalizeStationName(data.origine) || null) : (normalizeStationName(data.origine) || null),
    destinazione: ultimaFermata ? (stationsMap[ultimaFermata.id] || normalizeStationName(data.destinazione) || null) : (normalizeStationName(data.destinazione) || null),
    orarioPartenzaProg,
    orarioArrivoProg,
    orarioPartenzaReale,
    orarioArrivoReale,
    deltaTempo: formatDeltaTempo(globalDelay),
    fermate: fermateFormattate,
    messaggioRfi,
    infoAgg,
    
    // Campi stato e posizione
    statoTreno,
    prossimaFermata,
    oraLuogoRilevamento,
  };
}

// ============================================================================
// API Routes
// ============================================================================

// ----------------------------------------------------------------------------
// Autocomplete stazioni (ViaggiaTreno)
// GET /api/viaggiatreno/autocomplete?query=FIREN
// ----------------------------------------------------------------------------
app.get('/api/viaggiatreno/autocomplete', async (req, res) => {
  const query = (req.query.query || '').trim();
  if (query.length < 2) {
    return res.json({ ok: true, data: [] });
  }

  try {
    const url = `${BASE_URL}/autocompletaStazione/${encodeURIComponent(query)}`;
    const text = await fetchText(url);

    const lines = text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    const data = lines.map((line) => {
      const [name, code] = line.split('|');
      return { name: name || '', code: code || '' };
    });

    res.json({ ok: true, data });
  } catch (err) {
    console.error('Errore autocomplete ViaggiaTreno:', err);
    res.status(500).json({
      ok: false,
      error: 'Errore nel recupero autocomplete ViaggiaTreno',
      details: err.message,
    });
  }
});

// ----------------------------------------------------------------------------
// Autocomplete stazioni (LeFrecce)
// GET /api/lefrecce/autocomplete?query=FIREN
// ----------------------------------------------------------------------------
app.get('/api/lefrecce/autocomplete', async (req, res) => {
  const query = (req.query.query || '').trim();
  if (query.length < 2) {
    return res.json({ ok: true, data: [] });
  }

  try {
    const params = new URLSearchParams({
      name: query,
      limit: '10',
    });
    const url = `${LEFRECCE_BASE}/website/locations/search?${params.toString()}`;

    const resp = await fetchWithTimeout(url);
    if (!resp.ok) {
      throw new Error(`LeFrecce error ${resp.status}`);
    }
    const list = await resp.json();

    // Mappiamo i risultati per il frontend
    // Restituiamo { name: "Nome Stazione", id: 12345 }
    const data = list.map((s) => ({
      name: s.displayName || s.name,
      id: s.id,
    }));

    res.json({ ok: true, data });
  } catch (err) {
    console.error('Errore autocomplete LeFrecce:', err);
    res.status(500).json({
      ok: false,
      error: 'Errore nel recupero autocomplete LeFrecce',
      details: err.message,
    });
  }
});

// ----------------------------------------------------------------------------
// Autocomplete stazioni (Route di compatibilità)
// GET /api/stations/autocomplete?query=FIREN
// Reindirizza a /api/viaggiatreno/autocomplete per retrocompatibilità
// ----------------------------------------------------------------------------
app.get('/api/stations/autocomplete', async (req, res) => {
  res.redirect(307, `/api/viaggiatreno/autocomplete?query=${encodeURIComponent(req.query.query || '')}`);
});

// ----------------------------------------------------------------------------
// Helper: Resolve Location ID per LeFrecce
// ----------------------------------------------------------------------------

// Override per stazioni con regione non standard
const STATION_REGION_OVERRIDES = {
  S06957: 'TOSCANA', // Firenze Le Cure (linea Faentina)
  S06950: 'TOSCANA', // Firenze San Marco Vecchio
};

/**
 * Risolve il locationId di LeFrecce partendo da un nome stazione.
 * Usa l'endpoint: GET /website/locations/search?name=[NAME]&limit=[LIMIT]
 * @param {string} stationName - Nome della stazione
 * @returns {number|null} Location ID o null se non trovato
 */
async function resolveLocationIdByName(stationName) {
  const name = (stationName || '').trim();
  if (!name) return null;

  const params = new URLSearchParams({
    name,
    limit: '10',
  });

  const url = `${LEFRECCE_BASE}/website/locations/search?${params.toString()}`;

  const resp = await fetchWithTimeout(url, {
    method: 'GET',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    },
  });

  if (!resp.ok) {
    console.error(
      'Errore LeFrecce locations/search:',
      resp.status,
      await resp.text().catch(() => '')
    );
    return null;
  }

  const list = await resp.json();

  if (!Array.isArray(list) || list.length === 0) {
    console.warn('Nessuna stazione trovata per', name);
    return null;
  }

  const lower = name.toLowerCase();

  // prova match "quasi esatto" su name/displayName
  const exact =
    list.find(
      (s) =>
        (s.name && s.name.toLowerCase() === lower) ||
        (s.displayName && s.displayName.toLowerCase() === lower)
    ) || null;

  const chosen = exact || list[0];
  console.log(
    'resolveLocationIdByName:',
    name,
    '→ scelgo',
    chosen.name,
    '(id:',
    chosen.id,
    ')'
  );

  const id = chosen.id;
  if (typeof id === 'number') return id;
  const parsed = Number(id);
  return Number.isNaN(parsed) ? null : parsed;
}


// ----------------------------------------------------------------------------
// Ricerca soluzioni di viaggio Trenitalia (LeFrecce)
// GET /api/solutions?from=...&to=...&date=...&time=...
// ----------------------------------------------------------------------------
app.get('/api/solutions', async (req, res) => {
  console.log('GET /api/solutions called with query:', req.query);
  try {
    let {
      fromId,
      toId,
      fromName,
      toName,
      date,       // "YYYY-MM-DD"
      time,       // "HH:mm" (opzionale)
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

    // Validazione base sulla data
    if (!date) {
      return res.status(400).json({
        ok: false,
        error: 'Parametro obbligatorio: date (YYYY-MM-DD)',
      });
    }

    // Se mancano gli ID LeFrecce, proviamo a ricavarli dai nomi
    // (che tu avrai ottenuto da ViaggiaTreno lato frontend)
    let depId = fromId ? Number(fromId) : null;
    let arrId = toId ? Number(toId) : null;

    if (!depId && fromName) {
      depId = await resolveLocationIdByName(fromName);
    }
    if (!arrId && toName) {
      arrId = await resolveLocationIdByName(toName);
    }

    // Se ancora non ho gli ID, non posso chiamare LeFrecce
    if (!depId || !arrId) {
      return res.status(400).json({
        ok: false,
        error:
          'Serve almeno fromId/toId oppure fromName/toName risolvibili in locationId',
        debug: {
          fromId,
          toId,
          fromName,
          toName,
        },
      });
    }

    // Costruzione departureTime "YYYY-MM-DDTHH:mm:00.000"
    const [hh = '00', mm = '00'] = (time || '00:00').split(':');
    const departureTime = `${date}T${hh.padStart(2, '0')}:${mm.padStart(
      2,
      '0'
    )}:00.000`;

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

    const vtResp = await fetchWithTimeout(`${LEFRECCE_BASE}/website/ticket/solutions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/plain, */*',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
      },
      body: JSON.stringify(body),
    });

    const text = await vtResp.text();
    console.log('LeFrecce /solutions status:', vtResp.status);

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

    return res.status(vtResp.status).json({
      ok: vtResp.ok,
      searchId: data.searchId,
      cartId: data.cartId,
      solutions: data.solutions || [],
      minimumPrices: data.minimumPrices || null,
      // raw: data, // se vuoi fare debug, puoi scommentare
    });
  } catch (err) {
    console.error('Errore /api/solutions:', err);
    return res.status(500).json({
      ok: false,
      error: 'Errore interno /api/solutions',
      details: err.message,
    });
  }
});

// POST endpoint per /api/lefrecce/solutions (usato dal frontend)
app.post('/api/lefrecce/solutions', async (req, res) => {
  try {
    const { origin, destination, departureDate, departureTime } = req.body;

    if (!origin || !destination) {
      return res.status(400).json({
        ok: false,
        error: 'Parametri obbligatori: origin, destination',
      });
    }

    // Usa departureDate o data corrente
    const date = departureDate || new Date().toISOString().split('T')[0];
    const time = departureTime || '00:00';

    // Risolvi gli ID delle stazioni
    let depId = isNaN(origin) ? await resolveLocationIdByName(origin) : Number(origin);
    let arrId = isNaN(destination) ? await resolveLocationIdByName(destination) : Number(destination);

    if (!depId || !arrId) {
      return res.status(400).json({
        ok: false,
        error: 'Impossibile risolvere origin/destination in locationId validi',
      });
    }

    const [hh = '00', mm = '00'] = time.split(':');
    const departureTimeFormatted = `${date}T${hh.padStart(2, '0')}:${mm.padStart(2, '0')}:00.000`;

    const body = {
      cartId: null,
      departureLocationId: depId,
      arrivalLocationId: arrId,
      departureTime: departureTimeFormatted,
      adults: 1,
      children: 0,
      criteria: {
        frecceOnly: false,
        regionalOnly: false,
        intercityOnly: false,
        tourismOnly: false,
        noChanges: false,
        order: 'DEPARTURE_DATE',
        offset: 0,
        limit: 10,
      },
      advancedSearchRequest: {
        bestFare: false,
        bikeFilter: false,
        forwardDiscountCodes: [],
      },
    };

    const vtResp = await fetchWithTimeout(`${LEFRECCE_BASE}/website/ticket/solutions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': 'Mozilla/5.0',
      },
      body: JSON.stringify(body),
    });

    if (!vtResp.ok) {
      return res.status(vtResp.status).json({
        ok: false,
        error: `LeFrecce API error: ${vtResp.status}`,
      });
    }

    const data = await vtResp.json();

    return res.json({
      ok: true,
      data: {
        searchId: data.searchId,
        cartId: data.cartId,
        solutions: data.solutions || [],
        minimumPrices: data.minimumPrices || null,
      },
    });
  } catch (err) {
    console.error('Errore /api/lefrecce/solutions:', err);
    return res.status(500).json({
      ok: false,
      error: 'Errore interno',
      details: err.message,
    });
  }
});


// ----------------------------------------------------------------------------
// Info stazione (dettagli + meteo regione)
// GET /api/stations/info?stationCode=S06904
// ----------------------------------------------------------------------------
app.get('/api/stations/info', async (req, res) => {
  const stationCode = (req.query.stationCode || '').trim();

  if (!stationCode) {
    return res
      .status(400)
      .json({ ok: false, error: 'Parametro "stationCode" obbligatorio' });
  }

  try {
    // 1) Regione della stazione (con fallback manuale per stazioni "difficili")
    const urlRegion = `${BASE_URL}/regione/${encodeURIComponent(stationCode)}`;
    let regionId = '';
    try {
      const regionResp = await fetchWithTimeout(urlRegion);
      if (regionResp.ok) {
        regionId = (await regionResp.text()).trim();
      } else {
        console.warn('Errore regione ViaggiaTreno:', regionResp.status, stationCode);
      }
    } catch (regionErr) {
      console.warn('Eccezione fetch regione:', stationCode, regionErr);
    }

    if (!regionId && STATION_REGION_OVERRIDES[stationCode]) {
      regionId = STATION_REGION_OVERRIDES[stationCode];
    }

    if (!regionId) {
      return res.json({
        ok: false,
        error: 'Impossibile ricavare idRegione per la stazione',
        raw: null,
      });
    }

    // 2) Dettaglio stazione (nome lungo, coord, ecc.)
    const urlDetails = `${BASE_URL}/dettaglioStazione/${encodeURIComponent(
      stationCode
    )}/${encodeURIComponent(regionId)}`;
    const detailsResp = await fetchWithTimeout(urlDetails);
    if (!detailsResp.ok) {
      return res.status(detailsResp.status).json({
        ok: false,
        error: `Errore ViaggiaTreno dettaglioStazione (${detailsResp.status})`,
      });
    }
    const station = await detailsResp.json();

    // 3) Meteo regione (se fallisce, non buttiamo giù tutto)
    let meteo = null;
    try {
      const urlMeteo = `${BASE_URL}/datimeteo/${encodeURIComponent(regionId)}`;
      const meteoResp = await fetchWithTimeout(urlMeteo);
      if (meteoResp.ok) {
        meteo = await meteoResp.json();
      }
    } catch (errMeteo) {
      console.warn('Errore meteo ViaggiaTreno:', errMeteo);
    }

    return res.json({
      ok: true,
      stationCode,
      regionId,
      station,
      meteo,
    });
  } catch (err) {
    console.error('Errore /api/stations/info:', err);
    return res.status(500).json({
      ok: false,
      error: 'Errore interno station info',
      details: err.message,
    });
  }
});


// ----------------------------------------------------------------------------
// Partenze da stazione
// GET /api/stations/departures?stationCode=S06904&when=now
// Parametri opzionali: &when=2025-11-28T10:30:00
// ----------------------------------------------------------------------------
app.get('/api/stations/departures', async (req, res) => {
  const stationCode = (req.query.stationCode || '').trim();
  const when = (req.query.when || 'now').trim();

  if (!stationCode) {
    return res
      .status(400)
      .json({ ok: false, error: 'Parametro "stationCode" obbligatorio' });
  }

  // se when != "now" provo a fare new Date(when), altrimenti new Date()
  const baseDate = when === 'now' ? new Date() : new Date(when);
  const dateStr = baseDate.toString(); // stringa in stile "Fri Nov 28 2025 ..."

  try {
    const url = `${BASE_URL}/partenze/${encodeURIComponent(
      stationCode
    )}/${encodeURIComponent(dateStr)}`;

    const vtResp = await fetchWithTimeout(url);
    if (!vtResp.ok) {
      return res.status(vtResp.status).json({
        ok: false,
        error: `Errore ViaggiaTreno partenze (${vtResp.status})`,
      });
    }

    const data = await vtResp.json();

    // Arricchisci ogni elemento con dati computati
    const enrichedData = Array.isArray(data)
      ? data.map((entry) => {
          const trainKind = resolveTrainKind(
            entry.categoriaDescrizione,
            entry.categoria,
            entry.tipoTreno,
            entry.compNumeroTreno
          );
          const delay = entry.ritardo != null && !Number.isNaN(Number(entry.ritardo)) ? Number(entry.ritardo) : null;
          return {
            ...entry,
            _computed: {
              trainKind,
              delay,
            },
          };
        })
      : data;

    return res.json({
      ok: true,
      stationCode,
      date: dateStr,
      data: enrichedData,
    });
  } catch (err) {
    console.error('Errore /api/stations/departures:', err);
    return res.status(500).json({
      ok: false,
      error: 'Errore interno partenze',
      details: err.message,
    });
  }
});


// ----------------------------------------------------------------------------
// Arrivi in stazione
// GET /api/stations/arrivals?stationCode=S06904&when=now
// Parametri opzionali: &when=2025-11-28T10:30:00
// ----------------------------------------------------------------------------
app.get('/api/stations/arrivals', async (req, res) => {
  const stationCode = (req.query.stationCode || '').trim();
  const when = (req.query.when || 'now').trim();

  if (!stationCode) {
    return res
      .status(400)
      .json({ ok: false, error: 'Parametro "stationCode" obbligatorio' });
  }

  const baseDate = when === 'now' ? new Date() : new Date(when);
  const dateStr = baseDate.toString();

  try {
    const url = `${BASE_URL}/arrivi/${encodeURIComponent(
      stationCode
    )}/${encodeURIComponent(dateStr)}`;

    const vtResp = await fetchWithTimeout(url);
    if (!vtResp.ok) {
      return res.status(vtResp.status).json({
        ok: false,
        error: `Errore ViaggiaTreno arrivi (${vtResp.status})`,
      });
    }

    const data = await vtResp.json();

    // Arricchisci ogni elemento con dati computati e formattati
    const enrichedData = Array.isArray(data)
      ? data.map((entry) => {
          const enriched = enrichTrainData(entry);
          return {
            ...entry,
            _computed: enriched,
          };
        })
      : data;

    return res.json({
      ok: true,
      stationCode,
      date: dateStr,
      data: enrichedData,
    });
  } catch (err) {
    console.error('Errore /api/stations/arrivals:', err);
    return res.status(500).json({
      ok: false,
      error: 'Errore interno arrivi',
      details: err.message,
    });
  }
});


// ----------------------------------------------------------------------------
// Stato treno per numero
// GET /api/trains/status?trainNumber=666&originCode=S06904&technical=...&epochMs=...
// ----------------------------------------------------------------------------
app.get('/api/trains/status', async (req, res) => {
  const trainNumber = (req.query.numeroTreno || req.query.trainNumber || '').trim();
  const originCodeHint = (req.query.codiceOrigine || req.query.originCode || '').trim();
  const technicalHint = (req.query.tecnico || req.query.technical || '').trim();
  const epochMsHint = parseToMillis(req.query.epochMs || req.query.timestampRiferimento);
  const debug = parseBool(req.query.debug, false);

  if (!trainNumber) {
    return res
      .status(400)
      .json({ ok: false, errore: 'Parametro "numeroTreno" obbligatorio' });
  }

  try {
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

    const urlSearch = `${BASE_URL}/cercaNumeroTrenoTrenoAutocomplete/${encodeURIComponent(
      trainNumber
    )}`;
    const textSearch = await fetchText(urlSearch);
    const lines = textSearch
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    if (!lines.length) {
      return res.json({
        ok: true,
        data: null,
        message: 'Nessun treno trovato per questo numero',
      });
    }

    const candidates = lines
      .map((rawLine) => {
        const parts = String(rawLine).split('|');
        const display = (parts[0] || '').trim();
        const technical = (parts[1] || '').trim(); // es. "666-S06000"
        const [numFromTechnical, originCode] = technical.split('-');
        const epochMs = parseEpochFromDisplay(display);
        return {
          rawLine,
          display,
          technical,
          trainNumber: (numFromTechnical || trainNumber).trim(),
          originCode: (originCode || '').trim(),
          epochMs,
        };
      })
      .filter((c) => c.originCode);

    if (!candidates.length) {
      return res.json({
        ok: false,
        error:
          'Impossibile ricavare il codice stazione origine dai risultati ViaggiaTreno',
        raw: lines[0],
      });
    }

    let selected = null;
    if (technicalHint) {
      selected = candidates.find((c) => c.technical === technicalHint) || null;
    }
    if (!selected && originCodeHint) {
      selected = candidates.find((c) => c.originCode === originCodeHint) || null;
    }

    // Se ci arriva un epoch (es. da tabellone o scelta esplicita), prova a selezionare
    // la corsa più vicina temporalmente (utile quando lo stesso numero esiste su giorni diversi).
    if (!selected && epochMsHint != null) {
      const withEpoch = candidates.filter((c) => c.epochMs != null);
      if (withEpoch.length) {
        withEpoch.sort((a, b) => Math.abs(a.epochMs - epochMsHint) - Math.abs(b.epochMs - epochMsHint));
        // accetta match “ragionevoli” entro 36h
        if (Math.abs(withEpoch[0].epochMs - epochMsHint) <= 36 * 60 * 60 * 1000) {
          selected = withEpoch[0];
        }
      }
    }

    if (!selected) {
      if (candidates.length === 1) {
        selected = candidates[0];
      } else {
        return res.json({
          ok: true,
          data: null,
          needsSelection: true,
          message: 'Più treni trovati con questo numero: seleziona quello giusto.',
          choices: candidates.map((c) => ({
            display: c.display,
            technical: c.technical,
            originCode: c.originCode,
            epochMs: c.epochMs,
          })),
        });
      }
    }

    const originCode = selected.originCode;

    const nowMs = Date.now();
    let finalSnapshot = null;

    if (epochMsHint != null) {
      // Quando ci chiedono esplicitamente una data/ora, non facciamo euristiche su "now".
      // Proviamo prima l'epoch richiesto, poi piccoli offset per robustezza.
      const offsetsHours = [0, -6, 6, -12, 12, -24, 24];
      for (const h of offsetsHours) {
        const ts = epochMsHint + h * 60 * 60 * 1000;
        if (ts <= 0) continue;
        const snapshot = await fetchTrainStatusSnapshot(originCode, trainNumber, ts);
        if (!snapshot) continue;
        finalSnapshot = { data: snapshot, referenceTimestamp: ts, offset: h };
        break;
      }
    }

    if (!finalSnapshot) {
      // Fallback: comportamento precedente (scegli la corsa “più sensata” rispetto a now).
      const hourOffsets = [0, -6, -12, -18, -24];
      let primarySnapshot = null;
      let selectedSnapshot = null;
      let backupSnapshot = null;

      for (const offset of hourOffsets) {
        const ts = nowMs + offset * 60 * 60 * 1000;
        if (ts <= 0) continue;
        const snapshot = await fetchTrainStatusSnapshot(originCode, trainNumber, ts);
        if (!snapshot) continue;

        const descriptor = { data: snapshot, referenceTimestamp: ts, offset };

        if (offset === 0) {
          primarySnapshot = descriptor;
          backupSnapshot = backupSnapshot || descriptor;
          if (!runLooksFuture(snapshot, nowMs)) {
            selectedSnapshot = descriptor;
            break;
          }
          continue;
        }

        backupSnapshot = backupSnapshot || descriptor;

        if (trainStillRunning(snapshot, nowMs)) {
          selectedSnapshot = descriptor;
          break;
        }
      }

      finalSnapshot = selectedSnapshot || primarySnapshot || backupSnapshot;
    }

    if (!finalSnapshot) {
      return res.json({
        ok: true,
        data: null,
        message: 'Nessuna informazione di andamento disponibile per il numero fornito.',
      });
    }

    // Arricchisci la risposta con dati computati e formattati
    const enriched = enrichTrainData(finalSnapshot.data);

    function buildPrincipali(snapshot, computed) {
      const raw = snapshot && typeof snapshot === 'object' ? snapshot : {};
      const c = computed && typeof computed === 'object' ? computed : {};
      const rawStops = Array.isArray(raw.fermate) ? raw.fermate : [];

      const firstStop = rawStops.length ? rawStops[0] : null;
      const lastStop = rawStops.length ? rawStops[rawStops.length - 1] : null;

      const partenzaProgInizialeMs =
        pickFirstTimeMs(firstStop, [
          'partenzaTeoricaZero',
          'partenza_teoricaZero',
          'partenza_teorica_zero',
          'partenza_teorica',
          'partenzaTeorica',
          'programmataZero',
        ]) || pickFirstTimeMs(raw, ['orarioPartenzaZero', 'orarioPartenza']);

      const arrivoProgInizialeMs =
        pickFirstTimeMs(lastStop, [
          'arrivoTeoricaZero',
          'arrivo_teoricaZero',
          'arrivo_teorica_zero',
          'arrivo_teorico',
          'arrivo_teorica',
          'arrivoTeorica',
          'programmataZero',
        ]) || pickFirstTimeMs(raw, ['orarioArrivoZero', 'orarioArrivo']);

      const fermatePrincipali = Array.isArray(c.fermate)
        ? c.fermate.map((stop, idx) => {
            const r = rawStops[idx] || {};
            const arrivoProgZero =
              pickFirstTimeMs(r, ['arrivoTeoricaZero', 'arrivo_teoricaZero', 'arrivo_teorica_zero']) || null;
            const partenzaProgZero =
              pickFirstTimeMs(r, ['partenzaTeoricaZero', 'partenza_teoricaZero', 'partenza_teorica_zero']) || null;

            // Calcolo deltaArrivo e deltaPartenza per la fermata
            let deltaArrivo = null;
            let deltaPartenza = null;
            if (stop?.orarioArrivoProgrammato && stop?.orarioArrivoReale) {
              const progA = parseToMillis(stop.orarioArrivoProgrammato);
              const realeA = parseToMillis(stop.orarioArrivoReale);
              if (progA && realeA) deltaArrivo = Math.round((progA - realeA) / 60000) * -1;
            }
            if (stop?.orarioPartenzaProgrammato && stop?.orarioPartenzaReale) {
              const progP = parseToMillis(stop.orarioPartenzaProgrammato);
              const realeP = parseToMillis(stop.orarioPartenzaReale);
              if (progP && realeP) deltaPartenza = Math.round((progP - realeP) / 60000) * -1;
            }

            return {
              stazione: stop?.stazione ?? null,
              id: stop?.id ?? null,
              progressivo: stop?.progressivo ?? null,
              orari: {
                arrivo: {
                  programmato: stop?.orarioArrivoProgrammato ?? null,
                  programmatoIniziale: arrivoProgZero != null ? formatTime(arrivoProgZero) : null,
                  probabile: stop?.orarioArrivoProbabile ?? null,
                  reale: stop?.orarioArrivoReale ?? null,
                  deltaArrivo,
                },
                partenza: {
                  programmato: stop?.orarioPartenzaProgrammato ?? null,
                  programmatoIniziale: partenzaProgZero != null ? formatTime(partenzaProgZero) : null,
                  probabile: stop?.orarioPartenzaProbabile ?? null,
                  reale: stop?.orarioPartenzaReale ?? null,
                  deltaPartenza,
                },
              },
              binari: {
                programmato: stop?.binarioProgrammato ?? null,
                reale: stop?.binarioReale ?? null,
                variato: !!stop?.binarioVariato,
              },
              soppressa: !!stop?.soppressa,
              tipoFermata: stop?.tipoFermata ?? null,
            };
          })
        : [];

      const posizione = c.currentStop
        ? {
            stazione: c.currentStop.stationName ?? null,
            idStazione: c.currentStop.stationCode ?? null,
            indice: c.currentStop.index ?? null,
            timestamp: c.currentStop.timestamp ?? null,
          }
        : null;

      const statoViaggio = c.journeyState
        ? {
            stato: c.journeyState.state ?? null,
            etichetta: c.journeyState.label ?? null,
          }
        : null;

      const codiceCompleto = (() => {
        const rawCode = raw.compNumeroTreno != null ? String(raw.compNumeroTreno).trim() : '';
        if (rawCode) return rawCode.replace(/\s+/g, ' ').trim();
        const fallback = [c.tipologiaTreno, c.numeroTreno].filter(Boolean).join(' ').trim();
        return fallback || null;
      })();

      return {
        numeroTreno: c.numeroTreno ?? (raw.numeroTreno != null ? String(raw.numeroTreno) : null),
        codiceTreno: c.tipologiaTreno ?? c.trainKind?.code ?? null,
        codiceCompleto,
        tipoTreno: c.trainKind
          ? {
              codice: c.trainKind.code ?? null,
              etichetta: c.trainKind.label ?? null,
              categoria: c.trainKind.category ?? null,
            }
          : null,
        tratta: {
          origine: c.origine ?? raw.origine ?? null,
          destinazione: c.destinazione ?? raw.destinazione ?? null,
        },
        orari: {
          partenza: {
            programmatoIniziale: partenzaProgInizialeMs != null ? formatTime(partenzaProgInizialeMs) : null,
            programmato: c.orarioPartenzaProg ?? null,
            reale: c.orarioPartenzaReale ?? null,
          },
          arrivo: {
            programmatoIniziale: arrivoProgInizialeMs != null ? formatTime(arrivoProgInizialeMs) : null,
            programmato: c.orarioArrivoProg ?? null,
            reale: c.orarioArrivoReale ?? null,
          },
        },
          // Nuovo campo: ritardoArrivoInStazione (prossima fermata o ultima)
          ritardoArrivoInStazione: (() => {
            // Cerca la prossima fermata con arrivo programmato e reale
            const stops = Array.isArray(c.fermate) ? c.fermate : [];
            for (const stop of stops) {
              if (stop.orari && stop.orari.arrivo && stop.orari.arrivo.programmato && stop.orari.arrivo.reale) {
                const prog = parseToMillis(stop.orari.arrivo.programmato);
                const reale = parseToMillis(stop.orari.arrivo.reale);
                if (prog && reale) return Math.round((reale - prog) / 60000); // minuti
              }
            }
            return null;
          })(),
          // Campo partenza (già presente in orari, ma qui come shortcut)
          partenza: {
            programmato: c.orarioPartenzaProg ?? null,
            reale: c.orarioPartenzaReale ?? null,
          },
        deltaTime: typeof c.globalDelay === 'number' ? c.globalDelay : null,
        stato: c.statoTreno ?? null,
        statoViaggio,
        posizione,
        prossimaFermata: c.prossimaFermata ?? null,
        rilevamento: {
          testo: c.oraLuogoRilevamento ?? null,
          timestamp: raw.oraUltimoRilevamento ?? null,
          stazione: raw.stazioneUltimoRilevamento ?? null,
        },
        aggiornamentoRfi: raw.subTitle ? String(raw.subTitle).trim() : null,
        // messaggioRfi rimosso
        fermate: fermatePrincipali,
      };
    }

    const principali = buildPrincipali(finalSnapshot.data, enriched);

    // Miglior formattazione e ordine della risposta
    const response = {
      ok: true,
      treno: {
        infoIniziali: {
          numeroTreno: principali.numeroTreno,
          codiceTreno: principali.codiceTreno,
          codiceCompleto: principali.codiceCompleto,
          tipoTreno: principali.tipoTreno,
          tratta: principali.tratta,
          orari: principali.orari,
        },
        infoTempoReale: {
          stato: principali.stato,
          statoViaggio: principali.statoViaggio,
          posizione: principali.posizione,
          prossimaFermata: principali.prossimaFermata,
          rilevamento: principali.rilevamento,
          aggiornamentoRfi: principali.aggiornamentoRfi,
          deltaTime: typeof principali.deltaTime === 'number' ? principali.deltaTime : null,
        },
        fermate: Array.isArray(principali.fermate) ? principali.fermate : [],
      },
    };

    if (debug) {
      response.debug = {
        originCode,
        tecnico: selected.technical,
        timestampRiferimento: finalSnapshot.referenceTimestamp,
        datiRfiCompleti: finalSnapshot.data,
        computed: enriched,
      };
    }

    res.json(response);
  } catch (err) {
    console.error('Errore trains/status backend:', err);
    res
      .status(err.status || 500)
      .json({
        ok: false,
        errore: 'Errore interno train status',
        dettagli: err.message,
      });
  }
});

// ----------------------------------------------------------------------------
// Tabellone stazione (partenze + arrivi in JSON)
// GET /api/viaggiatreno/station-board?stationCode=S06904
// ----------------------------------------------------------------------------
app.get('/api/viaggiatreno/station-board', async (req, res) => {
  const stationCode = (req.query.stationCode || '').trim();

  if (!stationCode) {
    return res.status(400).json({ 
      ok: false, 
      error: 'Parametro "stationCode" obbligatorio' 
    });
  }

  try {
    const now = new Date();
    const dateStr = now.toString();

    // Chiamate parallele per partenze e arrivi
    const [departuresResp, arrivalsResp] = await Promise.all([
      fetchWithTimeout(`${BASE_URL}/partenze/${encodeURIComponent(stationCode)}/${encodeURIComponent(dateStr)}`).catch(() => null),
      fetchWithTimeout(`${BASE_URL}/arrivi/${encodeURIComponent(stationCode)}/${encodeURIComponent(dateStr)}`).catch(() => null)
    ]);

    let departures = [];
    let arrivals = [];

    if (departuresResp && departuresResp.ok) {
      try {
        departures = await departuresResp.json();
      } catch (e) {
        console.warn('Errore parsing partenze:', e);
      }
    }

    if (arrivalsResp && arrivalsResp.ok) {
      try {
        arrivals = await arrivalsResp.json();
      } catch (e) {
        console.warn('Errore parsing arrivi:', e);
      }
    }

    return res.json({
      ok: true,
      stationCode,
      data: {
        departures: Array.isArray(departures) ? departures : [],
        arrivals: Array.isArray(arrivals) ? arrivals : []
      }
    });
  } catch (err) {
    console.error('Errore /api/viaggiatreno/station-board:', err);
    return res.status(500).json({
      ok: false,
      error: 'Errore interno',
      details: err.message,
    });
  }
});

// ----------------------------------------------------------------------------
// Tabellone HTML grezzo (per debug)
// GET /api/stations/board?stationCode=S06000
// TODO: Endpoint legacy, ritorna HTML grezzo dalla versione "new" di ViaggiaTreno
// ----------------------------------------------------------------------------
app.get('/api/stations/board', async (req, res) => {
  const stationCode = (req.query.stationCode || '').trim();

  if (!stationCode) {
    return res
      .status(400)
      .json({ ok: false, error: 'Parametro "stationCode" obbligatorio' });
  }

  try {
    const now = new Date();
    const url = `${BASE_URL_BOARD}/partenze/${encodeURIComponent(
      stationCode
    )}/${encodeURIComponent(now.toString())}`;

    const html = await fetchText(url);
    res.type('text/html').send(html);
  } catch (err) {
    console.error('Errore board backend:', err);
    res
      .status(err.status || 500)
      .json({
        ok: false,
        error: 'Errore interno tabellone',
        details: err.message,
      });
  }
});

// ----------------------------------------------------------------------------
// News ViaggiaTreno
// GET /api/news
// Endpoint legacy, può risultare datato
// ----------------------------------------------------------------------------
app.get('/api/news', async (_req, res) => {
  try {
    const url = `${BASE_URL}/news/0/it`;
    const data = await fetchJson(url);
    res.json({ ok: true, data });
  } catch (err) {
    console.error('Errore news backend:', err);
    res
      .status(err.status || 500)
      .json({
        ok: false,
        error: 'Errore interno news',
        details: err.message,
      });
  }
});






// ============================================================================
// 404 Handler & Module Export
// ============================================================================

// Gestione route non trovate
app.use((req, res) => {
  console.warn('404 Express su path:', req.path);
  res.status(404).json({ ok: false, error: 'Route non trovata', path: req.path });
});

module.exports = app;

// ============================================================================
// Server Standalone (opzionale, per test locali)
// ============================================================================
if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`✅ Backend Treninfo attivo su http://localhost:${PORT}`);
  });
}