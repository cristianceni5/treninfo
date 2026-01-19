const fs = require('fs');
const path = require('path');

const DEFAULT_PATH = 'stazioni.json';
const DEFAULT_CONCURRENCY = 6;
const DEFAULT_DELAY_MS = 150;
const DEFAULT_MIN_SCORE = 2;

function parseArgs(argv) {
  const options = {
    file: DEFAULT_PATH,
    limit: Infinity,
    dryRun: false,
    concurrency: DEFAULT_CONCURRENCY,
    delayMs: DEFAULT_DELAY_MS,
    minScore: DEFAULT_MIN_SCORE,
    acceptSingle: true,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--file' && argv[i + 1]) {
      options.file = argv[i + 1];
      i += 1;
    } else if (arg === '--limit' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      options.limit = Number.isFinite(value) ? value : options.limit;
      i += 1;
    } else if (arg === '--concurrency' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      options.concurrency = Number.isFinite(value) && value > 0 ? value : options.concurrency;
      i += 1;
    } else if (arg === '--delay' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      options.delayMs = Number.isFinite(value) && value >= 0 ? value : options.delayMs;
      i += 1;
    } else if (arg === '--min-score' && argv[i + 1]) {
      const value = Number(argv[i + 1]);
      options.minScore = Number.isFinite(value) ? value : options.minScore;
      i += 1;
    } else if (arg === '--no-accept-single') {
      options.acceptSingle = false;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    }
  }

  return options;
}

