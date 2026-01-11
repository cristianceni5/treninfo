# Treninfo Server — Guida rapida

Questo progetto è un **backend** (Netlify Functions) che fa da “server unico” per la tua app:
- Legge i dati da **ViaggiaTreno (RFI)** e **LeFrecce**
- Li **normalizza** e restituisce JSON “puliti” (nomi stazione coerenti, campi pronti per UI)
- Non espone ID interni (codici stazione/lefrecceId) nelle risposte: l’app lavora solo con stringhe

## Avvio in locale

```bash
npm install
npm run dev
```

Poi apri:
- `http://localhost:8888/` (landing)
- `http://localhost:8888/test-rfi.html` (pagina test)

## Base URL

- Locale: `http://localhost:8888`
- Produzione: `https://treninfo.netlify.app`

Base path API: `/api`

## Endpoints principali (per app)

### 1) Autocomplete stazioni
`GET /api/viaggiatreno/autocomplete?query=...`

Risposta: array di **nomi stazione** (stringhe).

Esempio:
```bash
curl "http://localhost:8888/api/viaggiatreno/autocomplete?query=firen"
```

### 2) Info stazione (con coordinate)
`GET /api/stations/info?stationName=...`

Esempio:
```bash
curl "http://localhost:8888/api/stations/info?stationName=Firenze%20S.M.Novella"
```

### 3) Partenze / Arrivi
`GET /api/stations/departures?stationName=...&when=now`
`GET /api/stations/arrivals?stationName=...&when=now`

Esempio:
```bash
curl "http://localhost:8888/api/stations/departures?stationName=Firenze%20S.M.Novella"
```

### 4) Stato treno (dettaglio + fermate)
`GET /api/trains/status?trainNumber=...`

Se il numero è ambiguo, la risposta include `needsSelection: true` e una lista `choices` con `choice` (indice) + origine (nome). Per selezionare:
- `GET /api/trains/status?trainNumber=...&choice=0`
oppure
- `GET /api/trains/status?trainNumber=...&originName=...`

### 5) Soluzioni viaggio (LeFrecce)
`GET /api/solutions?fromName=...&toName=...&date=YYYY-MM-DD&time=HH:mm`

Esempio:
```bash
curl "http://localhost:8888/api/solutions?fromName=Firenze%20S.M.Novella&toName=Milano%20Centrale&date=2026-01-15&time=10:00"
```

## Note

- `stations-viaggiatreno.json` è il DB canonico usato dal backend per normalizzare i nomi stazione (non è esposto come file pubblico).
- Per abilitare output grezzo (solo per debug locale):
  - `ENABLE_RAW_UPSTREAM=1` per i `?raw=1`
  - `ENABLE_DEBUG_RAW=1` per i `?debug=1`

