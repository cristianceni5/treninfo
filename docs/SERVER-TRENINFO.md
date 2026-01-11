# Treninfo Server — Guida rapida

Questo progetto è un backend (Netlify Functions) che espone un’unica API (`/api`) con JSON già normalizzati per la tua app.

Questa guida descrive **solo** come usare Treninfo.

## Avvio in locale

```bash
npm install
npm run dev
```

Apri:
- `http://localhost:8888/`
- `http://localhost:8888/test-rfi.html`

## Endpoint rapidi (solo Treninfo)

```bash
curl "https://treninfo.netlify.app/api/stations/autocomplete?query=firen"
curl "https://treninfo.netlify.app/api/stations/info?stationName=Firenze%20S.M.Novella"
curl "https://treninfo.netlify.app/api/stations/departures?stationName=Firenze%20S.M.Novella&when=now"
curl "https://treninfo.netlify.app/api/trains/status?trainNumber=9544"
curl "https://treninfo.netlify.app/api/solutions?fromName=Firenze%20S.M.Novella&toName=Milano%20Centrale&date=2026-01-15&time=10:00"
```

## Note

- Le stazioni nelle risposte sono **stringhe** (nomi canonici), non codici/ID.
- Pagina test: `https://treninfo.netlify.app/test-rfi.html`

