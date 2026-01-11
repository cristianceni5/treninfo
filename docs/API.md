# Treninfo — Documentazione API

Questa API serve a fornire alla tua app dei JSON **coerenti e pronti per l’uso** (normalizzazione stazioni, categorie treno, campi già calcolati).

Gli esempi qui sotto mostrano **solo chiamate a Treninfo**.

## Base URL

`https://treninfo.netlify.app`

Base path: `/api`

## Convenzioni

- Risposta standard:
  - `ok: true` → richiesta completata
  - `ok: false` → errore con campo `error`
- Stazioni nelle risposte: **stringhe** (nome canonico). Non vengono esposti codici/ID interni.

## Endpoints

### 1) Autocomplete stazioni (consigliato)

`GET /api/stations/autocomplete?query=...`

Esempio:
```bash
curl "https://treninfo.netlify.app/api/stations/autocomplete?query=firen"
```

Risposta (esempio):
```json
{ "ok": true, "data": ["Firenze S.M.Novella", "Firenze Campo Marte"] }
```

### 2) Info stazione

`GET /api/stations/info?stationName=...`

Esempio:
```bash
curl "https://treninfo.netlify.app/api/stations/info?stationName=Firenze%20S.M.Novella"
```

Risposta (esempio):
```json
{
  "ok": true,
  "stazione": "Firenze S.M.Novella",
  "latitudine": 43.776893,
  "longitudine": 11.247373,
  "regione": "13",
  "meteo": null
}
```

### 3) Partenze stazione

`GET /api/stations/departures?stationName=...&when=now`

Esempio:
```bash
curl "https://treninfo.netlify.app/api/stations/departures?stationName=Firenze%20S.M.Novella&when=now"
```

### 4) Arrivi stazione

`GET /api/stations/arrivals?stationName=...&when=now`

Esempio:
```bash
curl "https://treninfo.netlify.app/api/stations/arrivals?stationName=Firenze%20S.M.Novella&when=now"
```

### 5) Stato treno

`GET /api/trains/status?trainNumber=...`

Esempio:
```bash
curl "https://treninfo.netlify.app/api/trains/status?trainNumber=9544"
```

Se il numero è ambiguo:
```json
{
  "ok": true,
  "data": null,
  "needsSelection": true,
  "choices": [
    { "choice": 0, "origine": "Salerno" },
    { "choice": 1, "origine": "Roma Termini" }
  ]
}
```

Selezione:
```bash
curl "https://treninfo.netlify.app/api/trains/status?trainNumber=9544&choice=0"
```

Campi aggiuntivi (principali):
```json
{
  "principali": {
    "stato": "programmato",
    "prossimaFermata": { "indice": 3, "stazione": "Pisa Centrale", "arrivo": "23:17", "partenza": "23:20" }
  }
}
```

### 6) Soluzioni viaggio

`GET /api/solutions?fromName=...&toName=...&date=YYYY-MM-DD&time=HH:mm`

Esempio:
```bash
curl "https://treninfo.netlify.app/api/solutions?fromName=Firenze%20S.M.Novella&toName=Milano%20Centrale&date=2026-01-15&time=10:00"
```

## Debug (solo per sviluppo)

- `GET /api/health` → verifica caricamento DB stazioni (`stationDb.count`)
