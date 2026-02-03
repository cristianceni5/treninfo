<img src="icona-italia.png" alt="Italia" width="125" />

# Treninfo - App e Server

Backend (Netlify Functions) che normalizza i dati di ViaggiaTreno (RFI) e LeFrecce (Trenitalia) per l'app Treninfo.

Base URL: `https://treninfo.netlify.app/api`

Nota: gli autocomplete usano solo `stazioni.json` locale. Se `lefrecceId` e null, la stazione non e supportata da LeFrecce.

## Formato stazioni.json
Campi principali (ogni stazione):
- `nome`: nome pubblico stazione.
- `viaggiatrenoId`: codice RFI (es. `S01700`). Può essere `null` per voci aggregate.
- `id`: **nuovo** codice alternativo quando manca `viaggiatrenoId` (es. `LF830005999` per "Tutte le stazioni").
- `lefrecceId`: ID stazione LeFrecce (numero) o `null`.
- `italoId`: codice stazione Italo (stringa) o `null`.
- `regionId`, `lat`, `lon`, `disuso`.

## Sicurezza e performance
- Rate limiting per IP (in-memory): default 120 req/min standard, 30 req/min per endpoint pesanti (`/trains/status`, `/italo/trains/status`, `/solutions`).
- Cache in-memory con TTL brevi per ridurre chiamate upstream (news, tabelloni, treni, Italo).
- Header `Cache-Control` per caching CDN (quando disponibile).
- Security headers base per API JSON.
- In serverless la cache è volatile: funziona finché la funzione resta "warm".

Variabili ambiente principali:
- `TRUST_PROXY` = 1 per usare `X-Forwarded-For` nel rate limiting (default 0)
- `RATE_LIMIT_ENABLED` = 1 (default), `RATE_LIMIT_WINDOW_MS` = 60000, `RATE_LIMIT_MAX` = 120, `RATE_LIMIT_HEAVY_MAX` = 30, `RATE_LIMIT_MAX_ENTRIES` = 10000
- `SECURITY_HEADERS_ENABLED` = 1 (default), `EXPOSE_ERRORS` = 1 per esporre i messaggi upstream
- `NEWS_TTL_MS` = 60000, `STATION_BOARD_TTL_MS` = 30000, `STATION_DEPARTURES_TTL_MS` = 30000, `STATION_ARRIVALS_TTL_MS` = 30000, `ITALO_BOARD_TTL_MS` = 30000
- `TRAIN_STATUS_TTL_MS` = 30000, `TRAIN_SEARCH_TTL_MS` = 600000, `TRAIN_SNAPSHOT_TTL_MS` = 30000, `ITALO_STATUS_TTL_MS` = 30000, `ITALO_LAST_KNOWN_TTL_MS` = 43200000
- `ITALO_SOFT_TIMEOUT_MS` = 200 (non blocca la risposta RFI se Italo è lento)

## Classificazione treni
- `tipoTreno.compagnia`: `TI` (Trenitalia), `TN` (Trenord), `TTX` (Trenitalia TPer), `NTV` (Italo).
- Codici cliente (RFI):
  - `1` → AV (`FR`)
  - `2` → Regionali (`REG`) o `MET` se indicato
  - `4` → Intercity (`IC`/`ICN`): se `compNumeroTreno` contiene `ICN` o `IC` usa quello, altrimenti `DV` → `ICN`, `PG` → `IC`
  - `18` → Trenitalia TPer (`TTX`, tipo `REG`)
  - `63` → Trenord (`TN`, tipo `REG`)
- EC/EN: riconosciuti come `EC` (EuroCity) e `EN` (EuroNight), non classificati come AV.
- MET: riconosciuto come `MET` (metropolitana/circumvesuviana).
- ES: il treno `99122` viene forzato come `ES` (EuroStar).

## Endpoints

### GET /health
Request:
- Nessun parametro.

Response (esempio):
```json
{
  "ok": true,
  "stationDb": {
    "loaded": true,
    "count": 3253
  }
}
```

