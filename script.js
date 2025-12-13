//Developed by Cristian Ceni 2025 dhn

const LOCAL_DEV_HOSTS = ['localhost', '127.0.0.1'];
const API_BASE =
  LOCAL_DEV_HOSTS.includes(window.location.hostname)
    ? 'http://localhost:3000' // sviluppo locale: backend separato
    : '';                      // produzione: stessa origin (Netlify)


const RECENT_KEY = 'monitor_treno_recent';
const FAVORITES_KEY = 'monitor_treno_favorites';
const MAX_RECENT = 5;
const MAX_FAVORITES = 8;

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

const TRAIN_KIND_RULES = [
  // Alta velocità e servizi internazionali (fonte: classificazioni Trenitalia/Wikipedia)
  {
    matches: ['FRECCIAROSSA', 'FRECCIAROSSA AV', 'FRECCIAROSSAAV', 'FR', 'FR AV', 'FRAV', 'FR EC', 'FRECCIAROSSA EC'],
    boardLabel: 'Frecciarossa',
    detailLabel: 'Frecciarossa AV',
    className: 'train-title--fr',
  },
  {
    matches: ['FRECCIARGENTO', 'FRECCIARGENTO AV', 'FRECCIARGENTOAV', 'FA', 'FA AV'],
    boardLabel: 'Frecciargento',
    detailLabel: 'Frecciargento AV',
    className: 'train-title--fr',
  },
  {
    matches: ['FRECCIABIANCA', 'FB'],
    boardLabel: 'Frecciabianca',
    detailLabel: 'Frecciabianca',
    className: 'train-title--ic',
  },
  {
    matches: ['ITALO', 'ITALO AV', 'ITALOAV', 'NTV', 'ITA'],
    boardLabel: 'Italo',
    detailLabel: 'Italo AV',
    className: 'train-title--fr',
  },
  {
    matches: ['EUROCITY', 'EC'],
    boardLabel: 'EuroCity',
    detailLabel: 'EuroCity',
    className: 'train-title--ic',
  },
  {
    matches: ['EURONIGHT', 'EN'],
    boardLabel: 'EuroNight',
    detailLabel: 'EuroNight',
    className: 'train-title--ic',
  },
  {
    matches: ['TGV'],
    boardLabel: 'TGV',
    detailLabel: 'TGV',
    className: 'train-title--fr',
  },
  {
    matches: ['RAILJET', 'RJ'],
    boardLabel: 'Railjet',
    detailLabel: 'Railjet',
    className: 'train-title--ic',
  },
  // Lunga percorrenza tradizionale
  {
    matches: ['INTERCITY NOTTE', 'INTERCITYNOTTE', 'ICN'],
    boardLabel: 'Intercity Notte',
    detailLabel: 'Intercity Notte',
    className: 'train-title--ic',
  },
  {
    matches: ['INTERCITY', 'IC'],
    boardLabel: 'Intercity',
    detailLabel: 'Intercity',
    className: 'train-title--ic',
  },
  {
    matches: ['ESPRESSO', 'EXP', 'E'],
    boardLabel: 'Espresso',
    detailLabel: 'Espresso',
    className: 'train-title--ic',
  },
  {
    matches: ['EUROSTAR', 'EUROSTAR CITY', 'EUROSTARCITY', 'ES', 'ESC', 'ES CITY', 'ES AV', 'ESAV', 'ES FAST'],
    boardLabel: 'Eurostar',
    detailLabel: 'Eurostar',
    className: 'train-title--fr',
  },
  // Regionali e suburbani
  {
    matches: ['REGIONALE VELOCE', 'REGIONALEVELOCE', 'RV', 'RGV'],
    boardLabel: 'Regionale Veloce',
    detailLabel: 'Regionale Veloce',
    className: 'train-title--reg',
  },
  {
    matches: ['REGIOEXPRESS', 'REGIO EXPRESS', 'RE'],
    boardLabel: 'RegioExpress',
    detailLabel: 'RegioExpress',
    className: 'train-title--reg',
  },
  {
    matches: ['SUBURBANO', 'SERVIZIO SUBURBANO', 'SUB', 'S'],
    boardLabel: 'Suburbano',
    detailLabel: 'Suburbano',
    className: 'train-title--reg',
  },
  {
    matches: ['METROPOLITANO', 'MET', 'METROPOLITANA', 'M', 'SFM'],
    boardLabel: 'Metropolitano',
    detailLabel: 'Metropolitano',
    className: 'train-title--reg',
  },
  {
    matches: ['MALPENSA EXPRESS', 'MALPENSAEXPRESS', 'MXP'],
    boardLabel: 'Malpensa Express',
    detailLabel: 'Malpensa Express',
    className: 'train-title--reg',
  },
  {
    matches: ['LEONARDO EXPRESS', 'LEONARDOEXPRESS', 'LEONARDO'],
    boardLabel: 'Leonardo Express',
    detailLabel: 'Leonardo Express',
    className: 'train-title--reg',
  },
  {
    matches: ['FERROVIE LAZIALI', 'FL'],
    boardLabel: 'Ferrovie Laziali',
    detailLabel: 'Ferrovie Laziali',
    className: 'train-title--reg',
  },
  {
    matches: ['AIRLINK'],
    boardLabel: 'Airlink',
    detailLabel: 'Airlink',
    className: 'train-title--reg',
  },
  {
    matches: ['TROPEA EXPRESS', 'TROPEAEXPRESS', 'TROPEA'],
    boardLabel: 'Tropea Express',
    detailLabel: 'Tropea Express',
    className: 'train-title--reg',
  },
  {
    matches: ['CIVITAVECCHIA EXPRESS', 'CIVITAVECCHIAEXPRESS', 'CIVITAVECCHIA'],
    boardLabel: 'Civitavecchia Express',
    detailLabel: 'Civitavecchia Express',
    className: 'train-title--reg',
  },
  {
    matches: ['PANORAMA EXPRESS', 'PANORAMAEXPRESS', 'PE'],
    boardLabel: 'Panorama Express',
    detailLabel: 'Panorama Express',
    className: 'train-title--reg',
  },
  {
    matches: ['REGIONALE', 'REG', 'R'],
    boardLabel: 'Regionale',
    detailLabel: 'Regionale',
    className: 'train-title--reg',
  },
  {
    matches: ['INTERREGIONALE', 'IR'],
    boardLabel: 'Interregionale',
    detailLabel: 'Interregionale',
    className: 'train-title--reg',
  },
  {
    matches: ['DIRETTISSIMO', 'DD'],
    boardLabel: 'Direttissimo',
    detailLabel: 'Direttissimo',
    className: 'train-title--reg',
  },
  {
    matches: ['DIRETTO', 'DIR', 'D'],
    boardLabel: 'Diretto',
    detailLabel: 'Diretto',
    className: 'train-title--reg',
  },
  {
    matches: ['ACCELERATO', 'ACC', 'A'],
    boardLabel: 'Accelerato',
    detailLabel: 'Accelerato',
    className: 'train-title--reg',
  },
];

