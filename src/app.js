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
//
// Puoi chiamarla in due modi:
//
// 1) Con ID LeFrecce già noti:
//    GET /api/solutions?fromId=830006905&toId=830006900&date=2025-12-04&time=18:00&adults=1&children=0
//
// 2) Con solo i nomi stazione (esattamente come li mostri in UI, presi da ViaggiaTreno):
//    GET /api/solutions?fromName=Pontassieve&toName=Firenze%20S.%20M.%20Novella&date=2025-12-04&time=18:00
//
// Parametri supportati (query string):
//   fromId        → locationId LeFrecce origine (intero)    [opzionale se passi fromName]
//   toId          → locationId LeFrecce destinazione        [opzionale se passi toName]
//   fromName      → nome stazione origine (usato se manca fromId)
//   toName        → nome stazione arrivo  (usato se manca toId)
//   date          → obbligatorio, "YYYY-MM-DD"
//   time          → opzionale, "HH:mm" (default "00:00")
//   adults        → opzionale, default 1
//   children      → opzionale, default 0
//   frecceOnly    → opzionale, "true"/"false" (default false)
//   regionalOnly  → idem
//   intercityOnly → idem
//   tourismOnly   → idem
//   noChanges     → idem
//   order         → opzionale, default "DEPARTURE_DATE"
//   offset        → opzionale, default 0
//   limit         → opzionale, default 10
//   bestFare      → opzionale, default false
//   bikeFilter    → opzionale, default false
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

    return res.json({
      ok: true,
      stationCode,
      date: dateStr,
      data,
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

    return res.json({
      ok: true,
      stationCode,
      date: dateStr,
      data,
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
//FINE TEST

// Stato treno per numero
// GET /api/trains/status?trainNumber=666
app.get('/api/trains/status', async (req, res) => {
  const trainNumber = (req.query.trainNumber || '').trim();

  if (!trainNumber) {
    return res
      .status(400)
      .json({ ok: false, error: 'Parametro "trainNumber" obbligatorio' });
  }

  try {
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

    const first = lines[0];
    const parts = first.split('|');
    const technical = (parts[1] || '').trim(); // es. "666-S06000"
    const [, originCode] = technical.split('-');

    if (!originCode) {
      return res.json({
        ok: false,
        error:
          'Impossibile ricavare il codice stazione origine dal risultato ViaggiaTreno',
        raw: first,
      });
    }

    const nowMs = Date.now();
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

    const finalSnapshot = selectedSnapshot || primarySnapshot || backupSnapshot;

    if (!finalSnapshot) {
      return res.json({
        ok: true,
        data: null,
        message: 'Nessuna informazione di andamento disponibile per il numero fornito.',
      });
    }

    res.json({
      ok: true,
      originCode,
      rawSearchLine: first,
      referenceTimestamp: finalSnapshot.referenceTimestamp,
      data: finalSnapshot.data,
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