### GET /stations/autocomplete
Request (query string):
- `query` (obbligatorio, min 2 caratteri)
- `limit` (opzionale, max 50)
- `includeIds` (opzionale, `1` per oggetti con id)

Response (esempio, includeIds=0):
```json
{
  "ok": true,
  "data": ["Milano Centrale", "Milano Rogoredo"]
}
```

Response (esempio, includeIds=1):
```json
{
  "ok": true,
  "data": [
    {
      "name": "Milano Centrale",
      "stationCode": "S01700",
      "lefrecceId": 830001700,
      "italoCode": "MC_"
    }
  ]
}
```

### GET /lefrecce/autocomplete
Autocomplete locale filtrato sulle stazioni con `lefrecceId`.

Request (query string):
- `query` (obbligatorio, min 2 caratteri)
- `limit` (opzionale, max 50)
- `includeIds` (opzionale, `1` per oggetti con id)

Response (esempio, includeIds=1):
```json
{
  "ok": true,
  "data": [
    {
      "stazione": "Roma (Tutte le stazioni)",
      "multistation": true,
      "lefrecceId": 830008349,
      "stationCode": "S08409"
    }
  ]
}
```

### GET /stations/info
Request (query string):
- `stationName` oppure `stationCode`

Response (esempio):
```json
{
  "ok": true,
  "stazione": "Roma Termini",
  "latitudine": 41.900636,
  "longitudine": 12.502026,
  "regione": "5"
}
```

### GET /stations/departures
### GET /stations/arrivals
Request (query string):
- `stationName` oppure `stationCode`
- `when` (opzionale, default `now`)

Response (esempio):
```json
{
  "ok": true,
  "stazione": "Milano Centrale",
  "data": "2026-01-27T10:00:00.000Z",
  "treni": [
    {
      "numeroTreno": "9510",
      "origine": "Milano Centrale",
      "destinazione": "Roma Termini",
      "orarioPartenza": 1769510400000,
      "orarioPartenzaLeggibile": "10:00",
      "ritardo": 0,
      "binarioProgrammato": "7",
      "binarioEffettivo": "7",
      "arrivato": false,
      "circolante": true,
      "tipoTreno": {"sigla": "FR AV", "nome": "Frecciarossa", "compagnia": "TI"}
    }
  ]
}
```

### GET /trains/status
Stato treno normalizzato (RFI + Italo quando disponibile).

Request (query string):
- `trainNumber` (o `numeroTreno`)
- opzionali: `choice`, `originName`, `date`, `timestampRiferimento`

Cache e deduplica:
- Le risposte vengono cache per breve tempo per ridurre le chiamate upstream quando molti utenti chiedono lo stesso treno.
- La ricerca `cercaNumeroTreno` e gli snapshot `andamentoTreno` sono cache per evitare burst verso ViaggiaTreno.
- Per Italo, l'ultimo stato valido viene conservato anche dopo la fine corsa (quando l'API Italo smette di rispondere).
Nota: la cache è in-memory (funzioni serverless), quindi è efficace finché la funzione resta "warm".

Note:
- `ultimo rilevamento`: il luogo è riportato **pari pari** come fornito da RFI, senza mapping.
- `binari`: se ViaggiaTreno non fornisce il binario (o lo restituisce `0`), il valore è `null`.
- Italo: quando disponibile, i nomi stazione vengono risolti tramite **codice Italo** nel DB locale; altrimenti rimane il nome raw.
- `statoServizio`: stato servizio RFI derivato da `tipoTreno`/`provvedimento` (es. Regolare, Deviato, Parzialmente soppresso, Soppresso).
- `statoServizioRaw`: valore grezzo normalizzato (es. `deviato`, `parzialmente_soppresso`).
- `statoServizioRfi`: dettaglio tecnico `{ tipoTreno, provvedimento }` quando disponibile.

