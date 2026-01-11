# Endpoint remoti usati in `src/app.js`

Elenco degli endpoint esterni Viaggiatreno e LeFrecce che il backend chiama, con i parametri necessari per costruire gli URL (o il body per le POST).

## Viaggiatreno REST
Base: `http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno`

- `GET /autocompletaStazione/{query}`  
  - `query`: testo minimo 2 caratteri, passato come segmento di path.
  - Esempio reale:  
    ```bash
    curl -H "User-Agent: Mozilla/5.0" "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/autocompletaStazione/FIREN"
    ```
    Risposta (testo con pipe):  
    ```
    FIRENZE SANTA MARIA NOVELLA|S06421
    FIRENZE CAMPO MARTE|S06900
    FIRENZE CASTELLO|S06419
    ```
- `GET /regione/{stationCode}`  
  - `stationCode`: codice RFI della stazione (es. `S06904`), restituisce l'id regione.
  - Esempio reale: `curl -H "User-Agent: Mozilla/5.0" "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/regione/S06421"`  
    Risposta: `13` (id regione Toscana)
- `GET /dettaglioStazione/{stationCode}/{regionId}`  
  - `stationCode`: codice RFI.  
  - `regionId`: id regione ricevuto da `/regione`.
  - Esempio reale:  
    ```bash
    curl -H "User-Agent: Mozilla/5.0" "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/dettaglioStazione/S06421/13"
    ```
    Risposta (estratto):  
    ```json
    {
      "codiceStazione": "S06421",
      "lat": 43.776893,
      "lon": 11.247373,
      "localita": {
        "nomeLungo": "FIRENZE SANTA MARIA NOVELLA",
        "label": "Firenze S. M. Novella"
      }
    }
    ```
- `GET /datimeteo/{regionId}`  
  - `regionId`: id regione, restituisce meteo JSON.
- `GET /partenze/{stationCode}/{dateStr}`  
  - `stationCode`: codice RFI.  
  - `dateStr`: stringa `new Date(...).toString()` (es. `Fri Nov 28 2025 10:30:00 GMT+0100 (Central European Standard Time)`); usato per partenze istantanee o per un orario passato con `when`.
  - Esempio reale (oggi):  
    ```bash
    DATE_STR=$(node -e 'console.log(encodeURIComponent(new Date().toString()))')
    curl -H "User-Agent: Mozilla/5.0" \
      "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/partenze/S06421/${DATE_STR}"
    ```
    Risposta (primo elemento):  
    ```json
    {
      "numeroTreno": 8527,
      "categoriaDescrizione": " FR",
      "origine": null,
      "codOrigine": "S02430",
      "destinazione": "ROMA TERMINI",
      "partenzaTreno": 1768150500000,
      "ritardo": 3,
      "binarioProgrammatoPartenzaCodice": "5"
    }
    ```
- `GET /arrivi/{stationCode}/{dateStr}`  
  - Parametri come sopra; restituisce arrivi.
- `GET /cercaNumeroTrenoTrenoAutocomplete/{trainNumber}`  
  - `trainNumber`: numero del treno; restituisce righe `display|numeroTreno-codiceOrigine`.
- `GET /andamentoTreno/{originCode}/{trainNumber}/{epochMs}`  
  - `originCode`: codice stazione di origine.  
  - `trainNumber`: numero treno.  
  - `epochMs`: timestamp epoch in millisecondi scelto in base a now o al filtro richiesto.
  - Esempio reale (usando dati della partenza sopra):  
    ```bash
    curl -H "User-Agent: Mozilla/5.0" \
      "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/andamentoTreno/S02430/8527/1768150500000"
    ```
    Risposta (estratto):  
    ```json
    {
      "numeroTreno": 8527,
      "origine": "VERONA PORTA NUOVA",
      "destinazione": "ROMA TERMINI",
      "fermate": [
        { "stazione": "VERONA PORTA NUOVA", "programmata": 1768150320000, "ritardo": 3 }
      ]
    }
    ```