function normalizeName(value) {
  const raw = value == null ? '' : String(value).trim();
  if (!raw) return '';
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{Letter}\p{Number}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeNameForMatch(value) {
  const normalized = normalizeName(value);
  if (!normalized) return '';
  const tokens = normalized.split(' ').filter((t) => t.length > 2);
  return tokens.join(' ');
}

function normalizeStationRecord(record) {
  const viaggiatrenoIdRaw = record.viaggiatrenoId ?? record.id;
  const nomeRaw = record.nome ?? record.name;
  const italoRaw = record.italoId ?? record.italoCode;
  const lefrecceRaw = record.lefrecceId != null ? Number(record.lefrecceId) : null;
  return {
    viaggiatrenoId:
      viaggiatrenoIdRaw != null && String(viaggiatrenoIdRaw).trim()
        ? String(viaggiatrenoIdRaw).trim().toUpperCase()
        : null,
    nome: nomeRaw != null && String(nomeRaw).trim() ? String(nomeRaw).trim() : null,
    regionId: record.regionId ?? null,
    lat: record.lat ?? null,
    lon: record.lon ?? null,
    lefrecceId: Number.isFinite(lefrecceRaw) ? lefrecceRaw : null,
    italoId:
      italoRaw != null && String(italoRaw).trim() ? String(italoRaw).trim().toUpperCase() : null,
    disuso: record.disuso === true,
  };
}

function scoreCandidate(targetNorm, candidateNorm) {
  if (!targetNorm || !candidateNorm) return 0;
  if (candidateNorm === targetNorm) return 4;
  if (candidateNorm.includes(targetNorm) || targetNorm.includes(candidateNorm)) return 3;

  const targetTokens = targetNorm.split(' ').filter(Boolean);
  const candidateTokens = new Set(candidateNorm.split(' ').filter(Boolean));
  if (!targetTokens.length || candidateTokens.size === 0) return 0;
  let hits = 0;
  for (const token of targetTokens) {
    if (candidateTokens.has(token)) hits += 1;
  }
  if (hits === targetTokens.length) return 2;
  if (hits / targetTokens.length >= 0.7) return 1;
  return 0;
}

function pickBestLocation(stationName, locations, minScore, acceptSingle) {
  if (!Array.isArray(locations) || locations.length === 0) return null;
  const targetNorm = normalizeNameForMatch(stationName);
  if (!targetNorm) return null;

  let best = null;
  for (const loc of locations) {
    const candidates = [loc?.name, loc?.displayName].filter(Boolean);
    for (const candidate of candidates) {
      const candidateNorm = normalizeName(candidate);
      const score = scoreCandidate(targetNorm, candidateNorm);
      if (!best || score > best.score || (score === best.score && candidateNorm.length < best.norm.length)) {
        best = {
          score,
          norm: candidateNorm,
          id: typeof loc.id === 'number' ? loc.id : Number(loc.id),
        };
      }
    }
  }

  if (!best || !Number.isFinite(best.id)) return null;
  if (best.score >= minScore) return best;
  if (acceptSingle && locations.length === 1 && best.score > 0) return best;
  return null;
}

function sleep(ms) {
  if (!ms) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchLefrecceLocations(name) {
  const params = new URLSearchParams({ name, limit: '10' });
  const url = `https://www.lefrecce.it/Channels.Website.BFF.WEB/website/locations/search?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: 'application/json, text/plain, */*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function buildQueryVariants(name) {
  const raw = name == null ? '' : String(name).trim();
  if (!raw) return [];
  const variants = new Set();
  variants.add(raw);

  const cleaned = raw.replace(/[.,']/g, ' ').replace(/\s+/g, ' ').trim();
  if (cleaned) variants.add(cleaned);

  const cleanedTokens = cleaned.split(' ').filter((t) => t.length > 2);
  if (cleanedTokens.length) variants.add(cleanedTokens.join(' '));

  const parts = raw.split(/[-/]/).map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    variants.add(part);
  }

  if (cleanedTokens.length >= 1) variants.add(cleanedTokens[0]);

  return Array.from(variants).filter(Boolean);
}

async function runWithConcurrency(items, limit, handler) {
  let index = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (true) {
      const current = index;
      index += 1;
      if (current >= items.length) return;
      await handler(items[current], current);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const filePath = path.resolve(process.cwd(), options.file);
  const raw = fs.readFileSync(filePath, 'utf8');
  const original = JSON.parse(raw);
  if (!Array.isArray(original)) {
    throw new Error('Formato non valido: atteso un array JSON.');
  }

  const normalized = original.map((s) => normalizeStationRecord(s));
  const targets = normalized.filter((s) => s && s.nome && s.lefrecceId == null);
  const limitedTargets =
    Number.isFinite(options.limit) && options.limit > 0 ? targets.slice(0, options.limit) : targets;

  const resolvedByName = new Map();
  const locationsByQuery = new Map();
  let processed = 0;
  let resolved = 0;
  let skipped = 0;
  let errors = 0;

  await runWithConcurrency(limitedTargets, options.concurrency, async (station) => {
    const key = normalizeName(station.nome);
    processed += 1;
    if (!key) {
      skipped += 1;
      return;
    }

    if (resolvedByName.has(key)) {
      const cached = resolvedByName.get(key);
      if (cached && Number.isFinite(cached.id)) {
        station.lefrecceId = cached.id;
        resolved += 1;
      }
      return;
    }

    try {
      const queries = buildQueryVariants(station.nome);
      let best = null;
      for (const query of queries) {
        let locations = locationsByQuery.get(query);
        if (!locations) {
          locations = await fetchLefrecceLocations(query);
          locationsByQuery.set(query, locations);
          await sleep(options.delayMs);
        }
        const candidate = pickBestLocation(station.nome, locations, options.minScore, options.acceptSingle);
        if (candidate && (!best || candidate.score > best.score)) {
          best = candidate;
        }
        if (best && best.score >= options.minScore) break;
      }

      resolvedByName.set(key, best);
      if (best && Number.isFinite(best.id)) {
        station.lefrecceId = best.id;
        resolved += 1;
      }
    } catch (err) {
      errors += 1;
      console.warn(`Errore LeFrecce per "${station.nome}":`, err.message);
    }

    if (processed % 100 === 0 || processed === limitedTargets.length) {
      console.log(
        `Avanzamento ${processed}/${limitedTargets.length} - risolti: ${resolved}, errori: ${errors}, saltati: ${skipped}`
      );
    }
  });

  const output = normalized.map((s) => ({
    viaggiatrenoId: s.viaggiatrenoId,
    nome: s.nome,
    regionId: s.regionId,
    lat: s.lat,
    lon: s.lon,
    lefrecceId: s.lefrecceId,
    italoId: s.italoId,
    disuso: s.disuso || (!s.lefrecceId && !s.italoId),
  }));

  if (options.dryRun) {
    console.log('Dry run completato.');
  } else {
    fs.writeFileSync(filePath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    console.log(`Aggiornato ${filePath}`);
  }

  console.log(`Totale target: ${targets.length}`);
  console.log(`Risolti: ${resolved}`);
  console.log(`Saltati: ${skipped}`);
  console.log(`Errori: ${errors}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
