# Treninfo API

Base path: `/api`

Queste API sono esposte da Netlify Functions (in locale via `netlify dev`, in produzione via redirect Netlify).

## Convenzioni

- Risposte JSON con campo `ok`.
- Errori: `ok: false` + `error`.

## Endpoints

### Autocomplete stazioni (ViaggiaTreno)

`GET /api/viaggiatreno/autocomplete?query=FIREN`

- `query` (string, min 2)

Risposta:
- `ok: true`
- `data: Array<{ name: string, code: string }>`

### Autocomplete stazioni (LeFrecce)

`GET /api/lefrecce/autocomplete?query=Roma`

- `query` (string, min 2)

Risposta:
- `ok: true`
- `data: Array<{ name: string, id: number|string }>`

### Soluzioni di viaggio (LeFrecce)

`GET /api/solutions?date=YYYY-MM-DD&time=HH:mm&fromId=...&toId=...`

Parametri principali:
- `date` (obbligatorio) `YYYY-MM-DD`
- `time` (opzionale) `HH:mm`
- `fromId` / `toId` (locationId LeFrecce)
- in alternativa: `fromName` / `toName` (verranno risolti in `locationId`)

Risposta:
- `ok: boolean`
- `solutions: array`
- `minimumPrices: object|null`

### Info stazione + meteo (ViaggiaTreno)

`GET /api/stations/info?stationCode=S06904`

Risposta:
- `ok: boolean`
- `stationCode: string`
- `regionId: string`
- `station: object`
- `meteo: object|null`

### Partenze

`GET /api/stations/departures?stationCode=S06904&when=now`

- `when`: `now` oppure una data parseable da JS (es. `2025-12-14T12:30:00`)

Risposta:
- `ok: boolean`
- `data: array`

### Arrivi

`GET /api/stations/arrivals?stationCode=S06904&when=now`

Risposta:
- `ok: boolean`
- `data: array`

### Stato treno

`GET /api/trains/status?trainNumber=1959`

Risposta:
- `ok: boolean`
- `originCode: string`
- `referenceTimestamp: number`
- `data: object|null`

## CORS

Per consumare le API da un frontend separato (es. React su `http://localhost:5173`), puoi configurare:

- `CORS_ORIGINS="http://localhost:5173,http://localhost:8888"`

Opzionale:
- `FETCH_TIMEOUT_MS=12000`