- `GET /news/0/it`  
  - Nessun parametro.
  - Esempio: `curl "http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/news/0/it"` → array JSON di news.

## Viaggiatreno tabellone HTML
Base: `http://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno`

- `GET /partenze/{stationCode}/{dateStr}`  
  - `stationCode`: codice RFI.  
  - `dateStr`: `new Date().toString()`; restituisce HTML del tabellone (versione "new").
  - Esempio:  
    ```bash
    curl "http://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno/partenze/S06000/$(node -e 'process.stdout.write(new Date().toString())')" | head
    ```
    Risposta: HTML del tabellone (non JSON).

## LeFrecce BFF
Base: `https://www.lefrecce.it/Channels.Website.BFF.WEB`

- `GET /website/locations/search?name={name}&limit={limit}`  
  - `name`: nome o porzione di nome stazione.  
  - `limit`: numero risultati (in `app.js` fissato a `10`).  
  Usato per autocomplete e per risolvere i locationId.
  - Esempio:  
    ```bash
    curl -H "User-Agent: Mozilla/5.0" "https://www.lefrecce.it/Channels.Website.BFF.WEB/website/locations/search?name=firenze&limit=5"
    ```
    Risposta (array):  
    ```json
    [
      { "id": 830006998, "name": "Firenze ( Tutte Le Stazioni )", "displayName": "Firenze ( Tutte Le Stazioni )" },
      { "id": 830006421, "name": "Firenze S. M. Novella", "displayName": "Firenze S. M. Novella" },
      { "id": 830006900, "name": "Firenze Campo Di Marte", "displayName": "Firenze Campo Di Marte" }
    ]
    ```
- `POST /website/ticket/solutions` (JSON nel body, nessun parametro query)  
  - `cartId`: `null`.  
  - `departureLocationId`: location id numerico stazione di partenza.  
  - `arrivalLocationId`: location id numerico stazione di arrivo.  
  - `departureTime`: stringa `YYYY-MM-DDTHH:mm:00.000`.  
  - `adults` / `children`: interi.  
  - `criteria`: oggetto con `frecceOnly`, `regionalOnly`, `intercityOnly`, `tourismOnly`, `noChanges` (boolean), `order` (`DEPARTURE_DATE` di default), `offset` (int, default 0), `limit` (int, default 10).  
  - `advancedSearchRequest`: oggetto con `bestFare` (bool), `bikeFilter` (bool), `forwardDiscountCodes` (array).
  - Esempio:  
    ```bash
    curl -X POST "https://www.lefrecce.it/Channels.Website.BFF.WEB/website/ticket/solutions" \
      -H "Content-Type: application/json" \
      -H "User-Agent: Mozilla/5.0" \
      -d '{
        "cartId": null,
        "departureLocationId": 83029,
        "arrivalLocationId": 83002,
        "departureTime": "2026-01-15T08:00:00.000",
        "adults": 1,
        "children": 0,
        "criteria": { "frecceOnly": false, "regionalOnly": false, "intercityOnly": false, "tourismOnly": false, "noChanges": false, "order": "DEPARTURE_DATE", "offset": 0, "limit": 5 },
        "advancedSearchRequest": { "bestFare": true, "bikeFilter": false, "forwardDiscountCodes": [] }
      }'
    ```
    Risposta reale (estratto):  
    ```json
    {
      "searchId": "830006421-830001700-one_way-2026-01-15T08:00:00.000---rewq-fdsa-iokm-ttno-vcxz-FBN-S",
      "cartId": "93f92125-8b6a-4a7e-8c72-24e8ce2f1d16",
      "solutions": [
        {
          "solution": {
            "origin": "Firenze S. M. Novella",
            "destination": "Milano Centrale",
            "departureTime": "2026-01-15T07:55:00.000+01:00",
            "arrivalTime": "2026-01-15T09:50:00.000+01:00",
            "trains": [{ "description": "9508", "trainCategory": "Frecciarossa" }]
          }
        }
      ],
      "minimumPrices": { "BASE": 39.9 }
    }
    ```