Response (esempio sintetico):
```json
{
  "ok": true,
  "dataRiferimento": "27/01/2026",
  "compagnia": "rfi",
  "numeroTreno": 9510,
  "tipoTreno": {"categoria": "FR AV", "nomeCat": "Frecciarossa", "compagnia": "TI"},
  "tratta": {
    "stazionePartenzaZero": "Milano Centrale",
    "orarioPartenzaZero": "10:00",
    "stazioneArrivoZero": "Roma Termini",
    "orarioArrivoZero": "13:59"
  },
  "statoTreno": {
    "deltaTempo": 0,
    "stato": "In viaggio",
    "stazioneCorrente": null
  },
  "fermate": {"totali": 8, "fermate": []}
}
```

### GET /italo/trains/status
Come `/trains/status` ma solo Italo.

Request (query string):
- `trainNumber` (o `numeroTreno`)

Response: stesso schema di `/trains/status`.

### GET /solutions
Soluzioni viaggio LeFrecce.

Request (query string):
- `fromLefrecceId` (obbligatorio, usare sempre gli ID LeFrecce)
- `toLefrecceId` (obbligatorio, usare sempre gli ID LeFrecce)
- `date` (obbligatorio, `YYYY-MM-DD`)
- `time` (opzionale, `HH:mm`)
- opzionali: `adults`, `children`, `frecceOnly`, `regionalOnly`, `intercityOnly`, `tourismOnly`, `noChanges`, `order`, `offset`, `limit`, `bestFare`, `bikeFilter`

Response (esempio):
```json
{
  "ok": true,
  "idRicerca": "830001700-830008409-one_way-2026-01-27T10:00:00.000---...",
  "stazioni": {
    "from": "Milano Centrale",
    "to": "Roma Termini"
  },
  "soluzioni": [
    {
      "durata": 219,
      "dataPartenza": "2026-01-27",
      "partenza": "10:10",
      "dataArrivo": "2026-01-27",
      "arrivo": "13:49",
      "cambi": 0,
      "prezzo": {"valuta": "EUR", "importo": 74.9, "indicativo": false},
      "treni": [
        {
          "numeroTreno": "9510",
          "tipoTreno": {"sigla": "FR AV", "nome": "Frecciarossa"},
          "da": "Milano Centrale",
          "a": "Roma Termini",
          "dataPartenza": "2026-01-27",
          "orarioPartenza": "10:10",
          "dataArrivo": "2026-01-27",
          "orarioArrivo": "13:49"
        }
      ]
    }
  ]
}
```

### GET /news
Infomobilità ViaggiaTreno in formato JSON (notizie e lavori/perturbazioni).

Request (query string):
- `works` oppure `lavori` (opzionale, `1`/`true` per info lavori e perturbazioni; default `false`)

Response (esempio):
```json
{
  "ok": true,
  "works": false,
  "data": [
    {
      "title": "CIRCOLAZIONE REGOLARE SULLA RETE ALTA VELOCITÀ",
      "date": "03.02.2026",
      "text": "In questo momento la circolazione si svolge regolarmente sull'intera rete Alta Velocità.\nEventuali ritardi registrati si riferiscono a precedenti inconvenienti già risolti.\nREGULAR TRAFFIC ON THE HIGH-SPEED RAILWAY NETWORK\nAt the moment, the railway traffic is regular on the whole High-Speed network.",
      "inEvidenza": true
    }
  ]
}
```

Note sui campi di `data`:
- `title`: titolo della notizia
- `date`: data in formato `DD.MM.YYYY` (come fornita da ViaggiaTreno)
- `text`: testo pulito dall'HTML, con paragrafi separati da `\n`; è un riassunto compatto (max 3 righe) e può includere più lingue
- `inEvidenza`: `true` se la notizia è marcata "in evidenza" nel feed ViaggiaTreno

Response errore (esempio):
```json
{
  "ok": false,
  "error": "We are sorry. An error has occurred."
}
```

## Esempi rapidi

```bash
curl "https://treninfo.netlify.app/api/health"
curl "https://treninfo.netlify.app/api/stations/autocomplete?query=roma&includeIds=1"
curl "https://treninfo.netlify.app/api/lefrecce/autocomplete?query=roma&includeIds=1"
curl "https://treninfo.netlify.app/api/solutions?fromLefrecceId=830001700&toLefrecceId=830008409&date=2026-01-27&time=10:00"
```
