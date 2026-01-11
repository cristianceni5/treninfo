#!/usr/bin/env node
/**
 * Merge di `old/stations.json` dentro `stations-viaggiatreno.json`.
 * Priorità ai dati "vecchi" per name/lefrecceId/coords quando matchano per id o per nome.
 */

const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NEW_PATH = path.join(ROOT, 'stations-viaggiatreno.json');
const OLD_PATH = path.join(ROOT, 'old', 'stations.json');

function normalizeNameKey(value) {
  const raw = value == null ? '' : String(value);
  if (!raw) return '';
  return raw
    .normalize('NFKD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[()]/g, ' ')
    .replace(/[.']/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toId(value) {
  const s = value == null ? '' : String(value).trim().toUpperCase();
  return s || null;
}

function toNumOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toRegionId(value) {
  const v = value == null ? '' : String(value).trim();
  return v ? v : null;
}

function toStringOrNull(value) {
  const v = value == null ? '' : String(value).trim();
  return v ? v : null;
}

function canonicalize(entry, fallbackId = null) {
  const id = toId(entry?.id) || fallbackId;
  const name = toStringOrNull(entry?.name);
  const regionId = toRegionId(entry?.regionId ?? entry?.region);
  const lat = entry?.lat != null ? toNumOrNull(entry.lat) : null;
  const lon = entry?.lon != null ? toNumOrNull(entry.lon) : null;
  const lefrecceId = entry?.lefrecceId != null ? toNumOrNull(entry.lefrecceId) : null;

  return {
    id,
    name,
    regionId,
    lat,
    lon,
    lefrecceId,
  };
}

async function main() {
  const [newRaw, oldRaw] = await Promise.all([fs.readFile(NEW_PATH, 'utf8'), fs.readFile(OLD_PATH, 'utf8')]);
  const newList = JSON.parse(newRaw);
  const oldList = JSON.parse(oldRaw);

  if (!Array.isArray(newList)) throw new Error('stations-viaggiatreno.json non è un array');
  if (!Array.isArray(oldList)) throw new Error('old/stations.json non è un array');

  const outById = new Map();
  const newIdByNameKey = new Map();

  // seed con il "nuovo"
  for (const entry of newList) {
    const c = canonicalize(entry);
    if (!c.id) continue;
    outById.set(c.id, c);

    const k = normalizeNameKey(c.name);
    if (k && !newIdByNameKey.has(k)) newIdByNameKey.set(k, c.id);
  }

  let mergedById = 0;
  let mergedByName = 0;
  let appended = 0;

  for (const oldEntry of oldList) {
    const oldC = canonicalize(oldEntry);
    if (!oldC.id && !oldC.name) continue;

    let targetId = null;
    if (oldC.id && outById.has(oldC.id)) {
      targetId = oldC.id;
      mergedById += 1;
    } else {
      const k = normalizeNameKey(oldC.name);
      const byName = k ? newIdByNameKey.get(k) : null;
      if (byName && outById.has(byName)) {
        targetId = byName;
        mergedByName += 1;
      }
    }

    if (!targetId) {
      // append (mantieni l'id originale vecchio)
      if (!oldC.id) continue;
      if (!outById.has(oldC.id)) {
        outById.set(oldC.id, oldC);
        appended += 1;
      }
      continue;
    }

    const cur = outById.get(targetId) || { id: targetId };
    const merged = {
      id: targetId,
      // name: preferisci old se presente
      name: oldC.name || cur.name || null,
      // regionId: preferisci cur (nuovo) se presente, fallback old
      regionId: cur.regionId || oldC.regionId || null,
      // coords: preferisci old se presenti, fallback cur
      lat: oldC.lat != null ? oldC.lat : cur.lat ?? null,
      lon: oldC.lon != null ? oldC.lon : cur.lon ?? null,
      // lefrecceId: preferisci old se presente, fallback cur
      lefrecceId: oldC.lefrecceId != null ? oldC.lefrecceId : cur.lefrecceId ?? null,
    };

    outById.set(targetId, merged);
  }

  const out = Array.from(outById.values())
    .filter((s) => s && s.id)
    .sort((a, b) => {
      const an = a.name || '';
      const bn = b.name || '';
      const c = an.localeCompare(bn, 'it');
      if (c !== 0) return c;
      return String(a.id).localeCompare(String(b.id));
    });

  await fs.writeFile(NEW_PATH, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(
    `OK: scritto ${path.relative(process.cwd(), NEW_PATH)} (${out.length} stazioni). mergeById=${mergedById}, mergeByName=${mergedByName}, appended=${appended}`
  );
}

main().catch((err) => {
  console.error('Errore:', err.message);
  process.exit(1);
});

