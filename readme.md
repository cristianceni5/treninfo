# Treninfo (CercaTreni) — Documentazione API & Progetto

Questo repository è una web-app statica (HTML/CSS/Vanilla JS) con un backend Node.js (Express) esposto come Netlify Function.

Le API fanno da “proxy” verso servizi pubblici Trenitalia (ViaggiaTreno e LeFrecce) per aggirare limitazioni CORS e uniformare le risposte.
Prossimamente anche con Italo di NTV.

## Indice

- Panoramica progetto
- Avvio in locale
- Deploy
- Convenzioni API
- Variabili d’ambiente
- Endpoints
	- Autocomplete stazioni (ViaggiaTreno)
	- Autocomplete stazioni (LeFrecce)
	- Soluzioni di viaggio (LeFrecce)
	- Info stazione + meteo (ViaggiaTreno)
	- Partenze / Arrivi (ViaggiaTreno)
	- Stato treno (ViaggiaTreno) + disambiguazione numero duplicato
	- Tabellone HTML (debug)
	- News (legacy)

---

## Panoramica progetto

### Frontend

- `index.html`: UI (ricerca treno, cerca viaggio, cerca stazione).
- `styles.css`: stile dell’app.
- `script.js`: logica (fetch API, render UI, auto-refresh “onesto” e disambiguazione treni con stesso numero).
- `stazioni_coord_coerenti.tsv`: indice locale stazioni (nome/codice/regione + coordinate).

### Backend

- `src/app.js`: app Express con tutte le route `GET /api/...`.
- `netlify/functions/api.js`: wrapper serverless (`serverless-http`) che espone Express come Netlify Function.

### Base path

Tutte le API sono esposte sotto:

- Base path: `/api`

In locale vengono servite da Netlify Dev; in produzione da Netlify (redirect/rewrites configurati in `netlify.toml`).

---

## Avvio in locale

Prerequisiti:

- Node.js `>= 18`
- Netlify CLI (installata come devDependency)

Comandi:

```bash
npm install
npm run dev
```

`npm run dev` avvia `netlify dev`, che serve:

- frontend statico
- function `/api/*` (backend Express) in locale

---

## Deploy

Il deploy è pensato per Netlify:

- il frontend è statico
- il backend è una Netlify Function (la function espone Express)

---

## Convenzioni API

### Risposte

- Quasi tutte le risposte sono JSON con campo `ok`.
- Errore logico/applicativo: `ok: false` + `error` (string).
- In alcuni casi il backend restituisce anche `details` (messaggio tecnico) oppure `debug` (solo per aiutare in diagnosi).

### Errori HTTP

- Validazione parametri: tipicamente HTTP `400`.
- Errori upstream o interni: tipicamente HTTP `500`.

---

## Variabili d’ambiente

### `CORS_ORIGINS`

Lista separata da virgole (es. `http://localhost:5173,https://tuodominio.com`).

- Se **non** impostata: CORS aperto (comportamento permissivo).
- Se impostata: solo le origini presenti in lista sono permesse.

### `FETCH_TIMEOUT_MS`

Timeout in millisecondi per le chiamate verso servizi Trenitalia.

- Default: `12000`

---

## Endpoints

### 1 Autocomplete stazioni (ViaggiaTreno)

`GET /api/viaggiatreno/autocomplete?query=FIREN`

Query:

- `query` (string, minimo 2 caratteri)

Risposta (successo):

```json
{
	"ok": true,
	"data": [{ "name": "FIRENZE S.M.N.", "code": "S06904" }]
}
```

Note:

- Se `query` è troppo corta → `data: []`.

Compatibilità:

- `GET /api/stations/autocomplete?query=...` fa redirect (307) a questo endpoint.

---

### 2 Autocomplete stazioni (LeFrecce)

`GET /api/lefrecce/autocomplete?query=Roma`

Query:

- `query` (string, minimo 2 caratteri)

Risposta (successo):

```json
{
	"ok": true,
	"data": [{ "name": "Roma Termini", "id": 830000219 }]
}
```

---

### 3 Soluzioni di viaggio (LeFrecce)

`GET /api/solutions?date=YYYY-MM-DD&time=HH:mm&fromId=...&toId=...`

Query principali:

- `date` (obbligatorio) in formato `YYYY-MM-DD`
- `time` (opzionale) in formato `HH:mm` (default `00:00`)
- `fromId` (opzionale) locationId LeFrecce
- `toId` (opzionale) locationId LeFrecce
- alternativa a `fromId/toId`: `fromName/toName` (il backend prova a risolvere l’id chiamando LeFrecce locations/search)

Query avanzate (tutte opzionali):

