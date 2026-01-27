# Treninfo API

<img src="icona-italia.png" alt="Italia" width="48" />

Backend (Netlify Functions) che normalizza i dati di ViaggiaTreno (RFI) e LeFrecce (Trenitalia) per l'app Treninfo.

Base URL: `https://treninfo.netlify.app/api`

Nota: gli autocomplete usano solo `stazioni.json` locale. Se `lefrecceId` e null, la stazione non e supportata da LeFrecce.

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
      "tipoTreno": {"sigla": "FR AV", "nome": "Frecciarossa"}
    }
  ]
}
```

### GET /trains/status
Stato treno normalizzato (RFI + Italo quando disponibile).

Request (query string):
- `trainNumber` (o `numeroTreno`)
- opzionali: `choice`, `originName`, `date`, `timestampRiferimento`

Response (esempio sintetico):
```json
{
  "ok": true,
  "dataRiferimento": "27/01/2026",
  "compagnia": "rfi",
  "numeroTreno": 9510,
  "tipoTreno": {"categoria": "FR AV", "nomeCat": "Frecciarossa"},
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
Infomobilità ViaggiaTreno in formato JSON.

Request (query string):
- `works` (opzionale, `1` per info lavori/perturbazioni)

Response (esempio):
```json
{
  "ok": true,
  "works": false,
  "data": [
    {
      "title": "CIRCOLAZIONE REGOLARE SULLA RETE ALTA VELOCITÀ",
      "date": "27.01.2026",
      "text": "In questo momento la circolazione si svolge regolarmente sull'intera rete Alta Velocità.",
      "inEvidenza": true
    }
  ]
}
```

Response errore (esempio):
```json
{
  "ok": false,
  "idRicerca": null,
  "stazioni": {"from": "Firenze Campo Marte", "to": "Roma Tiburtina"},
  "soluzioni": [],
  "error": "We are sorry. An error has occurred.",
  "status": 400
}
```

### GET /news
Request:
- Nessun parametro.

Response (esempio):
```json
{
  "ok": true,
  "data": []
}
```

## Esempi rapidi

```bash
curl "https://treninfo.netlify.app/api/health"
curl "https://treninfo.netlify.app/api/stations/autocomplete?query=roma&includeIds=1"
curl "https://treninfo.netlify.app/api/lefrecce/autocomplete?query=roma&includeIds=1"
curl "https://treninfo.netlify.app/api/solutions?fromLefrecceId=830001700&toLefrecceId=830008409&date=2026-01-27&time=10:00"
```
