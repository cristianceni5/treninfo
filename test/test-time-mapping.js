#!/usr/bin/env node
const assert = require('assert');

const app = require('../src/app');
const { mapDepartureEntry, mapArrivalEntry } = app.locals.__internals || {};

assert.strictEqual(typeof mapDepartureEntry, 'function', 'mapDepartureEntry non disponibile (internals mancanti)');
assert.strictEqual(typeof mapArrivalEntry, 'function', 'mapArrivalEntry non disponibile (internals mancanti)');

// Caso reale VT (Pisa Centrale, IC 685): partenzaTreno = capolinea, orarioPartenza = evento stazione
const depEntry = {
  numeroTreno: 685,
  categoria: 'IC',
  compNumeroTreno: 'IC 685',
  partenzaTreno: 1768157040000, // 19:44 (capolinea origine)
  orarioPartenza: 1768170000000, // 23:20 (stazione richiesta)
};

const depMapped = mapDepartureEntry(depEntry);
assert.strictEqual(depMapped.orarioPartenza, depEntry.orarioPartenza, 'La partenza deve usare orarioPartenza (stazione)');

// Simmetrico per arrivi: arrivoTreno può riferirsi al capolinea, orarioArrivo alla stazione
const arrEntry = {
  numeroTreno: 685,
  categoria: 'IC',
  compNumeroTreno: 'IC 685',
  arrivoTreno: 1768179999000,
  orarioArrivo: 1768169820000,
};

const arrMapped = mapArrivalEntry(arrEntry);
assert.strictEqual(arrMapped.orarioArrivo, arrEntry.orarioArrivo, 'L’arrivo deve usare orarioArrivo (stazione)');

console.log('✅ Test mapping orari VT: OK');
