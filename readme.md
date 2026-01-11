# Treninfo Server

Server (Netlify Functions) che espone una API **semplice e coerente** per la tua app, con risposte JSON già normalizzate.

Questa documentazione descrive **solo l’uso di Treninfo** (non come chiamare servizi esterni).

## URL

- Produzione: `https://treninfo.netlify.app`
- Locale (Netlify Dev): `http://localhost:8888`

## Avvio in locale

```bash
npm install
npm run dev
```

Pagine utili:
- `http://localhost:8888/` (home)
- `http://localhost:8888/test-rfi.html` (pagina test chiamate)

## Documentazione

- API (unificata): `docs/API.md`
- Guida rapida: `docs/SERVER-TRENINFO.md`

## Esempi (solo Treninfo)

```bash
curl "https://treninfo.netlify.app/api/stations/autocomplete?query=firen"
curl "https://treninfo.netlify.app/api/stations/info?stationName=Firenze%20S.M.Novella"
curl "https://treninfo.netlify.app/api/stations/departures?stationName=Firenze%20S.M.Novella&when=now"
curl "https://treninfo.netlify.app/api/trains/status?trainNumber=9544"
curl "https://treninfo.netlify.app/api/solutions?fromName=Firenze%20S.M.Novella&toName=Milano%20Centrale&date=2026-01-15&time=10:00"
```

## Note

- Nelle risposte, le stazioni sono **stringhe** (nomi canonici). Non vengono esposti codici/ID interni.
- Usa `CORS_ORIGINS` per limitare i domini autorizzati (opzionale).
