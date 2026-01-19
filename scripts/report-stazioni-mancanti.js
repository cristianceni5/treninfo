const fs = require('fs');
const path = require('path');

const inputPath = path.resolve(process.cwd(), process.argv[2] || 'stazioni.json');
const outputPath = path.resolve(process.cwd(), process.argv[3] || 'stazioni-mancanti-lefrecce.csv');

function toCsvValue(value) {
  if (value == null) return '';
  const raw = String(value);
  if (/[",\n]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

const raw = fs.readFileSync(inputPath, 'utf8');
const data = JSON.parse(raw);

if (!Array.isArray(data)) {
  console.error('Formato non valido: atteso un array JSON.');
  process.exitCode = 1;
} else {
  const rows = [['viaggiatrenoId', 'nome', 'regionId', 'lat', 'lon', 'italoId', 'lefrecceId']];
  for (const s of data) {
    if (s && s.lefrecceId == null) {
      rows.push([
        s.viaggiatrenoId ?? s.id ?? '',
        s.nome ?? s.name ?? '',
        s.regionId ?? '',
        s.lat ?? '',
        s.lon ?? '',
        s.italoId ?? s.italoCode ?? '',
        s.lefrecceId ?? '',
      ]);
    }
  }
  const csv = rows.map((row) => row.map(toCsvValue).join(',')).join('\n');
  fs.writeFileSync(outputPath, `${csv}\n`, 'utf8');
  console.log(`Creato ${outputPath} (${rows.length - 1} righe).`);
}
