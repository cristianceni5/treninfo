# Chiamate API Trenitalia (proxy -> ViaggiaTreno + LeFrecce)

Questa pagina riassume le chiamate upstream che il proxy fa verso i servizi pubblici di Trenitalia.
Le route elencate sono quelle esposte dal proxy (src/app.js) e i relativi endpoint esterni.

## Base URL

- ViaggiaTreno (RFI): `http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno`
- ViaggiaTreno board HTML: `http://www.viaggiatreno.it/viaggiatrenonew/resteasy/viaggiatreno`
- LeFrecce BFF: `https://www.lefrecce.it/Channels.Website.BFF.WEB`

## ViaggiaTreno (RFI)

### Autocomplete stazioni

Proxy:
- `GET /api/viaggiatreno/autocomplete?query=Roma`

Upstream:
- `GET /infomobilita/resteasy/viaggiatreno/autocompletaStazione/{query}`

Note:
- Risposta testuale (righe `Nome|Codice`). Il proxy mappa i codici ai nomi locali.

### Info stazione + meteo

Proxy:
- `GET /api/stations/info?stationCode=RM`

Upstream:
- `GET /infomobilita/resteasy/viaggiatreno/regione/{stationCode}`
- `GET /infomobilita/resteasy/viaggiatreno/dettaglioStazione/{stationCode}/{regionId}`
- `GET /infomobilita/resteasy/viaggiatreno/datimeteo/{regionId}`

Note:
- `regionId` viene prima risolto e poi usato per dettaglio stazione e meteo.

### Partenze da stazione

Proxy:
- `GET /api/stations/departures?stationCode=RM&when=now`

Upstream:
- `GET /infomobilita/resteasy/viaggiatreno/partenze/{stationCode}/{dateStr}`

Note:
- `dateStr` e' il timestamp codificato dal proxy (es. formato ViaggiaTreno per data/ora richiesta).

### Arrivi in stazione

Proxy:
- `GET /api/stations/arrivals?stationCode=RM&when=now`

Upstream:
- `GET /infomobilita/resteasy/viaggiatreno/arrivi/{stationCode}/{dateStr}`

### Tabellone stazione (JSON)

Proxy:
- `GET /api/viaggiatreno/station-board?stationCode=RM`

Upstream:
- `GET /infomobilita/resteasy/viaggiatreno/partenze/{stationCode}/{dateStr}`
- `GET /infomobilita/resteasy/viaggiatreno/arrivi/{stationCode}/{dateStr}`

### Tabellone stazione (HTML)

Proxy:
- `GET /api/stations/board?stationCode=RM`

Upstream:
- `GET /viaggiatrenonew/resteasy/viaggiatreno/partenze/{stationCode}/{dateStr}`

Note:
- Restituisce HTML raw del tabellone ViaggiaTreno.

### News ViaggiaTreno

Proxy:
- `GET /api/news`

Upstream:
- `GET /infomobilita/resteasy/viaggiatreno/infomobilitaRSS/{true|false}`

Note:
- `true` per lavori/perturbazioni, `false` per le notizie standard
- La risposta è HTML (accordion) che viene ripulito in JSON dall'API

### Stato treno (ricerca per numero)

Proxy:
- `GET /api/trains/status?numeroTreno=9544`

Upstream:
- `GET /infomobilita/resteasy/viaggiatreno/cercaNumeroTrenoTrenoAutocomplete/{trainNumber}`
- `GET /infomobilita/resteasy/viaggiatreno/andamentoTreno/{originCode}/{trainNumber}/{timestamp}`

Note:
- Il primo endpoint restituisce le possibili corse (numero + origine + timestamp).
- Il secondo restituisce il dettaglio corsa per la combinazione scelta.

## LeFrecce

### Ricerca locationId per nome stazione

Proxy (interno, usato per risolvere id quando necessario):
- `resolveLefrecceLocationIdByName(name)`

Upstream:
- `GET /Channels.Website.BFF.WEB/website/locations/search?name={name}&limit=10`

Note:
- Usato anche dagli script di update stazioni (`scripts/aggiorna-stazioni-lefrecce.js`).

### Soluzioni di viaggio / offerte

Proxy:
- `GET /api/solutions?fromLefrecceId=830&toLefrecceId=872&date=2024-11-30&time=08:00&adults=1`

Upstream:
- `POST /Channels.Website.BFF.WEB/website/ticket/solutions`

Body (JSON) principale:
- `departureLocationId`, `arrivalLocationId`, `departureTime`
- `adults`, `children`
- `criteria` (frecceOnly, regionalOnly, intercityOnly, tourismOnly, noChanges, order, offset, limit)
- `advancedSearchRequest` (bestFare, bikeFilter)

### Autocomplete LeFrecce (solo locale)

Proxy:
- `GET /api/lefrecce/autocomplete?query=Roma&includeIds=true`

Note:
- Non fa chiamate upstream: usa il DB locale stazioni con `lefrecceId` gia' popolato.