- `adults` (default `1`)
- `children` (default `0`)
- `frecceOnly` (boolean)
- `regionalOnly` (boolean)
- `intercityOnly` (boolean)
- `tourismOnly` (boolean)
- `noChanges` (boolean)
- `order` (default `DEPARTURE_DATE`)
- `offset` (default `0`)
- `limit` (default `10`)
- `bestFare` (boolean)
- `bikeFilter` (boolean)

Risposta (successo):

```json
{
	"ok": true,
	"searchId": "...",
	"cartId": null,
	"solutions": [],
	"minimumPrices": null
}
```

Errori comuni:

- `400` se manca `date`.
- `400` se non è possibile ottenere `departureLocationId/arrivalLocationId` (da id o nome).

Esempio:

```bash
curl "http://localhost:8888/api/solutions?date=2025-12-17&time=08:30&fromName=Firenze%20S.%20M.%20Novella&toName=Roma%20Termini"
```

---

### 4 Info stazione + meteo (ViaggiaTreno)

`GET /api/stations/info?stationCode=S06904`

Query:

- `stationCode` (obbligatorio) es. `S06904`

Risposta (successo):

```json
{
	"ok": true,
	"stationCode": "S06904",
	"regionId": "TOSCANA",
	"station": { },
	"meteo": null
}
```

Note:

- Il backend prova a ricavare `regionId` da ViaggiaTreno; per alcune stazioni può usare override interni.
- Il meteo è “best effort”: se fallisce, `meteo` può essere `null` senza far fallire tutta la risposta.

---

### 5 Partenze (ViaggiaTreno)

`GET /api/stations/departures?stationCode=S06904&when=now`

Query:

- `stationCode` (obbligatorio)
- `when` (opzionale):
	- `now` (default)
	- oppure una data parseabile da JavaScript (es. `2025-12-14T12:30:00`)

Risposta (successo):

```json
{
	"ok": true,
	"stationCode": "S06904",
	"date": "Wed Dec 17 2025 ...",
	"data": []
}
```

---

### 6 Arrivi (ViaggiaTreno)

`GET /api/stations/arrivals?stationCode=S06904&when=now`

Query:

- `stationCode` (obbligatorio)
- `when` (opzionale) come per le partenze

Risposta: analoga a `/departures`.

---

### 7 Stato treno (ViaggiaTreno)

`GET /api/trains/status?trainNumber=1959`

Query:

- `trainNumber` (obbligatorio) — numero del treno
- `originCode` (opzionale) — codice stazione origine (per disambiguare)
- `technical` (opzionale) — stringa tecnica (per disambiguare) es. `1959-S06904`

Risposta (successo, treno trovato):

```json
{
	"ok": true,
	"originCode": "S06904",
	"rawSearchLine": "...",
	"technical": "1959-S06904",
	"referenceTimestamp": 1734420000000,
	"data": { }
}
```

#### Disambiguazione: numeri treno duplicati

Può capitare che più treni condividano lo stesso numero (es. giorni diversi / tratte diverse / riuso del numero).

Se il backend trova più candidati e non riesce a sceglierne uno in modo univoco, risponde con `needsSelection: true`:

```json
{
	"ok": true,
	"data": null,
	"needsSelection": true,
	"message": "Più treni trovati con questo numero: seleziona quello giusto.",
	"choices": [
		{
			"display": "...",
			"technical": "1959-S06904",
			"originCode": "S06904",
			"rawLine": "..."
		}
	]
}
```

Per completare la richiesta, rilancia con uno dei due hint:

- `originCode=...` oppure
- `technical=...`

Esempio:

```bash
curl "http://localhost:8888/api/trains/status?trainNumber=1959&technical=1959-S06904"
```

#### Logica “snapshot” (per avere uno stato credibile)

Per evitare risultati vuoti o “futuri” quando il numero viene riusato, il backend tenta più snapshot temporalmente:

- adesso (`0h`), poi `-6h`, `-12h`, `-18h`, `-24h`

Sceglie lo snapshot che risulta più coerente (es. treno ancora in corso), altrimenti usa un fallback disponibile.

---

### 8 Tabellone HTML (debug)

`GET /api/stations/board?stationCode=S06000`

- Restituisce HTML grezzo dal tabellone ViaggiaTreno.
- È mantenuto principalmente per debug.

---

### 9 News (legacy)

`GET /api/news`

- Restituisce le news da ViaggiaTreno.
- Endpoint “legacy”: può cambiare formato o risultare datato.

---

## Note operative (frontend)

- La UI gestisce la disambiguazione mostrando un menu di scelta quando `needsSelection: true`.
- La scelta può essere memorizzata lato client per riutilizzo (es. click da liste/soluzioni), ma nella ricerca manuale l’utente può scegliere esplicitamente.
- L’auto-refresh è limitato e “onesto” (non aggressivo), con abort delle richieste in flight e stop automatico su treno concluso.

### Developed by Cristian Ceni 2025

Tante madonne.
