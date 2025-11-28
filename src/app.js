// src/app.js - Backend ViaggiaTreno per Netlify Functions

const express = require('express');
const cors = require('cors');

const app = express();

// CORS: su Netlify potresti anche non usarlo, ma non fa danni
app.use(cors());

// Base per la maggior parte delle API ViaggiaTreno "classiche"
const BASE_URL =
  'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
// Base "new" usata per alcuni endpoint HTML/tabellone
const BASE_URL_BOARD =
  'http://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno';

// Log minimale delle richieste in ingresso
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// ----------------- Helpers -----------------

async function fetchText(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status} per ${url}`);
    err.status = resp.status;
    throw err;
  }
  return resp.text();
}

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

// ----------------- ROUTE API -----------------

// 1) Autocomplete stazioni
//    GET /stations/autocomplete?query=FIRENZE
app.get('/stations/autocomplete', async (req, res) => {
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

    return res.json({ ok: true, data });
  } catch (err) {
    console.error('Errore autocomplete stazioni:', err);
    const status =
      err.status && Number.isInteger(err.status) ? err.status : 500;
    return res
      .status(status)
      .json({
        ok: false,
        error: 'Errore nel recupero autocomplete stazioni',
        details: err.message,
      });
  }
});

// 2) Stato treno per numero
//    GET /trains/status?trainNumber=666
app.get('/trains/status', async (req, res) => {
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

    if (lines.length === 0) {
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
    const urlStatus = `${BASE_URL}/andamentoTreno/${encodeURIComponent(
      originCode
    )}/${encodeURIComponent(trainNumber)}/${nowMs}`;

    let data;
    try {
      data = await fetchJson(urlStatus);
    } catch (errStatus) {
      if (errStatus.status === 204) {
        return res.json({
          ok: true,
          data: null,
          message: 'Nessuna informazione di andamento disponibile (204).',
        });
      }
      throw errStatus;
    }

    return res.json({
      ok: true,
      originCode,
      rawSearchLine: first,
      data,
    });
  } catch (err) {
    console.error('Errore trains/status backend:', err);
    const status =
      err.status && Number.isInteger(err.status) ? err.status : 500;
    return res
      .status(status)
      .json({
        ok: false,
        error: 'Errore interno train status',
        details: err.message,
      });
  }
});

// 3) Tabellone stazione (HTML grezzo)
//    GET /stations/board?stationCode=S06000
app.get('/stations/board', async (req, res) => {
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
    return res.type('text/html').send(html);
  } catch (err) {
    console.error('Errore board backend:', err);
    const status =
      err.status && Number.isInteger(err.status) ? err.status : 500;
    return res
      .status(status)
      .json({
        ok: false,
        error: 'Errore interno tabellone',
        details: err.message,
      });
  }
});

// 4) News RFI / rete
//    GET /news
app.get('/news', async (_req, res) => {
  try {
    const url = `${BASE_URL}/news/0/it`;
    const data = await fetchJson(url);
    return res.json({ ok: true, data });
  } catch (err) {
    console.error('Errore news backend:', err);
    const status =
      err.status && Number.isInteger(err.status) ? err.status : 500;
    return res
      .status(status)
      .json({
        ok: false,
        error: 'Errore interno news',
        details: err.message,
      });
  }
});

module.exports = app;
