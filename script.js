const API_BASE =
  window.location.hostname === 'localhost'
    ? 'http://localhost:3000'      // sviluppo locale con node server.js
    : '/.netlify/functions/api';   // in produzione su Netlify (funzione "api")

const RECENT_KEY = 'monitor_treno_recent';

// DOM ----------------------------------------------------------------

const stationQueryInput = document.getElementById('stationQuery');
const stationList = document.getElementById('stationList');
const stationSelected = document.getElementById('stationSelected');

const trainNumberInput = document.getElementById('trainNumber');
const trainSearchBtn = document.getElementById('trainSearchBtn');
const trainError = document.getElementById('trainError');
const trainResult = document.getElementById('trainResult');
const recentTrainsContainer = document.getElementById('recentTrains');

let selectedStation = null;

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

// AUTOCOMPLETE STAZIONI ----------------------------------------------

async function fetchStations(query) {
  const q = query.trim();
  if (q.length < 2) {
    stationList.innerHTML = '';
    stationList.hidden = true;
    return;
  }

  try {
    const res = await fetch(`${API_BASE}/api/stations/autocomplete?query=${encodeURIComponent(q)}`);
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
  stationSelected.innerHTML = '';
  debouncedFetchStations(e.target.value || '');
});

stationList.addEventListener('click', (e) => {
  const li = e.target.closest('li');
  if (!li) return;

  const name = li.getAttribute('data-name') || '';
  const code = li.getAttribute('data-code') || '';

  selectedStation = { name, code };

  stationQueryInput.value = name;
  stationList.innerHTML = '';
  stationList.hidden = true;

  stationSelected.innerHTML = `
    <span class='pill'>
      <span class='pill-label'>Stazione</span>
      <span class='pill-value'>${name}</span>
      <span class='soft'>(${code})</span>
    </span>
  `;
});

document.addEventListener('click', (e) => {
  if (e.target === stationQueryInput || stationList.contains(e.target)) return;
  stationList.innerHTML = '';
  stationList.hidden = true;
});

// RECENTI -------------------------------------------------------------

function loadRecentTrains() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
}

function saveRecentTrains(list) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch (err) {
    console.warn('Impossibile salvare i treni recenti:', err);
  }
}

function addRecentTrain(numero, origine, destinazione) {
  if (!numero) return;
  const list = loadRecentTrains();
  const numStr = String(numero);

  const filtered = list.filter(t => String(t.numero) !== numStr);

  filtered.unshift({
    numero: numStr,
    origine: origine || '',
    destinazione: destinazione || '',
  });

  const trimmed = filtered.slice(0, 5);
  saveRecentTrains(trimmed);
  renderRecentTrains(trimmed);
}

function renderRecentTrains(list) {
  if (!Array.isArray(list) || list.length === 0) {
    recentTrainsContainer.innerHTML = '';
    return;
  }

  const htmlParts = [];

  htmlParts.push('<div class="recent-header-row">');
  htmlParts.push('<span class="recent-header-title">Visti di recente</span>');
  htmlParts.push('<button type="button" class="recent-clear" title="Svuota elenco">Svuota</button>');
  htmlParts.push('</div>');

  htmlParts.push('<div class="recent-pills-row">');

  list.forEach((tr) => {
    const route = [tr.origine, tr.destinazione].filter(Boolean).join(' → ');
    htmlParts.push(
      `<div class="recent-pill" data-num="${tr.numero}">` +
      '<button type="button" class="recent-pill-main">' +
      `<span class="num">${tr.numero}</span>` +
      (route ? `<span class="route">${route}</span>` : '') +
      '</button>' +
      '<button type="button" class="recent-pill-remove" title="Rimuovi" aria-label="Rimuovi treno">&times;</button>' +
      '</div>'
    );
  });

  htmlParts.push('</div>');
  recentTrainsContainer.innerHTML = htmlParts.join('');
}

recentTrainsContainer.addEventListener('click', (e) => {
  const clearBtn = e.target.closest('.recent-clear');
  if (clearBtn) {
    saveRecentTrains([]);
    renderRecentTrains([]);
    return;
  }

  const removeBtn = e.target.closest('.recent-pill-remove');
  if (removeBtn) {
    const pill = removeBtn.closest('.recent-pill');
    if (!pill) return;
    const num = pill.getAttribute('data-num');
    const list = loadRecentTrains().filter(t => String(t.numero) !== String(num));
    saveRecentTrains(list);
    renderRecentTrains(list);
    return;
  }

  const mainBtn = e.target.closest('.recent-pill-main');
  if (mainBtn) {
    const pill = mainBtn.closest('.recent-pill');
    if (!pill) return;
    const n = pill.getAttribute('data-num');
    if (n) {
      trainNumberInput.value = n;
      cercaStatoTreno();
    }
  }
});