function resolveTrainKindFromCode(...rawValues) {
  for (const raw of rawValues) {
    if (raw == null) continue;
    const normalized = String(raw)
      .toUpperCase()
      .replace(/[-_/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!normalized) continue;
    const alphaOnly = normalized.replace(/[^A-Z]/g, '');
    const alphaPrefixMatch = normalized.match(/^[A-Z]+/);
    const alphaPrefix = alphaPrefixMatch ? alphaPrefixMatch[0] : '';
    const firstToken = normalized.split(' ')[0] || '';
    const candidates = new Set([normalized]);
    if (alphaOnly) candidates.add(alphaOnly);
    if (alphaPrefix) candidates.add(alphaPrefix);
    if (firstToken) candidates.add(firstToken);
    for (const rule of TRAIN_KIND_RULES) {
      const matched = rule.matches.some((token) => candidates.has(token));
      if (matched) {
        const numberMatch = normalized.match(/(\d{2,5})/);
        return {
          boardLabel: rule.boardLabel,
          detailLabel: rule.detailLabel,
          className: rule.className,
          number: numberMatch ? numberMatch[1] : '',
        };
      }
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
const tripResults = document.getElementById('tripResults');

let tripFromId = null;
let tripToId = null;

let selectedStation = null;
let stationBoardData = { departures: [], arrivals: [] };
let stationBoardActiveTab = 'departures';
function scrollToSection(element) {
  if (!element || typeof element.scrollIntoView !== 'function') return;
  requestAnimationFrame(() => {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// UTIL ---------------------------------------------------------------

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
  const normalizedCode = normalizeStationCode(code);
  if (!normalizedCode) {
    console.warn('Codice stazione non valido per la selezione rapida:', code);
    return;
  }

  const displayName = name || normalizedCode;
  
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
    if (stationInfoContainer) {
      stationInfoContainer.classList.remove('hidden');
      stationInfoContainer.innerHTML = '<p class="error">Errore nel recupero delle informazioni della stazione.</p>';
    }
    if (stationBoardContainer) {
      stationBoardContainer.classList.add('hidden');
    }
  }
}

function renderStationInfoContent(selection, infoPayload) {
  if (!stationInfoContainer) return;
  const stationDetails = infoPayload?.station || {};
  const regionLabel = resolveRegionLabel(stationDetails, infoPayload);
  const lat = stationDetails.latitudine ?? stationDetails.lat ?? stationDetails.latitude;
  const lon = stationDetails.longitudine ?? stationDetails.lon ?? stationDetails.longitude;
  const hasCoords = lat != null && lon != null && lat !== '' && lon !== '';
  const mapsLink = hasCoords ? `https://www.google.com/maps?q=${lat},${lon}` : null;
  const stationCodes = getStationCodeCandidates(selection, stationDetails, infoPayload);
  const weatherDetails = buildWeatherDetails(infoPayload?.meteo, stationCodes);

  const regionLabelText = typeof regionLabel === 'string' ? regionLabel.trim() : '';
  const temperatureText = typeof weatherDetails?.temperature === 'string' ? weatherDetails.temperature : '';
  const rawTempClass = temperatureText && typeof weatherDetails?.temperatureClass === 'string'
    ? weatherDetails.temperatureClass
    : '';
  const safeTempClass = rawTempClass ? ` ${escapeHtml(rawTempClass)}` : '';
  const regionSegments = [];
  if (regionLabelText) {
    regionSegments.push(`<span class="station-info-region-label">${escapeHtml(regionLabelText)}</span>`);
  }
  if (temperatureText) {
    regionSegments.push(`<span class="station-info-temp${safeTempClass}">${escapeHtml(temperatureText)}</span>`);
  }
  const regionLine = regionSegments.length
    ? `<p class="station-info-region-text">${regionSegments.join(' · ')}</p>`
    : '';

  stationInfoContainer.classList.remove('hidden');
  stationInfoContainer.innerHTML = `
    <div class="station-info-header">
      <div>
        ${regionLine}
      </div>
      ${mapsLink
        ? `<a href="${mapsLink}" target="_blank" rel="noopener noreferrer" class="station-maps-btn">
            <img src="/img/maps.png" alt="" class="station-maps-icon" aria-hidden="true" />
            Maps
          </a>`
        : ''}
    </div>
  `;
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
  const routeLabel = isDeparture
    ? (entry.destinazione || entry.destinazioneBreve || entry.compDestinazione || '-')
    : (entry.provenienza || entry.origine || entry.compOrigine || '-');
  const category = entry.categoria || entry.compTipologiaTreno || entry.tipoTreno || 'Treno';
  const compTrainCode = entry.compNumeroTreno || entry.siglaTreno || '';
  const numericTrainCode = entry.numeroTreno || (compTrainCode.match(/\d+/)?.[0] ?? '');
  const trainKindMeta = resolveTrainKindFromCode(
    compTrainCode,
    entry.compTipologiaTreno,
    entry.categoriaDescrizione,
    category
  );
  const displayTrainName = trainKindMeta?.boardLabel || category || 'Treno';
  const displayTrainNumber = trainKindMeta?.number || numericTrainCode || compTrainCode || '';
  const trainLabel = `${displayTrainName} ${displayTrainNumber}`.trim();
  const delay = resolveDelay(entry.ritardo, entry.compRitardo);
  const isCancelled = entry.cancellato === true || entry.cancellata === true || entry.soppresso === true;
  const trackInfo = getBoardTrack(entry, type);
  const delayBadge = buildBoardDelayBadge(delay, isCancelled);
  const destPrefix = isDeparture ? 'per ' : 'da ';
  const ariaLabel = `${trainLabel} ${destPrefix}${routeLabel}`.trim();
  const searchTrainNumber = trainKindMeta?.number || numericTrainCode || compTrainCode || '';
  const datasetNumber = escapeHtml(searchTrainNumber);
  const trackClass = trackInfo.isReal ? 'sb-track-pill sb-track-pill--real' : 'sb-track-pill';
  const boardTrainClass = trainKindMeta?.className || '';

  // New Layout mimicking solution-card
  return `
    <div class="station-board-card" role="button" tabindex="0" data-train-number="${datasetNumber}" aria-label="${escapeHtml(ariaLabel)}">
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
    return;
  }

  try {
    // Usa endpoint specifico ViaggiaTreno
    const res = await fetch(`${API_BASE}/api/viaggiatreno/autocomplete?query=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const items = (data && data.data) || [];
    renderStationList(items);
  } catch (err) {
    console.error('Errore autocomplete stazioni:', err);
    stationList.innerHTML = '<li class="error-item">Errore nel recupero delle stazioni</li>';
    stationList.hidden = false;
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
    const name = item.name || item.nome || '';
    const code = item.code || item.id || '';
    return `<li data-code="${code}" data-name="${name}">${name} <span class="muted">(${code})</span></li>`;
  });

  stationList.innerHTML = parts.join('');
  stationList.hidden = false;
}

stationQueryInput.addEventListener('input', (e) => {
  selectedStation = null;
  resetStationDisplay();
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
    
    try {
      const res = await fetch(`${API_BASE}/api/viaggiatreno/autocomplete?query=${encodeURIComponent(q)}`);
      if (!res.ok) return;
      const data = await res.json();
      const items = (data && data.data) || [];
      if (items.length > 0) {
        const first = items[0];
        const name = first.name || first.nome || '';
        const code = first.code || first.id || '';
        if (name && code) {
            await loadStationByCode(name, code);
        }
      }
    } catch (err) {
      console.error('Errore ricerca stazione manuale:', err);
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
    if (trainNumberInput) {
      trainNumberInput.value = trainNum;
    }
    cercaStatoTreno(trainNum);
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

function addToStorage(key, item, uniqueKey = 'id') {
  const list = loadStorage(key);
  const filtered = list.filter(i => String(i[uniqueKey]) !== String(item[uniqueKey]));
  filtered.unshift(item);
  const trimmed = filtered.slice(0, MAX_RECENT);
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
      
      const timeInfo = item.partenza ? `<span class="chip-time">${item.partenza}</span>` : '';
      
      contentHtml = `
        <div class="chip-train-info">
            <div class="chip-route">${escapeHtml(route)}</div>
            <div class="chip-meta">
                <span class="chip-number">Treno ${item.numero}</span>
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
        <span class="storage-chip-content">
            ${contentHtml}
        </span>
        <div class="storage-chip-actions">
            <button type="button" class="storage-chip-btn storage-chip-fav ${isFav ? 'is-active' : ''}" title="${isFav ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}">
                ${isFav ? '★' : '☆'}
            </button>
            <button type="button" class="storage-chip-btn storage-chip-remove" title="Rimuovi">×</button>
        </div>
      </div>
    `;
  }).join('');
  
  // Add event listeners
  container.querySelectorAll('.storage-chip').forEach((chip, idx) => {
    chip.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.storage-chip-remove');
      const favBtn = e.target.closest('.storage-chip-fav');
      
      if (removeBtn) {
        e.stopPropagation();
        onRemove(list[idx]);
      } else if (favBtn) {
        e.stopPropagation();
        if (onToggleFav) onToggleFav(list[idx]);
      } else {
        onSelect(list[idx]);
      }
    });
  });
}

// --- TRAIN STORAGE ---

function updateTrainStorage() {
  const recents = loadStorage(RECENT_KEY);
  const favorites = loadStorage(FAVORITES_KEY);
  
  // Merge lists: Recents first, then Favorites (so favorites are at the bottom/end)
  const favIds = new Set(favorites.map(i => String(i.numero)));
  const uniqueRecents = recents.filter(i => !favIds.has(String(i.numero)));
  const displayList = [...uniqueRecents, ...favorites];

  renderChips(trainStorageContainer, displayList, 'train', 
    (item) => {
      trainNumberInput.value = item.numero;
      cercaStatoTreno();
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
        addToStorage(RECENT_KEY, item, 'numero'); 
      } else {
        addToStorage(FAVORITES_KEY, item, 'numero');
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
    arrivo: details.arrivo
  }, 'numero');
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
    addToStorage(RECENT_KEY, data, 'numero');
  } else {
    addToStorage(FAVORITES_KEY, data, 'numero');
  }
  updateTrainStorage();
}

function updateFavoriteActionButton(btn) {
  if (!btn) return;
  const num = btn.getAttribute('data-num');
  const isFav = isFavoriteTrain(num);
  btn.classList.toggle('is-active', isFav);
  btn.textContent = isFav ? 'Rimuovi dai preferiti' : 'Salva nei preferiti';
}

// --- TRIP STORAGE ---

function updateTripStorage() {
  const recents = loadStorage(TRIP_RECENT_KEY);
  renderChips(tripStorageContainer, recents, 'trip',
    (item) => {
      tripFromInput.value = item.from;
      tripToInput.value = item.to;
      // Optional: trigger search automatically?
      // tripSearchBtn.click();
    },
    (item) => {
      const id = `${item.from}|${item.to}`;
      const list = loadStorage(TRIP_RECENT_KEY);
      const filtered = list.filter(i => `${i.from}|${i.to}` !== id);
      saveStorage(TRIP_RECENT_KEY, filtered);
      updateTripStorage();
    }
  );
}

function addRecentTrip(from, to) {
  if (!from || !to) return;
  const list = loadStorage(TRIP_RECENT_KEY);
  const newItem = { from, to };
  const id = `${from}|${to}`;
  
  const filtered = list.filter(i => `${i.from}|${i.to}` !== id);
  filtered.unshift(newItem);
  const trimmed = filtered.slice(0, MAX_RECENT);
  saveStorage(TRIP_RECENT_KEY, trimmed);
  updateTripStorage();
}

// --- STATION STORAGE ---

function updateStationStorage() {
  const recents = loadStorage(STATION_RECENT_KEY);
  renderChips(stationStorageContainer, recents, 'station',
    (item) => {
      const input = document.getElementById('stationQuery');
      if (input) {
        input.value = item.name;
        // Trigger search
        if (item.id && item.name) {
            loadStationByCode(item.name, item.id);
        }
      }
    },
    (item) => {
      const newList = removeFromStorage(STATION_RECENT_KEY, item.id, 'id');
      updateStationStorage();
    }
  );
}

function addRecentStation(station) {
  if (!station || !station.name) return;
  addToStorage(STATION_RECENT_KEY, { id: station.id, name: station.name }, 'id');
  updateStationStorage();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  updateTrainStorage();
  updateTripStorage();
  updateStationStorage();
});

