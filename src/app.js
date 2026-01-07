//Developed by Cristian Ceni 2025 dhn

// src/app.js - Backend ViaggiaTreno per Netlify Functions

const express = require('express');
const cors = require('cors');

const app = express();

// CORS
// Se vuoi restringere le origini (utile quando consumerai queste API da React), imposta:
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

// Per leggere JSON nel body delle POST (es. /api/solutions in POST)
app.use(express.json());

// ---------------- API ------------------

// Base per le API ViaggiaTreno "classiche"
const BASE_URL =
  'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';

// Base "new" per tabellone HTML - anche se forse non l'uso perché non so in do metterlo
const BASE_URL_BOARD =
  'http://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno';

// Base LeFrecce per ricerca viaggio
const LEFRECCE_BASE = 'https://www.lefrecce.it/Channels.Website.BFF.WEB';


// ---------------- Helper fetch con timeout -----------------

// Timeout fetch in ms (default 12 secondi)

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

// Parser boolean da query/body
function parseBool(val, defaultVal = false) {
  if (val === undefined || val === null) return defaultVal;
  if (typeof val === 'boolean') return val;
  const s = String(val).toLowerCase().trim();
  if (['true', '1', 'yes', 'y', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'n', 'off'].includes(s)) return false;
  return defaultVal;
}


// Utility comuni per gestire i timestamp ViaggiaTreno ----------------

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

// ----------------- HELPER FUNZIONI COMPUTATE -----------------

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
      return {
        stationName: fermate[idx].stazione,
        stationCode: fermate[idx].id,
        index: idx,
        timestamp: data.oraUltimoRilevamento || null,
      };
    }
  }

  // Fallback: ultima fermata con orario reale
  for (let i = fermate.length - 1; i >= 0; i--) {
    if (fermate[i].partenzaReale != null || fermate[i].arrivoReale != null) {
      return {
        stationName: fermate[i].stazione,
        stationCode: fermate[i].id,
        index: i,
        timestamp: fermate[i].partenzaReale || fermate[i].arrivoReale,
      };
    }
  }

  return null;
}

/**
 * Arricchisce i dati RFI con campi computati.
 * Restituisce un oggetto con:
 * - trainKind: tipo treno { code, label, category }
 * - globalDelay: ritardo globale in minuti (number o null)
 * - journeyState: stato corsa { state, label }
 * - currentStop: fermata attuale { stationName, stationCode, index, timestamp } o null
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

  return {
    trainKind,
    globalDelay,
    journeyState,
    currentStop,
  };
}

// ----------------- ROUTE API -----------------

// Autocomplete stazioni (ViaggiaTreno) - Per "Cerca Stazione"
// GET /api/viaggiatreno/autocomplete?query=FIREN
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

// Autocomplete stazioni (LeFrecce) - Per "Cerca Viaggio"
// GET /api/lefrecce/autocomplete?query=FIREN
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

// Manteniamo la vecchia route per compatibilità (o la redirezioniamo)
// In questo caso la facciamo puntare a ViaggiaTreno per default, o la rimuoviamo se aggiorniamo il frontend
app.get('/api/stations/autocomplete', async (req, res) => {
   // Fallback a ViaggiaTreno per default se non specificato
   res.redirect(307, `/api/viaggiatreno/autocomplete?query=${encodeURIComponent(req.query.query || '')}`);
});

const STATION_REGION_OVERRIDES = {
  S06957: 'TOSCANA', // Firenze Le Cure (linea Faentina)
  S06950: 'TOSCANA', // Firenze San Marco Vecchio
};

// Risolve il locationId di LeFrecce partendo da un nome stazione (es. "Pontassieve")
// usando l'endpoint ufficiale di ricerca stazioni:
// GET https://www.lefrecce.it/Channels.Website.BFF.WEB/website/locations/search?name=[NAME]&limit=[LIMIT]
// Ritorna un intero (id) oppure null se non trova niente.
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


// Ricerca soluzioni di viaggio Trenitalia (LeFrecce)
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


// Info stazione (dettagli + meteo regione)
// GET /api/stations/info?stationCode=S06904
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


// Partenze da stazione
// GET /api/stations/departures?stationCode=S06904&when=now
// opzionale: &when=2025-11-28T10:30:00
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


// Arrivi in stazione
// GET /api/stations/arrivals?stationCode=S06904&when=now
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
    console.error('Errore /api/stations/arrivals:', err);
    return res.status(500).json({
      ok: false,
      error: 'Errore interno arrivi',
      details: err.message,
    });
  }
});


// Stato treno per numero
// GET /api/trains/status?trainNumber=666
app.get('/api/trains/status', async (req, res) => {
  const trainNumber = (req.query.trainNumber || '').trim();
  const originCodeHint = (req.query.originCode || '').trim();
  const technicalHint = (req.query.technical || '').trim();
  const epochMsHint = parseToMillis(req.query.epochMs);

  if (!trainNumber) {
    return res
      .status(400)
      .json({ ok: false, error: 'Parametro "trainNumber" obbligatorio' });
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
            rawLine: c.rawLine,
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

    // Arricchisci la risposta con dati computati
    const enriched = enrichTrainData(finalSnapshot.data);

    res.json({
      ok: true,
      originCode,
      rawSearchLine: selected.rawLine,
      technical: selected.technical,
      referenceTimestamp: finalSnapshot.referenceTimestamp,
      data: finalSnapshot.data,
      // Dati arricchiti/computati dal backend
      computed: {
        trainKind: enriched.trainKind,
        globalDelay: enriched.globalDelay,
        journeyState: enriched.journeyState,
        currentStop: enriched.currentStop,
      },
    });
  } catch (err) {
    console.error('Errore trains/status backend:', err);
    res
      .status(err.status || 500)
      .json({
        ok: false,
        error: 'Errore interno train status',
        details: err.message,
      });
  }
});

// TODO: endpoint tabellone HTML (attualmente ritorna HTML grezzo; tenuto per debug)
// GET /api/stations/board?stationCode=S06000
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

// News ViaggiaTreno (endpoint legacy, può risultare datato)
// GET /api/news
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






// Fallback 404, così se sbagli path lo vedi nel log
app.use((req, res) => {
  console.warn('404 Express su path:', req.path);
  res.status(404).json({ ok: false, error: 'Route non trovata', path: req.path });
});

module.exports = app;

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Backend Treninfo attivo su http://localhost:${PORT}`);
  });
}