renderRecentTrains(loadRecentTrains());

// LOGICA STATO TRENO --------------------------------------------------

function getTrainKindInfo(d) {
  const rawType =
    (d.compNumeroTreno || '').toString().toUpperCase();

  if (!rawType) return { label: '', kindClass: '' };

  if (rawType.includes('FR')) {
    return { label: 'Frecciarossa AV', kindClass: 'train-title--fr' };
  }
  if (rawType.includes('FA')) {
    return { label: 'Frecciargento AV', kindClass: 'train-title--fr' };
  }
  if (rawType.includes('FB')) {
    return { label: 'Frecciabianca', kindClass: 'train-title--ic' };
  }
  if (rawType.includes('ICN')) {
    return { label: 'Intercity Notte', kindClass: 'train-title--ic' };
  }
  if (rawType.includes('IC')) {
    return { label: 'Intercity', kindClass: 'train-title--ic' };
  }
  if (rawType.includes('REG') || rawType.includes('R ')) {
    return { label: 'Regionale', kindClass: 'train-title--reg' };
  }

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
  const lastRealIdx = fermate.length > 0 ? getLastRealStopIndex(fermate) : -1;
  const lastDepartedIdx = fermate.length > 0 ? getLastDepartedStopIndex(fermate) : -1;
  const lastOperationalIdx = fermate.length > 0
    ? getLastOperationalStopIndex(journey, fermate, lastRealIdx, lastDepartedIdx)
    : -1;
  const primary = buildPrimaryStatus(d, journey, currentInfo);
  const globalDelay = getGlobalDelayMinutes(d);

  const last = fermate[fermate.length - 1];
  const first = fermate[0];

  const plannedDeparture = first
    ? formatTimeFlexible(first.partenza_teorica ?? first.partenzaTeorica ?? first.programmata)
    : '-';
  const plannedArrival = last
    ? formatTimeFlexible(last.arrivo_teorico ?? last.arrivoTeorico ?? last.programmata)
    : '-';

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
      ? `<div class='train-last'>
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

      return `
        <tr class="${rowClass}">
          <td class="col-idx" aria-label="Fermata ${idx + 1}">
            <span class="timeline-line ${timelineClasses}"${timelineStyleAttr}></span>
          </td>
          <td>
            <div class="st-name">${f.stazione || '-'}</div>
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

      return `
        <div class="stop-card ${rowClass}">
          <div class="stop-card-timeline">
            <div class="timeline-line stop-card-line ${timelineClasses}"${timelineStyleAttr}></div>
            <div class="stop-card-dot"></div>
          </div>
          <div class="stop-card-content">
            <div class="stop-card-header">
              <div class="stop-card-name">${stazioneName}</div>
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

    tableHtml = `
      <div class="stops-table-wrapper">
        <div class="stops-table-cards stops-table-cards--full">
          ${cardRows}
        </div>
      </div>
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
    .replace(/>/g, '&gt;');
}

// HANDLER RICERCA -----------------------------------------------------

async function cercaStatoTreno() {
  trainError.textContent = '';
  trainResult.innerHTML = '';

  const num = (trainNumberInput.value || '').trim();
  if (!num) {
    trainError.textContent = 'Inserisci un numero di treno.';
    return;
  }

  try {
    const res = await fetch(
      `${API_BASE}/api/trains/status?trainNumber=${encodeURIComponent(num)}`
    );

    if (!res.ok) {
      trainError.textContent = `Errore HTTP dal backend: ${res.status}`;
      return;
    }

    const data = await res.json();

    if (!data.ok) {
      trainError.textContent = data.error || 'Errore logico dal backend.';
      return;
    }

    if (!data.data) {
      trainResult.innerHTML = `<p class='muted'>${data.message || 'Nessun treno trovato.'}</p>`;
      return;
    }

    const dd = data.data;
    addRecentTrain(dd.numeroTreno || num, dd.origine, dd.destinazione);

    renderTrainStatus(data);
  } catch (err) {
    console.error('Errore fetch train status:', err);
    trainError.textContent = 'Errore di comunicazione con il backend locale.';
  }
}

trainSearchBtn.addEventListener('click', cercaStatoTreno);

trainNumberInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    cercaStatoTreno();
  }
});