// Old init calls removed
// renderFavoriteTrains();
// renderRecentTrains();

if (trainResult) {
  trainResult.addEventListener('click', (e) => {
    const favBtn = e.target.closest('.favorite-current-btn');
    if (favBtn) {
      const data = {
        numero: favBtn.getAttribute('data-num') || '',
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

function getLastRealStopIndex(fermate) {
  let last = -1;
  fermate.forEach((f, i) => {
    const arrRealMs = parseToMillis(f.arrivoReale ?? f.effettiva);
    const depRealMs = parseToMillis(f.partenzaReale);
    if (arrRealMs || depRealMs) last = i;
  });
  return last;
}

function getLastDepartedStopIndex(fermate) {
  let last = -1;
  const finalIdx = fermate.length - 1;
  fermate.forEach((f, i) => {
    const depRealMs = parseToMillis(f.partenzaReale);
    if (depRealMs) {
      last = i;
      return;
    }
    if (i === finalIdx) {
      const arrRealMs = parseToMillis(f.arrivoReale ?? f.effettiva);
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

function extractTrackInfo(stop) {
  if (!stop) {
    return { label: '', isReal: false, planned: '', actual: '' };
  }

  const actual = stop.binarioEffettivoArrivoDescrizione ||
    stop.binarioEffettivoPartenzaDescrizione ||
    stop.binarioEffettivoArrivo ||
    stop.binarioEffettivoPartenza ||
    '';

  const planned = stop.binarioProgrammatoArrivoDescrizione ||
    stop.binarioProgrammatoPartenzaDescrizione ||
    stop.binarioProgrammatoArrivo ||
    stop.binarioProgrammatoPartenza ||
    '';

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

function getTimelineGapRange() {
  if (typeof window !== 'undefined' && window.matchMedia) {
    const isCompact = window.matchMedia('(max-width: 640px)').matches;
    if (isCompact) {
      return { min: 6, max: 58 };
    }
  }
  return { min: 3, max: 28 };
}

function mapProgressToGapPx(progress, range) {
  const ratio = clamp01(progress);
  const span = Math.max(range.max - range.min, 1);
  return Math.round(range.max - span * ratio);
}

function getTimelineGapSize(idx, lastDepartedIdx, timelineProgress, gapRange) {
  if (idx <= lastDepartedIdx) return 4;
  if (
    timelineProgress &&
    timelineProgress.nextIdx === idx &&
    typeof timelineProgress.progress === 'number'
  ) {
    return mapProgressToGapPx(timelineProgress.progress, gapRange);
  }
  return null;
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
  } else if (pastCount >= total && lastArrReal) {
    state = 'COMPLETED';
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
  const currentIndex = currentInfo.currentIndex >= 0 ? currentInfo.currentIndex : 0;
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
    case 'COMPLETED':
      mainLine = 'Il treno ha terminato la corsa.';
      break;
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
  trainResult.innerHTML = '';
  if (!d) {
    const msg = payload && payload.message
      ? payload.message
      : 'Nessun dato disponibile per questo treno.';
    trainResult.innerHTML = `<p class='muted'>${msg}</p>`;
    return;
  }

  const journey = computeJourneyState(d);
  const currentInfo = findCurrentStopInfo(d);
  const fermate = Array.isArray(d.fermate) ? d.fermate : [];
  const { departure: plannedDeparture, arrival: plannedArrival } = getPlannedTimes(fermate);
  const lastRealIdx = fermate.length > 0 ? getLastRealStopIndex(fermate) : -1;
  const lastDepartedIdx = fermate.length > 0 ? getLastDepartedStopIndex(fermate) : -1;
  const lastOperationalIdx = fermate.length > 0
    ? getLastOperationalStopIndex(journey, fermate, lastRealIdx, lastDepartedIdx)
    : -1;
  const primary = buildPrimaryStatus(d, journey, currentInfo);
  const globalDelay = getGlobalDelayMinutes(d);
  const trainMeta = {
    numero: d.numeroTreno || d.numeroTrenoEsteso || payload.originCode || '',
    origine: d.origine || '',
    destinazione: d.destinazione || '',
    partenza: plannedDeparture,
    arrivo: plannedArrival,
  };
  const trainIsFavorite = trainMeta.numero ? isFavoriteTrain(trainMeta.numero) : false;

  const lastDetectionMillis = parseToMillis(d.oraUltimoRilevamento);
  const lastDetectionAgeMinutes = lastDetectionMillis != null
    ? (Date.now() - lastDetectionMillis) / 60000
    : null;
  const lastDetectionIsStale = lastDetectionAgeMinutes != null && lastDetectionAgeMinutes > 15;
  const lastDetectionTitle = lastDetectionIsStale
    ? 'Ultimo rilevamento più vecchio di 15 minuti'
    : '';

  const badgeLabelMap = {
    PLANNED: 'Pianificato',
    RUNNING: 'In viaggio',
    COMPLETED: 'Concluso',
    CANCELLED: 'Soppresso',
    PARTIAL: 'Cancellato parz.',
    UNKNOWN: 'Sconosciuto',
  };

  const stateKey = journey.state || 'UNKNOWN';
  const badgeStateClass = `badge-status-${stateKey.toLowerCase()}`;
  const badgeStateLabel = badgeLabelMap[stateKey] || badgeLabelMap.UNKNOWN;

  const completionChip = getCompletionChip(d, journey, globalDelay);

  const favoriteBtnHtml = trainMeta.numero
    ? `<button type="button" class="favorite-current-btn${trainIsFavorite ? ' is-active' : ''}" data-num="${trainMeta.numero}" data-orig="${encodeDatasetValue(trainMeta.origine)}" data-dest="${encodeDatasetValue(trainMeta.destinazione)}" data-dep="${encodeDatasetValue(trainMeta.partenza || '')}" data-arr="${encodeDatasetValue(trainMeta.arrivo || '')}">${trainIsFavorite ? 'Rimuovi dai preferiti' : 'Salva nei preferiti'}</button>`
    : '';

  const headerHtml = `
    <div class='train-header'>
      <div class='train-main'>
        <div class='train-title-row'>
          <img src='/img/trenitalia.png' alt='Logo Trenitalia' class='train-logo' />
          <h2 class='train-title ${primary.kindClass || ''}'>${primary.title || 'Dettagli treno'}</h2>
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
      <div class='train-meta'>
        ${d.oraUltimoRilevamento
      ? `<div class='train-last${lastDetectionIsStale ? ' train-last--stale' : ''}'${lastDetectionTitle ? ` title='${lastDetectionTitle}'` : ''}>
                Ultimo rilevamento ${formatTimeFlexible(d.oraUltimoRilevamento)}
                ${d.stazioneUltimoRilevamento ? ` – ${d.stazioneUltimoRilevamento}` : ''}
              </div>`
      : ''
    }
      </div>
    </div>
  `;

  const currentIndex = currentInfo.currentIndex >= 0 ? currentInfo.currentIndex : 0;
  const positionText = buildPositionText(journey, currentInfo, fermate, lastOperationalIdx);

  const primaryHtml = `
    <div class='train-primary-stat'>
      <p class='train-primary-main'>${primary.mainLine}</p>
      ${primary.delayLine
      ? `<p class="train-primary-sub">${primary.delayLine}</p>`
      : ''
    }
      ${primary.delaySubLine
      ? `<p class="train-primary-subtitle">
        <img src="/img/ah.png" alt="Info" class="icon-inline" />
        ${primary.delaySubLine}
      </p>`
      : ''
    }
      ${positionText
      ? `<p class='train-primary-meta'>${positionText}</p>`
      : ''
    }
      ${favoriteBtnHtml ? `<div class='favorite-current-wrapper'>${favoriteBtnHtml}</div>` : ''}
    </div>
  `;

  // Tabella fermate ---------------------------------------------------

  let tableHtml = '';
  if (fermate.length > 0) {
    const timelineProgress = computeTravelProgress(fermate, lastDepartedIdx);
    const timelineGapRange = getTimelineGapRange();

    const rows = fermate.map((f, idx) => {
      const isCurrent = currentInfo.currentIndex === idx;
      const isFirstStop = idx === 0;
      const isLastStop = idx === fermate.length - 1;
      const showArrival = !isFirstStop;
      const showDeparture = !isLastStop;
      const withinOperationalPlan =
        journey.state !== 'PARTIAL' || lastOperationalIdx < 0 || idx <= lastOperationalIdx;

      const arrProgRaw = f.arrivo_teorico ?? f.arrivoTeorico ?? f.programmata;
      const depProgRaw = f.partenza_teorica ?? f.partenzaTeorica ?? f.programmata;

      const hasRealArrival = f.arrivoReale != null || f.effettiva != null;
      const hasRealDeparture = f.partenzaReale != null;

      const arrRealRaw = f.arrivoReale ?? f.effettiva ?? null;
      const depRealRaw = f.partenzaReale ?? null;

      // previsti dal backend (se esistono)
      let arrPredRaw = !hasRealArrival ? (f.arrivoPrevista ?? null) : null;
      let depPredRaw = !hasRealDeparture ? (f.partenzaPrevista ?? null) : null;

      const arrProgMs = arrProgRaw ? parseToMillis(arrProgRaw) : null;
      const depProgMs = depProgRaw ? parseToMillis(depProgRaw) : null;
      const arrProg = arrProgRaw ? formatTimeFlexible(arrProgRaw) : '-';
      const depProg = depProgRaw ? formatTimeFlexible(depProgRaw) : '-';

      const arrProgHH = hhmmFromRaw(arrProgRaw);
      const depProgHH = hhmmFromRaw(depProgRaw);
      const arrRealHH = hhmmFromRaw(arrRealRaw);
      const depRealHH = hhmmFromRaw(depRealRaw);

      const ritArr = resolveDelay(f.ritardoArrivo, globalDelay);
      const ritDep = resolveDelay(f.ritardoPartenza, globalDelay);

      const shouldForecastArrival =
        (journey.state === 'RUNNING' || journey.state === 'PARTIAL') &&
        !hasRealArrival &&
        idx >= currentIndex &&
        withinOperationalPlan &&
        arrProgMs != null &&
        Number.isFinite(ritArr) &&
        ritArr !== 0;

      const shouldForecastDeparture =
        (journey.state === 'RUNNING' || journey.state === 'PARTIAL') &&
        !hasRealDeparture &&
        idx >= currentIndex &&
        withinOperationalPlan &&
        depProgMs != null &&
        Number.isFinite(ritDep) &&
        ritDep !== 0;

      if (shouldForecastArrival) {
        arrPredRaw = arrProgMs + ritArr * 60000;
      }

      if (shouldForecastDeparture) {
        depPredRaw = depProgMs + ritDep * 60000;
      }

      const trackInfo = extractTrackInfo(f);
      const trackClass = trackInfo.isReal ? 'col-track-pill col-track-pill--real' : 'col-track-pill';

      // stato riga (passato / corrente / futuro)
      let rowClass = '';
      if (isCurrent) {
        rowClass = 'stop-current';
      } else if (lastDepartedIdx >= 0 && idx <= lastDepartedIdx) {
        // tutte le fermate fino all'ultima con effettivi → passate
        rowClass = 'stop-past';
      } else {
        rowClass = 'stop-future';
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
        lastDepartedIdx,
        journey.state,
        lastOperationalIdx
      );
      const gapSize = getTimelineGapSize(idx, lastDepartedIdx, timelineProgress, timelineGapRange);
      const timelineStyleAttr = gapSize != null ? ` style="--timeline-gap-size: ${gapSize}px"` : '';


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
        } else if (arrPredRaw != null && Number.isFinite(ritArr) && ritArr !== 0 && idx >= currentIndex) {
          const forecastClass = ritArr > 0 ? 'forecast-late' : 'forecast-early';
          arrivalLine = `<span class="time-actual ${forecastClass}">${formatTimeFlexible(arrPredRaw)}</span>`;
        }
      }

      // PARTENZA: riga effettivo / previsto
      let departLine = '';
      if (showDeparture) {
        if (hasRealDeparture && depRealRaw) {
          departLine = `<span class="time-actual ${departEffClass}">${formatTimeFlexible(depRealRaw)}</span>`;
        } else if (depPredRaw != null && Number.isFinite(ritDep) && ritDep !== 0 && idx >= currentIndex) {
          const forecastClass = ritDep > 0 ? 'forecast-late' : 'forecast-early';
          departLine = `<span class="time-actual ${forecastClass}">${formatTimeFlexible(depPredRaw)}</span>`;
        }
      }

      const arrivalScheduledDisplay = showArrival ? arrProg : '--';
      const departureScheduledDisplay = showDeparture ? depProg : '--';
      const stationNameRaw = f.stazione || f.stazioneNome || '-';
      const safeStationName = escapeHtml(stationNameRaw || '-');
      const stationCode = getStopStationCode(f);
      const encodedStationName = encodeDatasetValue(stationNameRaw || '');
      const encodedStationCode = stationCode ? encodeDatasetValue(stationCode) : '';
      const stationAriaLabel = escapeHtml(`Apri dettagli stazione ${stationNameRaw || ''}`.trim());
      const stationDataAttrs = `data-station-name="${encodedStationName}"${encodedStationCode ? ` data-station-code="${encodedStationCode}"` : ''} aria-label="${stationAriaLabel || 'Apri stazione'}"`;

      return `
        <tr class="${rowClass}">
          <td class="col-idx" aria-label="Fermata ${idx + 1}">
            <span class="timeline-line ${timelineClasses}"${timelineStyleAttr}></span>
          </td>
          <td>
            <div class="st-name station-stop-trigger station-stop-trigger--text" role="button" tabindex="0" ${stationDataAttrs}>
              ${safeStationName}
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
      const isCurrent = currentInfo.currentIndex === idx;
      const isFirstStop = idx === 0;
      const isLastStop = idx === fermate.length - 1;
      const showArrival = !isFirstStop;
      const showDeparture = !isLastStop;
      const withinOperationalPlan =
        journey.state !== 'PARTIAL' || lastOperationalIdx < 0 || idx <= lastOperationalIdx;

      const arrProgRaw = f.arrivo_teorico ?? f.arrivoTeorico ?? f.programmata;
      const depProgRaw = f.partenza_teorica ?? f.partenzaTeorica ?? f.programmata;

      const hasRealArrival = f.arrivoReale != null || f.effettiva != null;
      const hasRealDeparture = f.partenzaReale != null;

      const arrRealRaw = f.arrivoReale ?? f.effettiva ?? null;
      const depRealRaw = f.partenzaReale ?? null;

      const arrProgMs = arrProgRaw ? parseToMillis(arrProgRaw) : null;
      const depProgMs = depProgRaw ? parseToMillis(depProgRaw) : null;

      let arrPredRaw = !hasRealArrival ? (f.arrivoPrevista ?? null) : null;
      let depPredRaw = !hasRealDeparture ? (f.partenzaPrevista ?? null) : null;

      const arrProg = arrProgRaw ? formatTimeFlexible(arrProgRaw) : '-';
      const depProg = depProgRaw ? formatTimeFlexible(depProgRaw) : '-';

      const arrProgHH = hhmmFromRaw(arrProgRaw);
      const depProgHH = hhmmFromRaw(depProgRaw);
      const arrRealHH = hhmmFromRaw(arrRealRaw);
      const depRealHH = hhmmFromRaw(depRealRaw);

      const ritArr = resolveDelay(f.ritardoArrivo, globalDelay);
      const ritDep = resolveDelay(f.ritardoPartenza, globalDelay);

      const shouldForecastArrival =
        (journey.state === 'RUNNING' || journey.state === 'PARTIAL') &&
        !hasRealArrival &&
        idx >= currentIndex &&
        withinOperationalPlan &&
        arrProgMs != null &&
        Number.isFinite(ritArr) &&
        ritArr !== 0;

      const shouldForecastDeparture =
        (journey.state === 'RUNNING' || journey.state === 'PARTIAL') &&
        !hasRealDeparture &&
        idx >= currentIndex &&
        withinOperationalPlan &&
        depProgMs != null &&
        Number.isFinite(ritDep) &&
        ritDep !== 0;

      if (shouldForecastArrival) {
        arrPredRaw = arrProgMs + ritArr * 60000;
      }

      if (shouldForecastDeparture) {
        depPredRaw = depProgMs + ritDep * 60000;
      }

      const trackInfo = extractTrackInfo(f);
      const cardTrackClass = trackInfo.isReal ? 'stop-card-track stop-card-track--real' : 'stop-card-track';

      let rowClass = '';
      if (isCurrent) {
        rowClass = 'stop-current';
      } else if (lastDepartedIdx >= 0 && idx <= lastDepartedIdx) {
        rowClass = 'stop-past';
      } else {
        rowClass = 'stop-future';
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
        lastDepartedIdx,
        journey.state,
        lastOperationalIdx
      );
      const gapSize = getTimelineGapSize(idx, lastDepartedIdx, timelineProgress, timelineGapRange);
      const timelineStyleAttr = gapSize != null ? ` style="--timeline-gap-size: ${gapSize}px"` : '';

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
        } else if (arrPredRaw != null && Number.isFinite(ritArr) && ritArr !== 0 && idx >= currentIndex) {
          arrivalActual = formatTimeFlexible(arrPredRaw);
          arrivalActualClass = ritArr > 0 ? 'forecast-late' : 'forecast-early';
        }
      }

      let departureActual = '';
      let departureActualClass = '';
      if (showDeparture) {
        if (hasRealDeparture && depRealRaw) {
          departureActual = formatTimeFlexible(depRealRaw);
          departureActualClass = departEffClass || 'delay-ok';
        } else if (depPredRaw != null && Number.isFinite(ritDep) && ritDep !== 0 && idx >= currentIndex) {
          departureActual = formatTimeFlexible(depPredRaw);
          departureActualClass = ritDep > 0 ? 'forecast-late' : 'forecast-early';
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

      const stazioneName = f.stazione || f.stazioneNome || '-';
      const safeStationName = escapeHtml(stazioneName || '-');
      const stationCode = getStopStationCode(f);
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

  const jsonDebugHtml = `
    <details class='json-debug'>
      <summary>Dettagli raw (JSON ViaggiaTreno)</summary>
      <pre>${escapeHtml(JSON.stringify(d, null, 2))}</pre>
    </details>
  `;

  trainResult.innerHTML = headerHtml + primaryHtml + tableHtml + jsonDebugHtml;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// HANDLER RICERCA -----------------------------------------------------

async function cercaStatoTreno(trainNumberOverride = '') {
  trainError.textContent = '';
  trainResult.innerHTML = '';

  const overrideValue = typeof trainNumberOverride === 'string' ? trainNumberOverride : '';
  const num = (overrideValue || trainNumberInput.value || '').trim();
  if (!num) {
    trainError.textContent = 'Inserisci un numero di treno.';
    return;
  }

  trainResult.innerHTML = `
    <div class="loading-container">
      <div class="loading-bar"></div>
      <div class="loading-text">Caricamento stato treno...</div>
    </div>
  `;

  try {
    const res = await fetch(
      `${API_BASE}/api/trains/status?trainNumber=${encodeURIComponent(num)}`
    );

    if (!res.ok) {
      trainError.textContent = `Errore HTTP dal backend: ${res.status}`;
      trainResult.innerHTML = '';
      return;
    }

    const data = await res.json();

    if (!data.ok) {
      trainError.textContent = data.error || 'Errore logico dal backend.';
      trainResult.innerHTML = '';
      return;
    }

    if (!data.data) {
      trainResult.innerHTML = `<p class='muted'>${data.message || 'Nessun treno trovato.'}</p>`;
      return;
    }

    const dd = data.data;
    const { departure, arrival } = getPlannedTimes(dd.fermate);
    addRecentTrain({
      numero: dd.numeroTreno || num,
      origine: dd.origine,
      destinazione: dd.destinazione,
      partenza: departure,
      arrivo: arrival,
    });

    renderTrainStatus(data);
  } catch (err) {
    console.error('Errore fetch train status:', err);
    trainError.textContent = 'Errore di comunicazione con il backend locale.';
    trainResult.innerHTML = '';
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

setupTripAutocomplete(tripToInput, tripToList, (station) => {
  tripToId = station.id;
});

if (tripSearchBtn) {
  tripSearchBtn.addEventListener('click', async () => {
    const fromName = tripFromInput.value.trim();
    const toName = tripToInput.value.trim();

    if (!fromName || !toName) {
      alert('Inserisci stazione di partenza e arrivo.');
      return;
    }

    if (typeof addRecentTrip === 'function') {
      addRecentTrip(fromName, toName);
    }
    
    const date = tripDateInput.value;
    const time = tripTimeInput.value;
    
    if (!date) {
      alert('Seleziona una data.');
      return;
    }

    tripResults.innerHTML = `
      <div class="loading-container">
        <div class="loading-bar"></div>
        <div class="loading-text">Caricamento soluzioni...</div>
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

      const res = await fetch(`${API_BASE}/api/solutions?${params.toString()}`);
      const json = await res.json();

      if (!json.ok) {
        tripResults.innerHTML = `<div class="error">Errore: ${json.error || 'Sconosciuto'}</div>`;
        return;
      }

      renderTripResults(json.solutions);

    } catch (err) {
      console.error(err);
      tripResults.innerHTML = `<div class="error">Errore di rete.</div>`;
    }
  });
}

function renderTripResults(solutions) {
  if (!solutions || solutions.length === 0) {
    tripResults.innerHTML = '<div class="info">Nessuna soluzione trovata.</div>';
    return;
  }

  let html = '<div class="solutions-list">';
  
  solutions.forEach(item => {
    // A volte l'oggetto è { solution: {...}, ... } altre volte è direttamente la soluzione
    const sol = item.solution || item;

    const depTime = new Date(sol.departureTime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const arrTime = new Date(sol.arrivalTime).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
    const duration = sol.duration || '-'; 
    
    // Treni: cerchiamo in diverse proprietà possibili.
    // Priorità a 'nodes' o 'solutionSegments' che contengono orari e stazioni per ogni tratta.
    const vehicleList = sol.nodes || sol.solutionSegments || sol.segments || sol.trains || sol.vehicles || [];
    
    // Helper per determinare la classe CSS in base al tipo di treno
    const getTrainTypeClass = (ident) => {
        const s = ident.toUpperCase();
        if (s.includes('FRECCIAROSSA') || s.includes('FR ') || s.includes('FRECCIARGENTO') || s.includes('FA ') || s.includes('FRECCIABIANCA') || s.includes('FB ')) return 'train-type-fr';
        if (s.includes('INTERCITY') || s.includes('IC ') || s.includes('ICN ')) return 'train-type-ic';
        if (s.includes('REGIONALE') || s.includes('REG ') || s.includes('RV ')) return 'train-type-reg';
        if (s.includes('EUROCITY') || s.includes('EC ') || s.includes('EURONIGHT') || s.includes('EN ')) return 'train-type-ec';
        return 'train-type-other';
    };

    // Helper per generare il badge del treno
    const getTrainBadge = (n) => {
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

        const typeClass = getTrainTypeClass(ident);
        const logoHtml = `<img src="/img/trenitalia.png" alt="Trenitalia" />`;

        if (num) {
             return `<button type="button" class="train-badge train-link ${typeClass}" data-num="${num}" title="Vedi stato treno ${num}">${logoHtml} ${ident}</button>`;
        }
        return `<span class="train-badge ${typeClass}">${logoHtml} ${ident}</span>`;
    };

    let trainsHtml = '';
    let segmentsHtml = '';

    if (vehicleList.length > 1) {
        // Vista dettagliata per cambi
        trainsHtml = `<span class="train-badge badge-summary">${vehicleList.length - 1} cambi</span>`;
        
        let innerSegments = '<div class="sol-segments">';
        vehicleList.forEach((node, idx) => {
            const badge = getTrainBadge(node);
            
            // Parsing sicuro delle date
            const formatTime = (d) => {
                if (!d) return '--:--';
                const date = new Date(d);
                return isNaN(date.getTime()) ? '--:--' : date.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
            };

            const dep = formatTime(node.departureTime);
            const arr = formatTime(node.arrivalTime);
            const origin = node.origin || node.startLocation || '';
            const dest = node.destination || node.endLocation || '';
            
            innerSegments += `
                <div class="sol-segment">
                    <div class="sol-segment-train">${badge}</div>
                    <div class="sol-segment-itinerary">
                        <div class="sol-itinerary-point">
                            <span class="sol-itinerary-time">${dep}</span>
                            <span class="sol-itinerary-station">${origin}</span>
                        </div>
                        <div class="sol-itinerary-connector"></div>
                        <div class="sol-itinerary-point">
                            <span class="sol-itinerary-time">${arr}</span>
                            <span class="sol-itinerary-station">${dest}</span>
                        </div>
                    </div>
                </div>
            `;
            
            if (idx < vehicleList.length - 1) {
                 const nextNode = vehicleList[idx+1];
                 const arrDate = new Date(node.arrivalTime);
                 const nextDepDate = new Date(nextNode.departureTime);
                 
                 if (!isNaN(arrDate.getTime()) && !isNaN(nextDepDate.getTime())) {
                     const diffMs = nextDepDate - arrDate;
                     const diffMins = Math.floor(diffMs / 60000);
                     innerSegments += `<div class="sol-transfer"><span class="transfer-icon">⇄</span> Cambio a ${dest} <span class="transfer-time">(${diffMins} min)</span></div>`;
                 } else {
                     innerSegments += `<div class="sol-transfer"><span class="transfer-icon">⇄</span> Cambio a ${dest}</div>`;
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
    } else {
        // Vista semplice (diretto)
        trainsHtml = vehicleList.map(getTrainBadge).join(' ');
    }

    // Prezzo
    let price = 'N/A';
    if (sol.price && sol.price.amount) price = sol.price.amount + '€';
    else if (item.price && item.price.amount) price = item.price.amount + '€';
    else if (sol.minPrice && sol.minPrice.amount) price = sol.minPrice.amount + '€';

    html += `
      <div class="solution-card">
        <div class="sol-header">
            <div class="sol-info">
                <div class="sol-times">
                  <div class="sol-time">${depTime}</div>
                  <div class="sol-arrow">→</div>
                  <div class="sol-time">${arrTime}</div>
                </div>
                <div class="sol-meta">
                    <div class="sol-duration">${duration}</div>
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
  
  html += '</div>';
  tripResults.innerHTML = html;
}

if (tripResults) {
  tripResults.addEventListener('click', (e) => {
    const btn = e.target.closest('.train-link');
    if (btn) {
      const num = btn.getAttribute('data-num');
      if (num) {
        if (trainNumberInput) trainNumberInput.value = num;
        cercaStatoTreno(num);
        scrollToSection(trainSearchSection);
      }
    }
  });
}

if (tripClearBtn) {
  tripClearBtn.addEventListener('click', () => {
    if (tripFromInput) tripFromInput.value = '';
    if (tripToInput) tripToInput.value = '';
    if (tripDateInput) tripDateInput.value = '';
    if (tripTimeInput) tripTimeInput.value = '';
    if (tripResults) tripResults.innerHTML = '';
    tripFromId = null;
    tripToId = null;
  });
}
