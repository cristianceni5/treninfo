# Treninfo Server — API

Backend (Netlify Functions) che normalizza i dati di **ViaggiaTreno (RFI)** e **LeFrecce** e restituisce JSON pronti per app.

## Base URL

- Locale: `http://localhost:8888`
- Produzione: `https://treninfo.netlify.app`

Base path: `/api`

## Convenzioni

- Tutte le risposte sono JSON e includono `ok`:
  - `ok: true` → richiesta completata
  - `ok: false` → errore con campo `error`
- Le **stazioni** nelle risposte sono **stringhe** (nome canonico). Non vengono esposti codici stazione (Sxxxxx) o `lefrecceId`.
- Per debug locale (disabilitati di default):
  - `ENABLE_RAW_UPSTREAM=1` abilita `?raw=1` su alcuni endpoint
  - `ENABLE_DEBUG_RAW=1` abilita `?debug=1` su `/api/trains/status`

## Endpoints

### Autocomplete stazioni (ViaggiaTreno)

`GET /api/viaggiatreno/autocomplete?query=...`

Parametri:
- `query` (string, min 2) testo da cercare

Esempio:
```bash
curl "http://localhost:8888/api/viaggiatreno/autocomplete?query=firen"
```

Risposta:
```json
{ "ok": true, "data": ["Firenze S.M.Novella", "Firenze Campo Marte"] }
```

### Info stazione (coordinate + meteo)

`GET /api/stations/info?stationName=...`

Parametri:
- `stationName` (string) nome stazione (consigliato per app)
- `stationCode` (string) codice RFI Sxxxxx (accettato come fallback)

Esempio:
```bash
curl "http://localhost:8888/api/stations/info?stationName=Firenze%20S.M.Novella"
```

Risposta:
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

### Partenze

`GET /api/stations/departures?stationName=...&when=now`

Parametri:
- `stationName` (string) nome stazione (consigliato)
- `stationCode` (string) codice RFI Sxxxxx (fallback)
- `when` (string, opzionale) `now` oppure ISO date (default `now`)

Esempio:
```bash
curl "http://localhost:8888/api/stations/departures?stationName=Firenze%20S.M.Novella&when=now"
```

Risposta (estratto):
```json
{
  "ok": true,
  "stazione": "Firenze S.M.Novella",
  "data": "2026-01-07T18:30:00.000Z",
  "treni": [
    {
      "numeroTreno": 9544,
      "categoria": "FR",
      "origine": "Salerno",
      "destinazione": "Milano Centrale",
      "orarioPartenza": 1767801300000,
      "orarioPartenzaLeggibile": "16:55",
      "ritardo": 10,
      "binarioProgrammato": "8",
      "binarioEffettivo": "8",
      "circolante": true,
      "tipoTreno": { "codice": "FR", "nome": "FR", "categoria": "high-speed" }
    }
  ]
}
```

### Arrivi

`GET /api/stations/arrivals?stationName=...&when=now`

Stessa struttura delle partenze, ma con `orarioArrivo` e `orarioArrivoLeggibile`.

### Stato treno (ViaggiaTreno)

`GET /api/trains/status?trainNumber=...`

Parametri:
- `trainNumber` / `numeroTreno` (string) numero treno (obbligatorio)
- `originName` (string, opzionale) origine per disambiguare (nome stazione)
- `choice` (number, opzionale) indice scelta quando la risposta richiede selezione
- `epochMs` / `timestampRiferimento` (number, opzionale) timestamp riferimento (ms)

Esempio:
```bash
curl "http://localhost:8888/api/trains/status?trainNumber=9544"
```

Caso “ambiguo”:
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
curl "http://localhost:8888/api/trains/status?trainNumber=9544&choice=0"
```

Risposta (estratto):
```json
{
  "ok": true,
  "referenceTimestamp": 1736524800000,
  "principali": {
    "numeroTreno": "9544",
    "codiceTreno": "FR",
    "tipoTreno": { "codice": "FR", "nome": "FR", "categoria": "high-speed" },
    "tratta": { "origine": "Salerno", "destinazione": "Milano Centrale" },
    "orari": {
      "partenza": { "programmato": "12:38", "reale": "12:40", "probabile": "12:41" },
      "arrivo": { "programmato": "18:30", "reale": null, "probabile": "18:40" }
    },
    "ritardoMinuti": 3,
    "ultimoRilevamento": { "timestamp": 1736528160000, "orario": "17:56", "stazione": "Roma Prenestina" },
    "aggiornamentoRfi": "con un ritardo di 3 min.",
    "fermate": [
      {
        "stazione": "Salerno",
        "tipoFermata": "P",
        "ritardo": 3,
        "orari": { "arrivo": { "programmato": null }, "partenza": { "programmato": 1736520000000 } },
        "binari": { "arrivo": { "programmato": null }, "partenza": { "programmato": "1" } }
      }
    ]
  }
}
```

### Soluzioni viaggio (LeFrecce)

`GET /api/solutions?fromName=...&toName=...&date=YYYY-MM-DD&time=HH:mm`

Parametri:
- `fromName` (string) stazione partenza (nome)
- `toName` (string) stazione arrivo (nome)
- `date` (string, obbligatorio) `YYYY-MM-DD`
- `time` (string, opzionale) `HH:mm` (default `00:00`)

Esempio:
```bash
curl "http://localhost:8888/api/solutions?fromName=Firenze%20S.M.Novella&toName=Milano%20Centrale&date=2026-01-15&time=10:00"
```

Risposta (estratto):
```json
{
  "ok": true,
  "idRicerca": "…",
  "stazioni": { "from": "Firenze S.M.Novella", "to": "Milano Centrale" },
  "soluzioni": [
    {
      "durata": 115,
      "partenza": "10:00",
      "arrivo": "11:55",
      "cambi": 0,
      "treni": [
        { "numeroTreno": "FR 9550", "categoria": "FR", "da": "Firenze S.M.Novella", "a": "Milano Centrale" }
      ]
    }
  ]
}
```

## Pagina test

In locale: `http://localhost:8888/test-rfi.html`

