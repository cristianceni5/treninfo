#!/usr/bin/env node
// Scarica l'elenco stazioni da ViaggiaTreno e salva un JSON con id + nome (case corretto).

const fs = require('fs/promises');
const path = require('path');

const BASE_URL = 'http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno';
const OUTPUT_PATH = path.resolve(
  process.argv[2] || path.join(__dirname, '..', 'stations-viaggiatreno.json')
);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 15000);
const FETCH_CONCURRENCY = Number(process.env.FETCH_CONCURRENCY || 10);
const AUTOCOMPLETE_SEEDS =
  (process.env.AUTOCOMPLETE_SEEDS &&
    process.env.AUTOCOMPLETE_SEEDS.split(',').map((s) => s.trim()).filter(Boolean)) ||
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    .split('')
    .map((c) => c.trim())
    .filter(Boolean);

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const baseHeaders = {
      'User-Agent':
        (options.headers && options.headers['User-Agent']) ||
        (options.headers && options.headers['user-agent']) ||
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
      Accept: '*/*',
      'Accept-Language': 'it-IT,it;q=0.9,en-US;q=0.8,en;q=0.7',
    };
    return await fetch(url, {
      ...options,
      headers: { ...baseHeaders, ...(options.headers || {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

function smartCase(name) {
  const n = name == null ? '' : String(name).trim();
  if (!n) return null;
  if (/[a-z]/.test(n)) return n; // già mixed case
  return n
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function pickId(entry) {
  return (
    entry.id ||
    entry.codice ||
    entry.codiceStazione ||
    entry.stationCode ||
    entry.code ||
    null
  );
}

function pickName(entry) {
  if (entry && typeof entry === 'object') {
    const loc = entry.localita || entry.stazione || entry.station || null;
    const locName =
      (loc && (loc.nomeLungo || loc.label || loc.nomeBreve || loc.name)) || null;
    const direct =
      entry.nomeLungo ||
      entry.nome ||
      entry.label ||
      entry.nomeBreve ||
      entry.denominazione ||
      entry.description ||
      entry.localita ||
      entry.name ||
      null;
    const candidate = locName || direct;
    return smartCase(candidate);
  }

  const candidate =
    entry || null;
  return smartCase(candidate);
}

function pickRegionId(entry) {
  return (
    entry.region ||
    entry.regione ||
    entry.idRegione ||
    entry.regionId ||
    entry.id_reg ||
    null
  );
}

function pickCoords(entry) {
  const latRaw =
    entry.lat ??
    entry.latitude ??
    entry.latitudine ??
    entry.latitudineCoordinate ??
    entry.Lat ??
    entry.latitudineGD ??
    null;
  const lonRaw =
    entry.lon ??
    entry.lng ??
    entry.long ??
    entry.longitude ??
    entry.longitudine ??
    entry.Long ??
    entry.longitudineGD ??
    null;

  const lat = latRaw != null ? Number(String(latRaw).replace(',', '.')) : null;
  const lon = lonRaw != null ? Number(String(lonRaw).replace(',', '.')) : null;

  return {
    lat: Number.isFinite(lat) ? lat : null,
    lon: Number.isFinite(lon) ? lon : null,
  };
}

function parseFallbackText(text) {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|');
      if (parts.length >= 2) {
        return { id: parts[1], nome: parts[0] };
      }
      return { nome: line };
    });
}

async function fetchAutocompleteSeed(seed) {
  const url = `${BASE_URL}/autocompletaStazione/${encodeURIComponent(seed)}`;
  const resp = await fetchWithTimeout(url);
  if (!resp.ok) {
    console.warn(`⚠️ Autocomplete ${seed} → HTTP ${resp.status}`);
    return [];
  }
  const text = await resp.text();
  return parseFallbackText(text);
}

async function collectStationsViaAutocomplete() {
  console.log(
    `Fallback: raccolgo stazioni via autocomplete (${AUTOCOMPLETE_SEEDS.length} seed)...`
  );
  const all = [];
  for (const seed of AUTOCOMPLETE_SEEDS) {
    try {
      const list = await fetchAutocompleteSeed(seed);
      list.forEach((item) => all.push(item));
    } catch (err) {
      console.warn(`⚠️ Seed ${seed} errore: ${err.message}`);
    }
  }
  console.log(`Autocomplete raccolte: ${all.length} righe (prima della deduplica)`);
  return all;
}

async function fetchRegionId(stationCode) {
  const resp = await fetchWithTimeout(
    `${BASE_URL}/regione/${encodeURIComponent(stationCode)}`
  );
  if (!resp.ok) return null;
  return (await resp.text()).trim();
}

async function fetchStationDetail(stationCode, regionId) {
  const url = `${BASE_URL}/dettaglioStazione/${encodeURIComponent(
    stationCode
  )}/${encodeURIComponent(regionId)}`;
  const resp = await fetchWithTimeout(url);
  if (!resp.ok) return null;
  try {
    return await resp.json();
  } catch {
    return null;
  }
}

async function hydrateStation(station) {
  if (!station.id) return station;

  try {
    const regionId = station.regionId || (await fetchRegionId(station.id));
    if (!regionId) return station;

    const detail = await fetchStationDetail(station.id, regionId);
    if (!detail) return { ...station, regionId };

    const coords = pickCoords(detail);
    const name = pickName(detail) || station.name;

    return {
      ...station,
      name,
      regionId,
      lat: coords.lat != null ? coords.lat : station.lat ?? null,
      lon: coords.lon != null ? coords.lon : station.lon ?? null,
    };
  } catch (err) {
    console.warn(`⚠️ Dettaglio mancante per ${station.id}: ${err.message}`);
    return station;
  }
}

async function main() {
  console.log('Scarico elenco stazioni da ViaggiaTreno...');
  let rawList = [];
  try {
    const resp = await fetchWithTimeout(`${BASE_URL}/elencoStazioni`);
    if (resp.ok) {
      const rawText = await resp.text();
      try {
        const parsed = JSON.parse(rawText);
        if (Array.isArray(parsed)) rawList = parsed;
      } catch {
        rawList = parseFallbackText(rawText);
      }
    } else {
      console.warn(`⚠️ elencoStazioni non disponibile (HTTP ${resp.status}), passo al fallback`);
    }
  } catch (err) {
    console.warn(`⚠️ elencoStazioni non raggiungibile: ${err.message}`);
  }

  if (!rawList.length) {
    rawList = await collectStationsViaAutocomplete();
  }

  if (!rawList.length) {
    throw new Error('Elenco stazioni vuoto o non riconosciuto');
  }

  const byId = new Map();
  const byName = new Map();

  for (const entry of rawList) {
    const id = pickId(entry);
    const name = pickName(entry);
    const regionId = pickRegionId(entry);
    const coords = pickCoords(entry);
    if (!name) continue;

    if (id) {
      if (!byId.has(id)) {
        byId.set(id, {
          id,
          name,
          regionId: regionId || null,
          lat: coords.lat,
          lon: coords.lon,
        });
      }
      continue;
    }

    const key = name.toLowerCase();
    if (!byName.has(key)) {
      byName.set(key, { name });
    }
  }

  const baseStations = [...byId.values()];

  // Arricchisci con coordinate (e nome corretto) usando dettaglioStazione
  console.log(
    `Recupero dettagli per ${baseStations.length} stazioni (concurrency ${FETCH_CONCURRENCY})...`
  );

  const hydrated = [];
  let idx = 0;

  async function worker() {
    while (true) {
      const current = idx;
      idx += 1;
      if (current >= baseStations.length) break;
      const item = baseStations[current];
      const h = await hydrateStation(item);
      hydrated.push(h);
    }
  }

  const workers = Array.from(
    { length: Math.min(FETCH_CONCURRENCY, baseStations.length) },
    () => worker()
  );

  await Promise.all(workers);

  // Unisci le stazioni senza id in coda
  const output = [...hydrated, ...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'it')
  );

  await fs.writeFile(OUTPUT_PATH, JSON.stringify(output, null, 2), 'utf8');
  console.log(`✅ Salvate ${output.length} stazioni in ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error('Errore:', err.message);
  process.exit(1);
});
