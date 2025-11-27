const API_BASE = 'http://localhost:3000';
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

function computeJourneyState(d) {
  const fermate = Array.isArray(d.fermate) ? d.fermate : [];
  const now = Date.now();

  if (fermate.length === 0) {
    return { state: 'UNKNOWN', pastCount: 0, total: 0, minutesToDeparture: null };
  }

  const total = fermate.length;
  const first = fermate[0];
  const last = fermate[fermate.length - 1];

  const firstProg = parseToMillis(first.partenza_teorica ?? first.partenzaTeorica ?? first.programmata);
  const lastArrReal = parseToMillis(last.arrivoReale ?? last.effettiva);

  // <<< QUI la magia: tutte le fermate <= lastRealIdx sono considerate "fatte"
  const lastRealIdx = getLastRealStopIndex(fermate);
  const pastCount = lastRealIdx >= 0 ? lastRealIdx + 1 : 0;

  let state = 'UNKNOWN';
  let minutesToDeparture = null;

  if (pastCount === 0) {
    if (firstProg && firstProg > now) {
      state = 'PLANNED';
      minutesToDeparture = Math.round((firstProg - now) / 60000);
    } else {
      state = 'PLANNED';
    }
  } else if (pastCount >= total && lastArrReal) {
    // corsa conclusa solo se l'ultima ha effettivi (come prima)
    state = 'COMPLETED';
  } else {
    state = 'RUNNING';
  }

  return { state, pastCount, total, minutesToDeparture };
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
  if (typeof d.ritardo === 'number') return d.ritardo;
  if (Array.isArray(d.compRitardo)) {
    const txt = d.compRitardo[0] || '';
    const match = txt.match(/(\d+)\s*min/);
    if (match) return Number(match[1]);
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

function buildPrimaryStatus(d, journey, currentInfo) {
  const origin = d.origine || '';
  const destination = d.destinazione || '';
  const kindInfo = getTrainKindInfo(d);
  const globalDelay = getGlobalDelayMinutes(d);

  let title = '';
  if (kindInfo.label) title = `${kindInfo.label} ${d.numeroTreno || ''}`.trim();
  else title = `Treno ${d.numeroTreno || ''}`.trim();

  let subtitle = '';
  if (origin || destination) subtitle = `${origin || '?'} → ${destination || '?'}`;

  let mainLine = '';
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
        const next = fermate[currentIndex + 1];
        if (next) {
          mainLine = `Il treno è in viaggio tra ${name} e ${next.stazione || 'stazione successiva'}.`;
        } else {
          mainLine = `Il treno è in prossimità di ${name}.`;
        }
      } else {
        mainLine = 'Il treno è in viaggio.';
      }
      break;
    }
    case 'COMPLETED':
      mainLine = 'Il treno ha terminato la corsa.';
      break;
    default:
      mainLine = 'Lo stato del treno non è chiaro.';
  }

  let delayLine = '';
  let delaySubLine = '';
  if (globalDelay != null) {
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
    const rawMotivo =
      d.compVariazionePercorso ||   // se hai un campo così nel JSON
      d.compMotivoRitardo ||
      d.subTitle ||
      '';

    if (rawMotivo && String(rawMotivo).trim() !== '') {
      delaySubLine = String(rawMotivo).trim();
    }

    delayLine = `<span class="delay-chip ${chipClass}">${label}</span>`;
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
  const primary = buildPrimaryStatus(d, journey, currentInfo);
  const fermate = Array.isArray(d.fermate) ? d.fermate : [];
  const globalDelay = getGlobalDelayMinutes(d);

  const last = fermate[fermate.length - 1];
  const first = fermate[0];

  const plannedDeparture = first
    ? formatTimeFlexible(first.partenza_teorica ?? first.partenzaTeorica ?? first.programmata)
    : '-';
  const plannedArrival = last
    ? formatTimeFlexible(last.arrivo_teorico ?? last.arrivoTeorico ?? last.programmata)
    : '-';

  const badgeStateClass =
    journey.state === 'PLANNED' ? 'planned' :
      journey.state === 'RUNNING' ? 'running' :
        journey.state === 'COMPLETED' ? 'completed' :
          'unknown';

  const completionChip = getCompletionChip(d, journey, globalDelay);

  const headerHtml = `
    <div class='train-header'>
      <div class='train-main'>
        <div class='train-title-row'>
          <img src='/img/trenitalia.png' alt='Logo Trenitalia' class='train-logo' />
          <h2 class='train-title ${primary.kindClass || ''}'>${primary.title || 'Dettagli treno'}</h2>
          <span class='badge-status badge-status-${badgeStateClass}'>
            ${journey.state === 'PLANNED' ? 'Pianificato' :
      journey.state === 'RUNNING' ? 'In viaggio' :
        journey.state === 'COMPLETED' ? 'Concluso' :
          'Sconosciuto'}
          </span>
        </div>
        <div class='train-route'>
          <span class='route-main'>${primary.subtitle}</span>
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
  const positionText =
    journey.total > 0
      ? `Fermata ${currentIndex + 1} di ${journey.total}`
      : '';

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
    const lastRealIdx = getLastRealStopIndex(fermate);

    const rows = fermate.map((f, idx) => {
      const isCurrent = currentInfo.currentIndex === idx;

      const arrProgRaw = f.arrivo_teorico ?? f.arrivoTeorico ?? f.programmata;
      const depProgRaw = f.partenza_teorica ?? f.partenzaTeorica ?? f.programmata;

      const hasRealArrival = f.arrivoReale != null || f.effettiva != null;
      const hasRealDeparture = f.partenzaReale != null;

      const arrRealRaw = f.arrivoReale ?? f.effettiva ?? null;
      const depRealRaw = f.partenzaReale ?? null;

      // previsti dal backend (se esistono)
      let arrPredRaw = !hasRealArrival ? (f.arrivoPrevista ?? null) : null;
      let depPredRaw = !hasRealDeparture ? (f.partenzaPrevista ?? null) : null;

      // se non ci sono previsti ma il treno è in viaggio e ha un ritardo globale,
      // li calcoliamo come programmato + ritardo globale
      if (
        journey.state === 'RUNNING' &&
        globalDelay != null &&
        globalDelay !== 0 &&
        !hasRealArrival &&
        arrProgRaw &&
        idx >= currentIndex
      ) {
        const baseMs = parseToMillis(arrProgRaw);
        if (baseMs != null) arrPredRaw = baseMs + globalDelay * 60000;
      }
      if (
        journey.state === 'RUNNING' &&
        globalDelay != null &&
        globalDelay !== 0 &&
        !hasRealDeparture &&
        depProgRaw &&
        idx >= currentIndex
      ) {
        const baseMs2 = parseToMillis(depProgRaw);
        if (baseMs2 != null) depPredRaw = baseMs2 + globalDelay * 60000;
      }

      const arrProg = arrProgRaw ? formatTimeFlexible(arrProgRaw) : '-';
      const depProg = depProgRaw ? formatTimeFlexible(depProgRaw) : '-';

      const arrProgHH = hhmmFromRaw(arrProgRaw);
      const depProgHH = hhmmFromRaw(depProgRaw);
      const arrRealHH = hhmmFromRaw(arrRealRaw);
      const depRealHH = hhmmFromRaw(depRealRaw);

      const ritArr = typeof f.ritardoArrivo === 'number' ? f.ritardoArrivo : globalDelay;
      const ritDep = typeof f.ritardoPartenza === 'number' ? f.ritardoPartenza : globalDelay;

      const bin =
        f.binarioEffettivoArrivoDescrizione ||
        f.binarioEffettivoPartenzaDescrizione ||
        f.binarioProgrammatoArrivoDescrizione ||
        f.binarioProgrammatoPartenzaDescrizione ||
        '';

      // stato riga (passato / corrente / futuro)
      let rowClass = '';
      if (isCurrent) {
        rowClass = 'stop-current';
      } else if (lastRealIdx >= 0 && idx <= lastRealIdx) {
        // tutte le fermate fino all'ultima con effettivi → passate
        rowClass = 'stop-past';
      } else {
        rowClass = 'stop-future';
      }


      // effettivi: verde solo se HHmm coincide con il programmato
      let arrivalEffClass = '';
      if (hasRealArrival && arrRealRaw) {
        if (arrProgHH && arrRealHH && arrProgHH === arrRealHH) {
          arrivalEffClass = 'delay-ok';
        } else if (ritArr != null) {
          if (ritArr < 0) arrivalEffClass = 'delay-early';
          else arrivalEffClass = 'delay-mid';
        }
      }

      let departEffClass = '';
      if (hasRealDeparture && depRealRaw) {
        if (depProgHH && depRealHH && depProgHH === depRealHH) {
          departEffClass = 'delay-ok';
        } else if (ritDep != null) {
          if (ritDep < 0) departEffClass = 'delay-early';
          else departEffClass = 'delay-mid';
        }
      }

      // ARRIVO: riga effettivo / previsto
      let arrivalLine = '';
      if (hasRealArrival && arrRealRaw) {
        // effettivo (verde / arancio scuro / azzurro)
        arrivalLine = `<span class="time-actual ${arrivalEffClass}">${formatTimeFlexible(arrRealRaw)}</span>`;
      } else if (
        journey.state === 'RUNNING' &&
        arrPredRaw != null &&
        ritArr != null &&
        ritArr !== 0 &&
        idx >= currentIndex
      ) {
        // previsto (giallo / azzurrino chiaro)
        const forecastClass = ritArr > 0 ? 'forecast-late' : 'forecast-early';
        arrivalLine = `<span class="time-actual ${forecastClass}">${formatTimeFlexible(arrPredRaw)}</span>`;
      }

      // PARTENZA: riga effettivo / previsto
      let departLine = '';
      if (hasRealDeparture && depRealRaw) {
        departLine = `<span class="time-actual ${departEffClass}">${formatTimeFlexible(depRealRaw)}</span>`;
      } else if (
        journey.state === 'RUNNING' &&
        depPredRaw != null &&
        ritDep != null &&
        ritDep !== 0 &&
        idx >= currentIndex
      ) {
        const forecastClass = ritDep > 0 ? 'forecast-late' : 'forecast-early';
        departLine = `<span class="time-actual ${forecastClass}">${formatTimeFlexible(depPredRaw)}</span>`;
      }

      return `
        <tr class="${rowClass}">
          <td class="col-idx" aria-label="Fermata ${idx + 1}"></td>
          <td>
            <div class="st-name">${f.stazione || '-'}</div>
          </td>
          <td>
            <div class="time-block">
              <span class="time-scheduled">${arrProg}</span>
              ${arrivalLine}
            </div>
          </td>
          <td>
            <div class="time-block">
              <span class="time-scheduled">${depProg}</span>
              ${departLine}
            </div>
          </td>
          <td class="col-track">
            ${bin
          ? `<span class="col-track-pill">${bin}</span>`
          : '<span class="soft"></span>'
        }
          </td>
        </tr>
      `;
    }).join('');

    tableHtml = `
      <div class="stops-table-wrapper">
        <table class="stops-table">
          <thead>
            <tr>
              <th aria-label="Progressione"></th>
              <th>Stazione</th>
              <th>Arrivo</th>
              <th>Partenza</th>
              <th>Binario</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
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
