//Developed by Cristian Ceni 2025 dhn

// src/app.js - Backend ViaggiaTreno per Netlify Functions

const express = require('express');
const cors = require('cors');

const app = express();

// CORS
app.use(cors());

// Base per le API ViaggiaTreno "classiche"
const BASE_URL =
  'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
// Base "new" per tabellone HTML
const BASE_URL_BOARD =
  'http://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno';

// Helper per fetch testo
async function fetchText(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status} per ${url}`);
    err.status = resp.status;
    throw err;
  }
  return resp.text();
}

// Helper per fetch JSON
async function fetchJson(url) {
  const resp = await fetch(url);
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

// Autocomplete stazioni
// GET /api/stations/autocomplete?query=FIREN
app.get('/api/stations/autocomplete', async (req, res) => {
  const query = (req.query.query || '').trim();
  if (query.length < 2) {
    return res.json({ ok: true, data: [] });
  }

  try {
    const url = `${BASE_URL}/autocompletaStazione/${encodeURIComponent(
      query
    )}`;
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
    console.error('Errore autocomplete stazioni:', err);
    res
      .status(err.status || 500)
      .json({
        ok: false,
        error: 'Errore nel recupero autocomplete stazioni',
        details: err.message,
      });
  }
});

//TEST
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
    // 1) Regione della stazione
    const urlRegion = `${BASE_URL}/regione/${encodeURIComponent(stationCode)}`;
    const regionResp = await fetch(urlRegion);
    if (!regionResp.ok) {
      return res.status(regionResp.status).json({
        ok: false,
        error: `Errore ViaggiaTreno regione (${regionResp.status})`,
      });
    }
    const regionText = (await regionResp.text()).trim();
    const regionId = regionText;
    if (!regionId) {
      return res.json({
        ok: false,
        error: 'Impossibile ricavare idRegione per la stazione',
        raw: regionText,
      });
    }

    // 2) Dettaglio stazione (nome lungo, coord, ecc.)
    const urlDetails = `${BASE_URL}/dettaglioStazione/${encodeURIComponent(
      stationCode
    )}/${encodeURIComponent(regionId)}`;
    const detailsResp = await fetch(urlDetails);
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
      const meteoResp = await fetch(urlMeteo);
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

    const vtResp = await fetch(url);
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

    const vtResp = await fetch(url);
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

// Questo non fa, andrebbe sistemato ma vaffanculo dhn
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

// Boh aggiornato al 2019 help
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
