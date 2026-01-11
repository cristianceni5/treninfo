#!/usr/bin/env node
// Test rapido per resolveTrainKind - verifica sigle FR, FA, FB, IC, REG

const TRAIN_KIND_RULES = [
  {
    matches: ['FRECCIAROSSA', 'FRECCIAROSSA AV', 'FRECCIAROSSAAV', 'FR', 'FR AV', 'FRAV', 'FR EC', 'FRECCIAROSSA EC'],
    boardLabel: 'FR',
    detailLabel: 'FR',
    category: 'high-speed',
  },
  {
    matches: ['FRECCIARGENTO', 'FRECCIARGENTO AV', 'FRECCIARGENTOAV', 'FA', 'FA AV'],
    boardLabel: 'FA',
    detailLabel: 'FA',
    category: 'high-speed',
  },
  {
    matches: ['FRECCIABIANCA', 'FB'],
    boardLabel: 'FB',
    detailLabel: 'FB',
    category: 'intercity',
  },
  {
    matches: ['INTERCITY NOTTE', 'INTERCITYNOTTE', 'ICN'],
    boardLabel: 'ICN',
    detailLabel: 'ICN',
    category: 'intercity',
  },
  {
    matches: ['INTERCITY', 'IC'],
    boardLabel: 'IC',
    detailLabel: 'IC',
    category: 'intercity',
  },
  {
    matches: ['REGIONALE', 'REG'],
    boardLabel: 'REG',
    detailLabel: 'REG',
    category: 'regional',
  },
  {
    matches: ['R'],
    boardLabel: 'R',
    detailLabel: 'R',
    category: 'regional',
  },
];

function resolveTrainKind(...rawValues) {
  for (const raw of rawValues) {
    if (!raw) continue;
    const normalized = String(raw)
      .trim()
      .toUpperCase()
      .replace(/\s+/g, ' ');

    // Prima estrai la sigla iniziale (es. " FR 9544" → "FR", "REG 12345" → "REG")
    const prefixMatch = normalized.match(/^([A-Z]{1,4})\b/);
    const prefix = prefixMatch ? prefixMatch[1] : '';
    
    // Cerca prima usando la sigla estratta (più preciso)
    if (prefix) {
      for (const rule of TRAIN_KIND_RULES) {
        if (rule.matches.includes(prefix)) {
          return {
            code: rule.boardLabel,
            label: rule.detailLabel,
            category: rule.category,
          };
        }
      }
    }

    // Altrimenti cerca nella stringa completa (match esatto, non substring)
    for (const rule of TRAIN_KIND_RULES) {
      if (rule.matches.includes(normalized)) {
        return {
          code: rule.boardLabel,
          label: rule.detailLabel,
          category: rule.category,
        };
      }
    }
  }
  return { code: 'UNK', label: 'Sconosciuto', category: 'unknown' };
}

console.log('\n🧪 Test resolveTrainKind (solo sigle FR, FA, FB, IC, REG):\n');

const tests = [
  // categoriaDescrizione (priorità 1)
  { input: ' FR', expected: 'FR', desc: 'categoriaDescrizione " FR"' },
  { input: ' FA', expected: 'FA', desc: 'categoriaDescrizione " FA"' },
  { input: ' FB', expected: 'FB', desc: 'categoriaDescrizione " FB"' },
  { input: ' IC', expected: 'IC', desc: 'categoriaDescrizione " IC"' },
  { input: ' ICN', expected: 'ICN', desc: 'categoriaDescrizione " ICN"' },
  
  // categoria (priorità 2)
  { input: 'FRECCIAROSSA', expected: 'FR', desc: 'categoria "FRECCIAROSSA"' },
  { input: 'FRECCIARGENTO', expected: 'FA', desc: 'categoria "FRECCIARGENTO"' },
  { input: 'FRECCIABIANCA', expected: 'FB', desc: 'categoria "FRECCIABIANCA"' },
  { input: 'INTERCITY', expected: 'IC', desc: 'categoria "INTERCITY"' },
  { input: 'REGIONALE', expected: 'REG', desc: 'categoria "REGIONALE"' },
  
  // compNumeroTreno (priorità 4, solo come fallback)
  { input: 'FR 9544', expected: 'FR', desc: 'compNumeroTreno "FR 9544"' },
  { input: 'REG 12345', expected: 'REG', desc: 'compNumeroTreno "REG 12345"' },
  { input: 'IC 673', expected: 'IC', desc: 'compNumeroTreno "IC 673"' },
  { input: 'R 2345', expected: 'R', desc: 'compNumeroTreno "R 2345"' },
];

let passed = 0;
for (const test of tests) {
  const result = resolveTrainKind(test.input);
  const match = result.code === test.expected;
  console.log(`${match ? '✅' : '❌'} ${test.desc}: "${test.input}" → ${result.code} (expected: ${test.expected})`);
  if (match) passed++;
}

console.log(`\n📊 Risultato: ${passed}/${tests.length} test passati\n`);

if (passed !== tests.length) {
  console.log('❌ Alcuni test falliti!\n');
  process.exit(1);
}

console.log('✅ Tutti i test passati!\n');
process.exit(0);
