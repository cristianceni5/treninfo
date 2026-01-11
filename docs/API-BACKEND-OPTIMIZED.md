# API Backend Ottimizzata - Dati Formattati

## Panoramica

Il backend è stato ottimizzato per fornire tutti i dati già formattati e pronti per la visualizzazione nel frontend. Questo elimina la necessità di calcoli lato client e garantisce coerenza nei dati mostrati.

## Endpoint Principali

### GET /api/trains/status

Restituisce lo stato dettagliato di un treno con tutti i dati formattati.

**Parametri:**
- `numeroTreno`: Numero del treno (obbligatorio)
- `codiceOrigine`: Codice stazione di origine (opzionale)
- `tecnico`: Stringa tecnica (opzionale)
- `timestampRiferimento`: Timestamp di riferimento epoch ms (opzionale)
- `debug`: Se `true`, aggiunge un blocco `debug` con dati completi (grezzi RFI + computed). Default `false`.

**Risposta:**

```json
{
  "ok": true,
  "treno": {
    /* dati essenziali (chiavi in italiano, senza duplicati) */
  },
  "debug": {
    /* presente solo con debug=1: dati completi (grezzi RFI + computed) */
  }
}
```

Il backend espone un payload minimale per la UI (`treno`). Se serve investigare problemi o confrontare i campi RFI, usare `debug=1`.

## Struttura Dati Dettagliata

### tipoTreno
Oggetto con:
- `codice`: sigla breve (es. `FR`, `IC`, `REG`)
- `etichetta`: label per UI
- `categoria`: categoria semantica (`high-speed`, `intercity`, `regional`, `bus`, `unknown`)

### ritardoMinuti
Numero (può essere negativo = anticipo) o `null`.

### fermate
Array con fermate formattate e distinzioni orarie utili:
- `orari.*.programmatoIniziale` (valore “Zero” quando disponibile)
- `orari.*.programmato` (orario programmato aggiornato)
- `orari.*.probabile` (programmato + ritardo)
- `orari.*.reale` (effettivo)

### rilevamento
Oggetto con:
- `testo`: stringa leggibile (es. `"14:50 Roma Prenestina"`)
- `timestamp`: epoch ms di ultimo rilevamento
- `stazione`: nome stazione (raw)

### oraLuogoRilevamento
Nel payload minimale è incluso dentro `rilevamento.testo` (formato `"HH:mm Stazione"`).

<!--
Sezioni legacy sotto (computed/data) non più centrali per il nuovo payload.
-->

/*
    // --- CAMPI ORIGINALI (mantenuti per compatibilità) ---
    "trainKind": {
      "code": "REG",
      "label": "REG",
      "category": "regional"
    },
    "globalDelay": 5,
    "journeyState": {
      "state": "RUNNING",
      "label": "In viaggio"
    },
    "currentStop": {
      "stationName": "Bologna Centrale",
      "stationCode": "S05042",
      "index": 3,
      "timestamp": "2025-01-10T19:45:00.000"
    },
    
    // --- NUOVI CAMPI FORMATTATI ---
    "tipologiaTreno": "REG",           // Tipologia: REG, IC, FR, FA, ecc.
    "numeroTreno": "18828",             // Numero del treno
    "origine": "Firenze SMN",           // Stazione di origine
    "destinazione": "Milano Centrale",  // Stazione di destinazione
    "orarioPartenzaProg": "19:20",      // Orario partenza programmato (HH:mm)
    "orarioArrivoProg": "22:30",        // Orario arrivo programmato (HH:mm)
    "deltaTempo": "+5",                 // Ritardo/anticipo: "+5" (ritardo), "-3" (anticipo), "0" (in orario)
    
    // Array fermate con tutte le info formattate
    "fermate": [
      {
        "stazione": "Firenze SMN",
        "id": "S06904",
        "progressivo": 1,
        
        // Orari programmati (HH:mm)
        "orarioArrivoProgrammato": null,
        "orarioPartenzaProgrammato": "19:20",
        
        // Orari probabili (programmato + deltaTempo)
        "orarioArrivoProbabile": null,
        "orarioPartenzaProbabile": "19:25",
        
        // Orari reali (quando disponibili)
        "orarioArrivoReale": null,
        "orarioPartenzaReale": "19:24",
        
        // Binari
        "binarioProgrammato": "3",
        "binarioReale": "4",
        "binarioVariato": true,
        
        // Stato fermata
        "soppressa": false,
        "actualFermataType": 0,
        "tipoFermata": "P"
      },
      // ... altre fermate
    ],
    
    // Messaggi RFI
    "messaggioRfi": "Treno in ritardo per inconveniente tecnico",
    
    // Info aggiuntive
    "infoAgg": "Carrozza business in testa al treno",
    
    // --- CAMPI STATO E POSIZIONE ---
    "statoTreno": "partito",              // Stato semplificato: "programmato", "partito", "soppresso", "concluso", "parziale"
    "prossimaFermata": "Arezzo",          // Nome della prossima fermata
    "oraLuogoRilevamento": "18:35 Rovezzano"  // Ultimo rilevamento: "HH:mm Stazione"
  }
}
```

## Struttura Dati Dettagliata

### tipologiaTreno
Codice breve del tipo di treno:
- **Alta velocità**: `FR` (Frecciarossa), `FA` (Frecciargento), `FB` (Frecciabianca), `ITA` (Italo), `TGV`, `ES` (Eurostar)
- **Intercity**: `IC` (Intercity), `ICN` (Intercity Notte), `EC` (Eurocity), `EN` (Euronight), `RJ` (Railjet)
- **Regionali**: `REG` (Regionale), `RV` (Regionale Veloce), `LEX` (Leonardo Express), `MXP` (Malpensa Express), `SUB` (Suburbano), `MET` (Metropolitano)
- **Bus**: `BUS`

### deltaTempo
Ritardo o anticipo formattato:
- `"+5"` = 5 minuti di ritardo
- `"-3"` = 3 minuti di anticipo
- `"0"` = in orario
- `null` = non disponibile

**Uso:** Per visualizzare lo stato:
```javascript
if (deltaTempo === "0") {
  // Mostra "In orario"
} else if (deltaTempo.startsWith("+")) {
  // Mostra ritardo in rosso
} else if (deltaTempo.startsWith("-")) {
  // Mostra anticipo in verde
}
```

### Fermate
Ogni fermata contiene:

#### Orari
- **orarioPartenzaProgrammato/orarioArrivoProgrammato**: Orario previsto dall'orario ufficiale (sempre disponibile)
- **orarioPartenzaProbabile/orarioArrivoProbabile**: Orario calcolato sommando `deltaTempo` all'orario programmato (già calcolato dal backend!)
- **orarioPartenzaReale/orarioArrivoReale**: Orario effettivo quando il treno passa (disponibile solo dopo il passaggio)

**Esempio di utilizzo:**
```javascript
// Per mostrare l'orario più aggiornato:
const orarioMostrato = fermata.orarioPartenzaReale || 
                        fermata.orarioPartenzaProbabile || 
                        fermata.orarioPartenzaProgrammato;
```

#### Binari
- **binarioProgrammato**: Binario previsto dall'orario
- **binarioReale**: Binario effettivo (quando disponibile)
- **binarioVariato**: `true` se il binario è cambiato rispetto al programmato

### messaggioRfi
Contiene messaggi importanti da RFI:
- Soppressioni: "Treno soppresso da Firenze a Bologna"
- Motivazioni ritardo: "Ritardo dovuto a inconveniente tecnico"
- Altre comunicazioni ufficiali

### infoAgg
Informazioni aggiuntive sul treno:
- Composizione: "Carrozza business in testa al treno"
- Servizi: "Servizio di ristorazione disponibile"
- Altre info: "Non circolante"

### statoTreno
Stato semplificato del treno per visualizzazione rapida:
- `"programmato"`: Treno non ancora partito
- `"partito"`: Treno in viaggio
- `"concluso"`: Treno arrivato a destinazione
- `"soppresso"`: Treno completamente soppresso
- `"parziale"`: Treno parzialmente soppresso (alcune fermate cancellate)

**Uso:** Ideale per badge o indicatori di stato nel frontend.

### prossimaFermata
Nome della prossima fermata prevista (es. `"Arezzo"`).
- Calcolata automaticamente basandosi sulla fermata attuale
- Salta automaticamente le fermate soppresse
- `null` se non ci sono fermate successive o se il treno è arrivato

**Esempio:**
```javascript
if (computed.prossimaFermata) {
  console.log(`Prossima fermata: ${computed.prossimaFermata}`);
}
```

### oraLuogoRilevamento
Ultimo rilevamento del treno formattato come `"HH:mm Stazione"` (es. `"18:35 Rovezzano"`).
- Include ora formattata in HH:mm
- Include il nome della stazione
- `null` se non ci sono rilevamenti disponibili

**Esempio di visualizzazione:**
```javascript
if (computed.oraLuogoRilevamento) {
  // Mostra: "Ultimo rilevamento: 18:35 Rovezzano"
  console.log(`Ultimo rilevamento: ${computed.oraLuogoRilevamento}`);
}
```

## Endpoint Secondari

### GET /api/stations/departures

Restituisce la lista dei treni in partenza da una stazione con tutti i dati formattati.

**Parametri:**
- `stationCode` (string, obbligatorio): Codice RFI della stazione (es. "S06904")
- `when` (string, opzionale): Timestamp di riferimento. Valori:
  - `"now"` (default): ora corrente
  - Data ISO: `"2026-01-15T10:30:00"` per una data/ora specifica

**Risposta:**
```json
{
  "ok": true,
  "stationCode": "S06904",
  "date": "Sat Jan 11 2026 15:30:00 GMT+0100",
  "data": [
    {
      // --- DATI GREZZI RFI (campi originali) ---
      "numeroTreno": 9544,
      "categoria": "FR",
      "categoriaDescrizione": " FR",
      "origine": "SALERNO",
      "destinazione": "MILANO CENTRALE",
      "origineForeignKey": "S09818",
      "destinazioneForeignKey": "S01700",
      "orarioPartenza": 1736611800000,
      "orarioPartenzaZero": 1736611800000,
      "binarioProgrammatoPartenzaDescrizione": "8",
      "binarioEffettivoPartenzaDescrizione": "8",
      "subTitle": "con un ritardo di 3 min.",
      "compRitardo": ["Ritardo 3"],
      "compRitardoAndamento": ["con un ritardo di 3 min."],
      "compNumeroTreno": "9544",
      "compOrarioPartenza": "16:55",
      "codOrigine": "S06904",
      "circolante": true,
      
      // --- DATI COMPUTATI E FORMATTATI (_computed) ---
      "_computed": {
        // Tipo treno
        "trainKind": {
          "code": "FR",
          "label": "FR",
          "category": "high-speed"
        },
        
        // Informazioni base
        "tipologiaTreno": "FR",
        "numeroTreno": "9544",
        "origine": "Salerno",
        "destinazione": "Milano Centrale",
        
        // Orari formattati
        "orarioPartenzaProg": "16:55",
        "orarioArrivoProg": "22:30",
        "deltaTempo": "+3",
        
        // Binari
        "binarioProgrammato": "8",
        "binarioEffettivo": "8",
        "binarioVariato": false,
        
        // Stato
        "globalDelay": 3,
        "circolante": true,
        "statoTreno": "partito",
        
        // Fermate (array completo con orari formattati)
        "fermate": [ /* ... */ ],
        
        // Messaggi
        "messaggioRfi": "con un ritardo di 3 min.",
        "infoAgg": null
      }
    }
  ]
}
```

**Note:**
- I treni sono ordinati per orario di partenza
- Ogni treno include sia i dati grezzi RFI che i dati computati nel campo `_computed`
- Il campo `_computed` contiene gli stessi campi formattati di `/api/trains/status`

---

### GET /api/stations/arrivals

Restituisce la lista dei treni in arrivo in una stazione con tutti i dati formattati.

**Parametri:**
- `stationCode` (string, obbligatorio): Codice RFI della stazione (es. "S06904")
- `when` (string, opzionale): Timestamp di riferimento
  - `"now"` (default): ora corrente
  - Data ISO: `"2026-01-15T10:30:00"` per una data/ora specifica

**Risposta:**
Stessa struttura di `/api/stations/departures`, ma con:
- `orarioArrivo` invece di `orarioPartenza` nei dati grezzi
- `orarioArrivoProg` invece di `orarioPartenzaProg` nei dati computati
- `binarioProgrammatoArrivoDescrizione` invece di `binarioProgrammatoPartenzaDescrizione`
- `binarioEffettivoArrivoDescrizione` invece di `binarioEffettivoPartenzaDescrizione`

**Esempio:**
```json
{
  "ok": true,
  "stationCode": "S06904",
  "date": "Sat Jan 11 2026 15:30:00 GMT+0100",
  "data": [
    {
      "numeroTreno": 9520,
      "categoria": "FR",
      "origine": "MILANO CENTRALE",
      "destinazione": "SALERNO",
      "orarioArrivo": 1736618400000,
      "compOrarioArrivo": "18:40",
      "circolante": true,
      "_computed": {
        "tipologiaTreno": "FR",
        "numeroTreno": "9520",
        "orarioArrivoProg": "18:40",
        "deltaTempo": "+5",
        "globalDelay": 5,
        // ... altri campi formattati
      }
    }
  ]
}
```

---

### GET /api/stations/info

Restituisce informazioni dettagliate su una stazione (coordinate, nome, meteo regione).

**Parametri:**
- `stationCode` (string, obbligatorio): Codice RFI della stazione (es. "S06904")

**Risposta:**
```json
{
  "ok": true,
  "stationCode": "S06904",
  "regionId": "13",
  "station": {
    "codiceStazione": "S06904",
    "codReg": 13,
    "tipoStazione": 3,
    "dettZoomStaz": {
      "codiceStazione": "S06904",
      "codiceRegione": 13,
      "tipoStazione": 3,
      "zoomStartRange": 9,
      "zoomStopRange": 12,
      "pinpointZoomLevel": 14,
      "offsetX": 0,
      "offsetY": 0
    },
    "nomeLungo": "FIRENZE CAMPO DI MARTE",
    "nomeBreve": "Firenze C.Marte",
    "label": "Firenze Campo di Marte",
    "id": "S06904",
    "lat": 43.782844,
    "lon": 11.300775,
    "esterno": false,
    "offsetX": 0,
    "offsetY": 0,
    "nomeCitta": "FIRENZE"
  },
  "meteo": {
    "temp": 12,
    "tempPer": 12,
    "icona": "poco_nuvoloso",
    "vento": 10,
    "ventoDesc": "Debole",
    "ventoDirezione": "SO",
    "umidita": 65,
    "descrizione": "Poco nuvoloso",
    "localita": "Toscana",
    "aggiornatoAlle": "15:30"
  }
}
```

**Campi Chiave:**

**station:**
- `codiceStazione` (String): codice RFI (formato Sxxxxx)
- `nomeLungo` (String): nome completo ufficiale (MAIUSCOLO)
- `nomeBreve` (String): nome abbreviato per visualizzazione
- `label` (String): nome user-friendly (Titlecase)
- `lat` (Number): latitudine GPS (gradi decimali)
- `lon` (Number): longitudine GPS (gradi decimali)
- `codReg` / `codiceRegione` (Number): codice regione ISTAT (1-20)
- `tipoStazione` (Number): tipo stazione (1=piccola, 2=media, 3=grande)
- `esterno` (Boolean): true se stazione estera, false se italiana
- `nomeCitta` (String): nome città di appartenenza

**meteo:**
- `temp` (Number): temperatura attuale in °C
- `tempPer` (Number): temperatura percepita in °C
- `icona` (String): nome icona meteo (poco_nuvoloso, sereno, nuvoloso, pioggia, ecc.)
- `vento` (Number): velocità vento in km/h
- `ventoDesc` (String): descrizione vento (Assente, Debole, Moderato, Forte)
- `ventoDirezione` (String): direzione vento (N, NE, E, SE, S, SO, O, NO)
- `umidita` (Number): umidità relativa in percentuale (0-100)
- `descrizione` (String): descrizione meteo testuale
- `localita` (String): nome regione italiana
- `aggiornatoAlle` (String): ora ultimo aggiornamento (HH:mm)

**Note:**
- Se la regione non è determinabile, l'endpoint può restituire `ok: false`
- Il meteo è relativo all'intera regione, non alla stazione specifica
- Il meteo può essere `null` in caso di errore nel recupero dati

---

### GET /api/solutions

Cerca soluzioni di viaggio tra due stazioni usando l'API LeFrecce.

**Parametri (Query String):**
```
?fromName=Firenze&toName=Milano&date=2026-01-15&time=10:00
```

| Parametro | Tipo | Obbligatorio | Default | Descrizione |
|-----------|------|--------------|---------|-------------|
| `fromId` | Number | No* | - | ID LeFrecce stazione partenza |
| `toId` | Number | No* | - | ID LeFrecce stazione arrivo |
| `fromName` | String | No* | - | Nome stazione partenza (risolto automaticamente) |
| `toName` | String | No* | - | Nome stazione arrivo (risolto automaticamente) |
| `date` | String | Sì | - | Data viaggio (YYYY-MM-DD) |
| `time` | String | No | "00:00" | Ora partenza (HH:mm) |
| `adults` | Number | No | 1 | Numero adulti (1-9) |
| `children` | Number | No | 0 | Numero bambini (0-9) |
| `frecceOnly` | Boolean | No | false | Solo treni Frecce (FR/FA/FB) |
| `regionalOnly` | Boolean | No | false | Solo treni regionali |
| `intercityOnly` | Boolean | No | false | Solo treni Intercity |
| `tourismOnly` | Boolean | No | false | Solo treni turistici |
| `noChanges` | Boolean | No | false | Solo soluzioni dirette (senza cambi) |
| `order` | String | No | "DEPARTURE_DATE" | Ordinamento risultati |
| `offset` | Number | No | 0 | Offset paginazione |
| `limit` | Number | No | 10 | Numero massimo risultati |
| `bestFare` | Boolean | No | false | Solo migliori tariffe |
| `bikeFilter` | Boolean | No | false | Solo treni con trasporto bici |

\* Obbligatorio: fornire `fromId` + `toId` OPPURE `fromName` + `toName`

**Risposta:**
```json
{
  "ok": true,
  "searchId": "abc123xyz789",
  "cartId": null,
  "solutions": [
    {
      "departureTime": "2026-01-15T10:05:00.000",
      "arrivalTime": "2026-01-15T12:30:00.000",
      "minPrice": 4450,
      "minPriceLabel": "44,50 €",
      "duration": "02:25",
      "changesNumber": 0,
      "saleable": true,
      "status": "SALEABLE",
      "trains": [
        {
          "trainIdentifier": "9524",
          "departureStation": {
            "id": 83029,
            "name": "FIRENZE S.M.NOVELLA",
            "displayName": "Firenze S.M.Novella"
          },
          "arrivalStation": {
            "id": 83002,
            "name": "MILANO CENTRALE",
            "displayName": "Milano Centrale"
          },
          "departureTime": "2026-01-15T10:05:00.000",
          "arrivalTime": "2026-01-15T12:30:00.000",
          "trainCategory": "FR",
          "trainCategoryLabel": "Frecciarossa"
        }
      ],
      "bookable": true
    },
    {
      "departureTime": "2026-01-15T10:35:00.000",
      "arrivalTime": "2026-01-15T14:50:00.000",
      "minPrice": 2950,
      "minPriceLabel": "29,50 €",
      "duration": "04:15",
      "changesNumber": 1,
      "saleable": true,
      "status": "SALEABLE",
      "trains": [
        {
          "trainIdentifier": "18820",
          "departureStation": {
            "id": 83029,
            "name": "FIRENZE S.M.NOVELLA",
            "displayName": "Firenze S.M.Novella"
          },
          "arrivalStation": {
            "id": 83019,
            "name": "BOLOGNA CENTRALE",
            "displayName": "Bologna Centrale"
          },
          "departureTime": "2026-01-15T10:35:00.000",
          "arrivalTime": "2026-01-15T12:10:00.000",
          "trainCategory": "REG",
          "trainCategoryLabel": "Regionale"
        },
        {
          "trainIdentifier": "9726",
          "departureStation": {
            "id": 83019,
            "name": "BOLOGNA CENTRALE",
            "displayName": "Bologna Centrale"
          },
          "arrivalStation": {
            "id": 83002,
            "name": "MILANO CENTRALE",
            "displayName": "Milano Centrale"
          },
          "departureTime": "2026-01-15T12:45:00.000",
          "arrivalTime": "2026-01-15T14:50:00.000",
          "trainCategory": "FA",
          "trainCategoryLabel": "Frecciargento"
        }
      ],
      "bookable": true
    }
  ],
  "minimumPrices": {
    "frecce": 4450,
    "intercity": null,
    "regional": 2950
  }
}
```

**Campi Soluzione:**

**Livello Soluzione:**
- `departureTime` (String ISO): orario partenza primo treno
- `arrivalTime` (String ISO): orario arrivo ultimo treno
- `minPrice` (Number): prezzo minimo in centesimi (4450 = 44,50€)
- `minPriceLabel` (String): prezzo formattato per visualizzazione
- `duration` (String): durata totale viaggio (HH:mm)
- `changesNumber` (Number): numero di cambi necessari (0 = diretto)
- `saleable` (Boolean): true se acquistabile online
- `status` (String): stato soluzione (SALEABLE, NOT_SALEABLE, SOLD_OUT)
- `trains` (Array): array treni da prendere in sequenza
- `bookable` (Boolean): true se prenotabile

**Livello Treno (dentro trains[]):**
- `trainIdentifier` (String): numero identificativo treno
- `departureStation` (Object): stazione partenza
  - `id` (Number): ID LeFrecce stazione
  - `name` (String): nome stazione (MAIUSCOLO)
  - `displayName` (String): nome formattato per display
- `arrivalStation` (Object): stazione arrivo (stessa struttura)
- `departureTime` (String ISO): orario partenza da questa stazione
- `arrivalTime` (String ISO): orario arrivo a questa stazione
- `trainCategory` (String): categoria treno (FR/FA/FB/IC/REG/ecc)
- `trainCategoryLabel` (String): etichetta categoria estesa

**minimumPrices:**
Prezzi minimi trovati per categoria di treno (in centesimi):
- `frecce` (Number|null): prezzo minimo per Frecce (FR/FA/FB)
- `intercity` (Number|null): prezzo minimo per Intercity
- `regional` (Number|null): prezzo minimo per Regionali

**Note:**
- Le soluzioni sono ordinate cronologicamente per default
- I prezzi sono sempre in centesimi (dividere per 100 per ottenere euro)
- Se `changesNumber = 0`, la soluzione è diretta (un solo treno)
- Se `changesNumber = 1`, ci sono 2 treni (1 cambio), e così via
- I filtri mutuamente esclusivi (frecceOnly, regionalOnly, intercityOnly) non devono essere usati insieme

---

### POST /api/lefrecce/solutions

Versione POST dell'endpoint soluzioni (usata dal frontend).

**Body (JSON):**
```json
{
  "origin": "Firenze",
  "destination": "Milano",
  "departureDate": "2026-01-15",
  "departureTime": "10:00"
}
```

**Parametri Body:**
- `origin` (String, obbligatorio): nome o ID stazione partenza
- `destination` (String, obbligatorio): nome o ID stazione arrivo
- `departureDate` (String, obbligatorio): data viaggio (YYYY-MM-DD)
- `departureTime` (String, opzionale): ora partenza (HH:mm), default "00:00"

**Risposta:**
```json
{
  "ok": true,
  "data": {
    "searchId": "abc123xyz789",
    "cartId": null,
    "solutions": [ /* array soluzioni come GET /api/solutions */ ],
    "minimumPrices": {
      "frecce": 4450,
      "intercity": null,
      "regional": 2950
    }
  }
}
```

**Note:**
- Se `origin` o `destination` sono stringhe (nomi), vengono risolti automaticamente in ID LeFrecce
- Se sono numeri, vengono usati direttamente come ID LeFrecce
- Restituisce sempre `ok: true/false` per compatibilità con il resto delle API

---

### GET /api/viaggiatreno/autocomplete

Cerca stazioni per nome usando l'API ViaggiaTreno (per ricerca treni).

**Parametri:**
- `query` (String, obbligatorio): testo da cercare (minimo 2 caratteri)

**Risposta:**
```json
{
  "ok": true,
  "data": [
    {
      "name": "FIRENZE SANTA MARIA NOVELLA",
      "code": "S06421"
    },
    {
      "name": "FIRENZE CAMPO DI MARTE",
      "code": "S06904"
    },
    {
      "name": "FIRENZE RIFREDI",
      "code": "S06409"
    }
  ]
}
```

**Note:**
- Ricerca case-insensitive
- Minimo 2 caratteri nella query
- Restituisce array vuoto se nessun match
- Usa codici RFI (formato Sxxxxx)

---

### GET /api/lefrecce/autocomplete

Cerca stazioni per nome usando l'API LeFrecce (per ricerca viaggi).

**Parametri:**
- `query` (String, obbligatorio): testo da cercare (minimo 2 caratteri)

**Risposta:**
```json
{
  "ok": true,
  "data": [
    {
      "name": "Firenze S.M.Novella",
      "id": 83029
    },
    {
      "name": "Firenze Campo di Marte",
      "id": 83030
    },
    {
      "name": "Firenze Rifredi",
      "id": 83031
    }
  ]
}
```

**Differenze con ViaggiaTreno autocomplete:**
- Usa ID numerici LeFrecce invece di codici RFI
- Nome formattato in modo user-friendly (non MAIUSCOLO)
- Risultati possono includere stazioni estere
- Limite fisso di 10 risultati

**Note:**
- Minimo 2 caratteri nella query
- I nomi sono in formato Titlecase (prima lettera maiuscola)
- Gli ID sono necessari per chiamare `/api/solutions`

## Vantaggi dell'Ottimizzazione

1. **Meno calcoli nel frontend**: Tutti gli orari probabili sono già calcolati
2. **Coerenza**: La logica di calcolo è centralizzata nel backend
3. **Performance**: Il frontend deve solo visualizzare i dati, non processarli
4. **Manutenibilità**: Modifiche alla logica di calcolo in un solo punto
5. **Semplicità**: Il frontend usa direttamente i campi formattati senza parsing

---

## 📊 Riferimento Rapido Parametri

### Parametri Query String Comuni

| Parametro | Tipo | Formato | Esempio | Uso |
|-----------|------|---------|---------|-----|
| `stationCode` | String | Sxxxxx | "S06904" | Codice RFI stazione |
| `trainNumber` | String | 1-5 cifre | "9544" | Numero treno |
| `query` | String | testo | "Firenze" | Ricerca autocomplete (min 2 char) |
| `when` | String | ISO o "now" | "now" o "2026-01-15T10:30:00" | Timestamp riferimento |
| `originCode` | String | Sxxxxx | "S09818" | Codice stazione origine treno |
| `epochMs` | Number | timestamp | 1736524800000 | Millisec epoch Unix |

### Parametri Ricerca Soluzioni

| Parametro | Tipo | Default | Valori | Descrizione |
|-----------|------|---------|--------|-------------|
| `date` | String | - | YYYY-MM-DD | Data viaggio (obbligatorio) |
| `time` | String | "00:00" | HH:mm | Ora partenza |
| `adults` | Number | 1 | 1-9 | Numero adulti |
| `children` | Number | 0 | 0-9 | Numero bambini |
| `frecceOnly` | Boolean | false | true/false | Solo Frecce |
| `regionalOnly` | Boolean | false | true/false | Solo regionali |
| `intercityOnly` | Boolean | false | true/false | Solo Intercity |
| `noChanges` | Boolean | false | true/false | Solo diretti |

---

## 🔍 Differenze tra API ViaggiaTreno e LeFrecce

### ViaggiaTreno (Informazioni Treni)
**Endpoint:** `/api/viaggiatreno/autocomplete`, `/api/trains/status`, `/api/stations/*`

**Caratteristiche:**
- ✅ Dati in tempo reale su stato treni
- ✅ Fermate dettagliate con orari effettivi
- ✅ Ritardi, binari, soppressioni
- ✅ Tutte le stazioni italiane
- ✅ Codici RFI (formato Sxxxxx)
- ❌ Non fornisce soluzioni di viaggio
- ❌ Non ha prezzi biglietti

**Usa per:** Monitorare stato treni, vedere ritardi, controllare binari

### LeFrecce (Soluzioni Viaggio)
**Endpoint:** `/api/lefrecce/autocomplete`, `/api/solutions`, `/api/lefrecce/solutions`

**Caratteristiche:**
- ✅ Soluzioni di viaggio tra stazioni
- ✅ Prezzi e disponibilità biglietti
- ✅ Combinazioni con cambi
- ✅ Filtri per categoria treno
- ✅ Stazioni italiane + estere
- ✅ ID numerici LeFrecce
- ❌ Non ha dati in tempo reale su ritardi
- ❌ Non ha info dettagliate fermate intermedie

**Usa per:** Cercare treni per un viaggio, confrontare prezzi, prenotare

---

## 💡 Pattern di Utilizzo Comuni

### 1. Cercare e Monitorare un Treno

```javascript
// Step 1: Cerca il treno per numero
const search = await fetch('/api/trains/status?trainNumber=9544');
const { ok, data, needsSelection, choices } = await search.json();

// Step 2: Se serve disambiguare (più treni con stesso numero)
if (needsSelection) {
  // Mostra le scelte all'utente e lui seleziona
  const selected = choices[0]; // esempio: utente sceglie il primo
  
  // Step 3: Richiama con parametri specifici
  const detail = await fetch(
    `/api/trains/status?trainNumber=${selected.trainNumber}&originCode=${selected.originCode}&epochMs=${selected.epochMs}`
  );
  const train = await detail.json();
}

// Step 4: Usa i dati formattati
console.log(`Treno ${train.computed.tipologiaTreno} ${train.computed.numeroTreno}`);
console.log(`Da ${train.computed.origine} a ${train.computed.destinazione}`);
console.log(`Ritardo: ${train.computed.deltaTempo} minuti`);
console.log(`Prossima fermata: ${train.computed.prossimaFermata}`);

// Step 5: Mostra fermate
train.computed.fermate.forEach(fermata => {
  const orario = fermata.orarioPartenzaReale || 
                 fermata.orarioPartenzaProbabile || 
                 fermata.orarioPartenzaProgrammato;
  const badge = fermata.soppressa ? '[SOPPRESSA]' : '';
  console.log(`${fermata.stazione}: ${orario} ${badge}`);
});
```

### 2. Tabellone Partenze/Arrivi Stazione

```javascript
// Ottieni partenze
const departures = await fetch('/api/stations/departures?stationCode=S06904&when=now');
const { ok, data } = await departures.json();

// Renderizza tabella
data.forEach(train => {
  const computed = train._computed;
  const orario = computed.orarioPartenzaProg;
  const ritardo = computed.deltaTempo;
  const binario = computed.binarioEffettivo || computed.binarioProgrammato;
  const trenotype = computed.tipologiaTreno;
  
  // Styling in base a categoria
  const colorClass = {
    'high-speed': 'text-red-600',
    'intercity': 'text-blue-600',
    'regional': 'text-green-600'
  }[computed.trainKind.category];
  
  // Badge ritardo
  const delayBadge = computed.globalDelay > 0 
    ? `<span class="badge-delay">+${computed.globalDelay}'</span>`
    : '';
  
  // Badge soppressione
  const cancelBadge = !computed.circolante 
    ? '<span class="badge-cancel">SOPPRESSO</span>'
    : '';
    
  console.log(`${orario} | ${trenotype} ${computed.numeroTreno} | ${computed.destinazione} | Bin. ${binario} ${delayBadge} ${cancelBadge}`);
});
```

### 3. Ricerca Viaggio con Filtri

```javascript
// Step 1: Autocomplete stazioni (usa LeFrecce per viaggi)
const fromSearch = await fetch('/api/lefrecce/autocomplete?query=Firenze');
const { data: fromStations } = await fromSearch.json();
const firenze = fromStations[0]; // { name: "Firenze S.M.Novella", id: 83029 }

const toSearch = await fetch('/api/lefrecce/autocomplete?query=Milano');
const { data: toStations } = await toSearch.json();
const milano = toStations[0]; // { name: "Milano Centrale", id: 83002 }

// Step 2: Cerca soluzioni (preferibilmente GET)
const params = new URLSearchParams({
  fromId: firenze.id,
  toId: milano.id,
  date: '2026-01-15',
  time: '10:00',
  adults: 2,
  children: 1,
  frecceOnly: false, // Tutte le categorie
  noChanges: false   // Anche soluzioni con cambi
});

const solutions = await fetch(`/api/solutions?${params}`);
const { ok, solutions: trips, minimumPrices } = await solutions.json();

// Step 3: Mostra risultati
console.log(`Trovate ${trips.length} soluzioni`);
console.log(`Prezzo minimo Frecce: ${minimumPrices.frecce / 100}€`);
console.log(`Prezzo minimo Regionali: ${minimumPrices.regional / 100}€`);

trips.forEach(trip => {
  const departure = trip.departureTime.split('T')[1].slice(0, 5); // "10:05"
  const arrival = trip.arrivalTime.split('T')[1].slice(0, 5);     // "12:30"
  const price = trip.minPrice / 100; // Converti centesimi in euro
  const changes = trip.changesNumber === 0 ? 'Diretto' : `${trip.changesNumber} cambio/i`;
  
  console.log(`${departure} → ${arrival} | ${trip.duration} | ${price}€ | ${changes}`);
  
  // Dettaglio treni
  trip.trains.forEach((train, idx) => {
    const from = train.departureStation.displayName;
    const to = train.arrivalStation.displayName;
    console.log(`  ${idx + 1}. ${train.trainCategory} ${train.trainIdentifier}: ${from} → ${to}`);
  });
});
```

### 4. Applicare Filtri Soluzioni

```javascript
// Solo Frecce (alta velocità)
const frecceOnly = await fetch('/api/solutions?fromId=83029&toId=83002&date=2026-01-15&frecceOnly=true');

// Solo Regionali (economici)
const regionalOnly = await fetch('/api/solutions?fromId=83029&toId=83002&date=2026-01-15&regionalOnly=true');

// Solo diretti (senza cambi)
const directOnly = await fetch('/api/solutions?fromId=83029&toId=83002&date=2026-01-15&noChanges=true');

// Combinazione: Frecce dirette
const frecceDirectOnly = await fetch('/api/solutions?fromId=83029&toId=83002&date=2026-01-15&frecceOnly=true&noChanges=true');
```

### 5. Gestione Info Stazione

```javascript
// Ottieni info stazione con meteo
const stationInfo = await fetch('/api/stations/info?stationCode=S06904');
const { ok, station, meteo } = await stationInfo.json();

if (ok) {
  console.log(`Stazione: ${station.label}`);
  console.log(`Coordinate: ${station.lat}, ${station.lon}`);
  console.log(`Tipo: ${station.tipoStazione === 3 ? 'Grande' : station.tipoStazione === 2 ? 'Media' : 'Piccola'}`);
  
  if (meteo) {
    console.log(`\nMeteo ${meteo.localita}:`);
    console.log(`Temperatura: ${meteo.temp}°C (percepita ${meteo.tempPer}°C)`);
    console.log(`Condizioni: ${meteo.descrizione}`);
    console.log(`Vento: ${meteo.ventoDesc} da ${meteo.ventoDirezione} (${meteo.vento} km/h)`);
    console.log(`Umidità: ${meteo.umidita}%`);
  }
  
  // Usa coordinate per mappa
  // showMapMarker(station.lat, station.lon, station.label);
}
```

### 6. Refresh Automatico con Gestione Stato

```javascript
let refreshInterval = null;

function startTrainMonitoring(trainNumber, originCode, epochMs) {
  // Ferma monitoraggio precedente
  if (refreshInterval) {
    clearInterval(refreshInterval);
  }
  
  async function updateTrainStatus() {
    try {
      const response = await fetch(
        `/api/trains/status?trainNumber=${trainNumber}&originCode=${originCode}&epochMs=${epochMs}`
      );
      const { ok, computed } = await response.json();
      
      if (!ok) {
        stopTrainMonitoring();
        return;
      }
      
      // Aggiorna UI
      updateTrainCard(computed);
      
      // Se treno arrivato o soppresso, ferma il refresh
      if (computed.statoTreno === 'concluso' || computed.statoTreno === 'soppresso') {
        stopTrainMonitoring();
        console.log('Monitoraggio terminato:', computed.statoTreno);
      }
    } catch (error) {
      console.error('Errore refresh:', error);
    }
  }
  
  // Prima chiamata immediata
  updateTrainStatus();
  
  // Poi ogni 60 secondi
  refreshInterval = setInterval(updateTrainStatus, 60000);
}

function stopTrainMonitoring() {
  if (refreshInterval) {
    clearInterval(refreshInterval);
    refreshInterval = null;
  }
}

// Uso
startTrainMonitoring('9544', 'S09818', Date.now());
```

---

## ⚠️ Errori Comuni e Soluzioni

### Errore: "Più treni trovati con questo numero"

**Causa:** Lo stesso numero treno può circolare più volte al giorno o da origini diverse.

**Soluzione:**
```javascript
const response = await fetch('/api/trains/status?trainNumber=9544');
const { needsSelection, choices } = await response.json();

if (needsSelection) {
  // Mostra scelte all'utente
  choices.forEach((choice, idx) => {
    console.log(`${idx + 1}. ${choice.display} - ${choice.technical}`);
  });
  
  // Usa quello selezionato
  const selected = choices[userChoice];
  const detail = await fetch(
    `/api/trains/status?trainNumber=${selected.trainNumber}&technical=${selected.technical}`
  );
}
```

### Errore: "Parametro 'stationCode' obbligatorio"

**Causa:** Codice stazione mancante o formato errato.

**Soluzione:**
```javascript
// ❌ SBAGLIATO
fetch('/api/stations/departures'); // Missing stationCode

// ❌ SBAGLIATO - formato errato
fetch('/api/stations/departures?stationCode=Firenze'); // Deve essere Sxxxxx

// ✅ CORRETTO
fetch('/api/stations/departures?stationCode=S06904');
```

### Errore: "Impossibile ricavare idRegione"

**Causa:** Stazione non riconosciuta nel database ViaggiaTreno.

**Soluzione:**
- Verifica che il codice sia corretto con autocomplete:
```javascript
const search = await fetch('/api/viaggiatreno/autocomplete?query=Firenze');
const { data } = await search.json();
// Usa data[0].code per il codice corretto
```

### Errore: "Serve almeno fromId/toId oppure fromName/toName"

**Causa:** Parametri mancanti per ricerca soluzioni.

**Soluzione:**
```javascript
// ❌ SBAGLIATO
fetch('/api/solutions?date=2026-01-15'); // Missing from/to

// ✅ CORRETTO - con nomi
fetch('/api/solutions?fromName=Firenze&toName=Milano&date=2026-01-15');

// ✅ CORRETTO - con ID
fetch('/api/solutions?fromId=83029&toId=83002&date=2026-01-15');
```

### Errore: Orari null o undefined

**Causa:** Ordine sbagliato di priorità orari o mancata gestione null.

**Soluzione:**
```javascript
// ✅ CORRETTO - gestione sicura
function getOrarioSicuro(fermata, tipo = 'partenza') {
  const field = tipo === 'arrivo' ? 'Arrivo' : 'Partenza';
  return fermata[`orario${field}Reale`] ||      // 1. Effettivo
         fermata[`orario${field}Probabile`] ||  // 2. Stimato con ritardo
         fermata[`orario${field}Programmato`] || // 3. Programmato
         'N/D';                                   // 4. Fallback
}
```

---

## 🚀 Ottimizzazioni Prestazioni

### 1. Cache Stazioni
```javascript
const stationsCache = new Map();

async function getStationInfo(code) {
  // Controlla cache (valida per 24h)
  const cached = stationsCache.get(code);
  if (cached && Date.now() - cached.timestamp < 86400000) {
    return cached.data;
  }
  
  // Fetch e salva in cache
  const response = await fetch(`/api/stations/info?stationCode=${code}`);
  const data = await response.json();
  
  stationsCache.set(code, {
    data,
    timestamp: Date.now()
  });
  
  return data;
}
```

### 2. Debounce Autocomplete
```javascript
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

const searchStations = debounce(async (query) => {
  if (query.length < 2) return;
  const response = await fetch(`/api/viaggiatreno/autocomplete?query=${query}`);
  const { data } = await response.json();
  updateAutocompleteUI(data);
}, 300); // Aspetta 300ms dopo che l'utente smette di digitare

// Uso
inputElement.addEventListener('input', (e) => searchStations(e.target.value));
```

### 3. Cancellazione Richieste Obsolete
```javascript
let currentFetchController = null;

async function fetchTrainStatus(trainNumber) {
  // Cancella fetch precedente se ancora in corso
  if (currentFetchController) {
    currentFetchController.abort();
  }
  
  // Nuovo controller per questa richiesta
  currentFetchController = new AbortController();
  
  try {
    const response = await fetch(
      `/api/trains/status?trainNumber=${trainNumber}`,
      { signal: currentFetchController.signal }
    );
    const data = await response.json();
    updateUI(data);
  } catch (error) {
    if (error.name === 'AbortError') {
      console.log('Fetch cancellato (nuovo fetch in corso)');
    } else {
      console.error('Errore fetch:', error);
    }
  } finally {
    currentFetchController = null;
  }
}
```

### 4. Paginazione Soluzioni
```javascript
let currentOffset = 0;
const PAGE_SIZE = 10;

async function loadMoreSolutions(fromId, toId, date) {
  const response = await fetch(
    `/api/solutions?fromId=${fromId}&toId=${toId}&date=${date}&offset=${currentOffset}&limit=${PAGE_SIZE}`
  );
  const { solutions } = await response.json();
  
  appendSolutionsToUI(solutions);
  currentOffset += PAGE_SIZE;
  
  // Mostra pulsante "Carica altro" se ci sono risultati
  showLoadMoreButton(solutions.length === PAGE_SIZE);
}
```

---

## Retrocompatibilità

Tutti i campi originali (`trainKind`, `globalDelay`, `journeyState`, `currentStop`) sono mantenuti per garantire la retrocompatibilità con il codice frontend esistente.

---

## 📋 Checklist Implementazione Frontend

Quando implementi il frontend con queste API, assicurati di:

### ✅ Gestione Dati
- [ ] Usare sempre il campo `_computed` o `computed` per i dati formattati
- [ ] Gestire i valori `null` con fallback appropriati (`??` operator)
- [ ] Applicare priorità corretta per orari: reale → probabile → programmato
- [ ] Verificare `ok: true` prima di processare le risposte

### ✅ Gestione Errori
- [ ] Gestire `needsSelection: true` per treni ambigui
- [ ] Mostrare messaggi user-friendly per errori 400/404/500
- [ ] Implementare retry logic per errori 500/503/504
- [ ] Timeout per chiamate API (es. 15 secondi)

### ✅ UI/UX
- [ ] Evidenziare binari cambiati (`binarioVariato: true`)
- [ ] Mostrare badge per ritardi, soppressioni, anticipi
- [ ] Disabilitare refresh per treni conclusi/soppressi
- [ ] Usare colori diversi per categorie treno (Frecce=rosso, IC=blu, REG=verde)
- [ ] Filtrare o evidenziare fermate soppresse

### ✅ Performance
- [ ] Implementare cache per info stazioni (24h)
- [ ] Debounce per autocomplete (300ms)
- [ ] Cancellare fetch obsoleti con AbortController
- [ ] Refresh intelligente (solo per treni in viaggio, max 1/min)

### ✅ Accessibilità
- [ ] Label descrittive per screen reader
- [ ] Alt text per icone meteo/stato treno
- [ ] Contrasto colori adeguato per ritardi/soppressioni
- [ ] Navigazione da tastiera funzionante

---

## 🔗 Mapping Codici Stazione

### ViaggiaTreno ↔ LeFrecce

**Problema:** ViaggiaTreno usa codici RFI (Sxxxxx), LeFrecce usa ID numerici.

**Soluzione:** Il backend risolve automaticamente i nomi in ID LeFrecce:

```javascript
// Frontend invia nome
fetch('/api/solutions?fromName=Firenze&toName=Milano&date=2026-01-15')

// Backend risolve automaticamente:
// "Firenze" → ID LeFrecce 83029
// "Milano" → ID LeFrecce 83002
```

**Mapping Manuale (se necessario):**

Usa `stations.json` che contiene entrambi i tipi di codice:
```json
{
  "id": "S06421",           // Codice RFI (ViaggiaTreno)
  "name": "Firenze S.M.Novella",
  "lefrecceId": 83029       // ID LeFrecce
}
```

---

## 📊 Statistiche e Metriche

### Tempi di Risposta Tipici

| Endpoint | Tempo medio | Timeout |
|----------|-------------|---------|
| `/api/trains/status` | 800-1500ms | 12s |
| `/api/stations/departures` | 600-1200ms | 12s |
| `/api/stations/arrivals` | 600-1200ms | 12s |
| `/api/stations/info` | 400-800ms | 12s |
| `/api/solutions` | 1500-3000ms | 12s |
| `/api/viaggiatreno/autocomplete` | 200-500ms | 12s |
| `/api/lefrecce/autocomplete` | 300-600ms | 12s |

### Volume Dati Tipico

| Endpoint | Dimensione risposta |
|----------|---------------------|
| `/api/trains/status` (treno singolo) | 15-50 KB |
| `/api/stations/departures` (20 treni) | 80-150 KB |
| `/api/stations/info` | 2-5 KB |
| `/api/solutions` (10 soluzioni) | 20-40 KB |
| `/api/autocomplete` (10 risultati) | 1-2 KB |

**Raccomandazioni:**
- Usa compressione GZIP (già abilitata su Netlify)
- Limita il numero di risultati con `limit` parametro
- Cache aggressiva per info stazioni (cambiano raramente)

---

## 🔐 Sicurezza e Rate Limiting

### Rate Limiting Consigliato

**Per endpoint frequenti** (autocomplete, departures):
- Max 60 richieste/minuto per IP
- Burst: 10 richieste/secondo

**Per endpoint intensivi** (solutions):
- Max 20 richieste/minuto per IP
- Burst: 2 richieste/secondo

**Implementazione Frontend:**
```javascript
// Rate limiter semplice
class RateLimiter {
  constructor(maxRequests, windowMs) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
    this.requests = [];
  }
  
  async throttle() {
    const now = Date.now();
    this.requests = this.requests.filter(time => now - time < this.windowMs);
    
    if (this.requests.length >= this.maxRequests) {
      const oldestRequest = this.requests[0];
      const waitTime = this.windowMs - (now - oldestRequest);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return this.throttle();
    }
    
    this.requests.push(now);
  }
}

// Uso
const limiter = new RateLimiter(60, 60000); // 60 req/min

async function fetchWithRateLimit(url) {
  await limiter.throttle();
  return fetch(url);
}
```

### Validazione Input

**Frontend deve validare:**
- Codici stazione: formato `S\d{5}`
- Numeri treno: solo cifre, 1-5 caratteri
- Date: formato ISO, non nel passato
- Query autocomplete: min 2 caratteri, max 100 caratteri

---

## 📖 Glossario Termini

| Termine | Significato | Esempio |
|---------|-------------|---------|
| **Codice RFI** | Codice stazione Rete Ferroviaria Italiana | S06904 |
| **ID LeFrecce** | ID numerico stazione sistema LeFrecce | 83029 |
| **Epoch milliseconds** | Timestamp Unix in millisecondi | 1736524800000 |
| **Technical** | ID tecnico treno (numero-origine) | 9544-S09818 |
| **Delta tempo** | Ritardo formattato con segno | +5, -2, 0 |
| **Binario variato** | Binario cambiato rispetto al programmato | true/false |
| **Fermata soppressa** | Fermata cancellata dal percorso | true/false |
| **Circolante** | Treno attivo (non soppresso) | true/false |
| **Train kind** | Tipo/categoria treno | FR, IC, REG |
| **Journey state** | Stato viaggio | PLANNED, RUNNING, COMPLETED |

---

## 🎓 Esempi Avanzati

### Widget "Treno Preferito" con Persistenza

```javascript
class FavoriteTrainWidget {
  constructor() {
    this.favorites = this.loadFavorites();
    this.activeMonitoring = new Map();
  }
  
  loadFavorites() {
    const stored = localStorage.getItem('favorite_trains');
    return stored ? JSON.parse(stored) : [];
  }
  
  saveFavorites() {
    localStorage.setItem('favorite_trains', JSON.stringify(this.favorites));
  }
  
  addFavorite(trainNumber, originCode, epochMs, alias = '') {
    const favorite = {
      id: `${trainNumber}-${originCode}`,
      trainNumber,
      originCode,
      epochMs,
      alias: alias || `Treno ${trainNumber}`,
      addedAt: Date.now()
    };
    
    this.favorites.push(favorite);
    this.saveFavorites();
    this.startMonitoring(favorite);
  }
  
  removeFavorite(id) {
    this.favorites = this.favorites.filter(f => f.id !== id);
    this.saveFavorites();
    this.stopMonitoring(id);
  }
  
  async startMonitoring(favorite) {
    const update = async () => {
      const response = await fetch(
        `/api/trains/status?trainNumber=${favorite.trainNumber}&originCode=${favorite.originCode}&epochMs=${favorite.epochMs}`
      );
      const { ok, computed } = await response.json();
      
      if (ok) {
        this.updateWidget(favorite.id, computed);
        
        // Stop se completato/soppresso
        if (['concluso', 'soppresso'].includes(computed.statoTreno)) {
          this.stopMonitoring(favorite.id);
        }
      }
    };
    
    // Prima chiamata immediata
    await update();
    
    // Poi ogni minuto
    const intervalId = setInterval(update, 60000);
    this.activeMonitoring.set(favorite.id, intervalId);
  }
  
  stopMonitoring(id) {
    const intervalId = this.activeMonitoring.get(id);
    if (intervalId) {
      clearInterval(intervalId);
      this.activeMonitoring.delete(id);
    }
  }
  
  updateWidget(id, computed) {
    const element = document.querySelector(`[data-favorite-id="${id}"]`);
    if (!element) return;
    
    element.innerHTML = `
      <div class="train-card ${computed.statoTreno}">
        <div class="train-header">
          <span class="train-type">${computed.tipologiaTreno}</span>
          <span class="train-number">${computed.numeroTreno}</span>
          <button onclick="widget.removeFavorite('${id}')">✕</button>
        </div>
        <div class="train-route">
          ${computed.origine} → ${computed.destinazione}
        </div>
        <div class="train-status">
          <span class="delay ${computed.globalDelay > 0 ? 'delayed' : ''}">${computed.deltaTempo}</span>
          ${computed.prossimaFermata ? `<span class="next">→ ${computed.prossimaFermata}</span>` : ''}
        </div>
      </div>
    `;
  }
  
  renderAll() {
    const container = document.getElementById('favorites-container');
    container.innerHTML = this.favorites.map(f => 
      `<div data-favorite-id="${f.id}">Caricamento...</div>`
    ).join('');
    
    this.favorites.forEach(f => this.startMonitoring(f));
  }
}

// Uso
const widget = new FavoriteTrainWidget();
widget.renderAll();
```

### Dashboard Multi-Stazione

```javascript
class StationsDashboard {
  constructor(stationCodes) {
    this.stations = stationCodes;
    this.data = new Map();
  }
  
  async loadAll() {
    const promises = this.stations.map(async (code) => {
      const [departures, info] = await Promise.all([
        fetch(`/api/stations/departures?stationCode=${code}`).then(r => r.json()),
        fetch(`/api/stations/info?stationCode=${code}`).then(r => r.json())
      ]);
      
      this.data.set(code, { departures, info });
    });
    
    await Promise.all(promises);
    this.render();
  }
  
  render() {
    const container = document.getElementById('dashboard');
    
    container.innerHTML = Array.from(this.data.entries()).map(([code, { departures, info }]) => {
      const station = info.station;
      const trains = departures.data.slice(0, 5); // Primi 5 treni
      
      return `
        <div class="station-card">
          <h3>${station.label}</h3>
          <div class="station-meta">
            📍 ${station.nomeCitta} | 🌡️ ${info.meteo?.temp}°C
          </div>
          <div class="trains-list">
            ${trains.map(train => `
              <div class="train-row">
                <span class="time">${train._computed.orarioPartenzaProg}</span>
                <span class="type">${train._computed.tipologiaTreno}</span>
                <span class="destination">${train._computed.destinazione}</span>
                <span class="delay ${train._computed.globalDelay > 0 ? 'late' : ''}">
                  ${train._computed.deltaTempo}
                </span>
              </div>
            `).join('')}
          </div>
        </div>
      `;
    }).join('');
  }
  
  startAutoRefresh(intervalMs = 30000) {
    setInterval(() => this.loadAll(), intervalMs);
  }
}

// Uso
const dashboard = new StationsDashboard(['S06904', 'S06421', 'S06409']);
dashboard.loadAll();
dashboard.startAutoRefresh(30000); // Refresh ogni 30s
```

---

## 📞 Supporto e Troubleshooting

### Log Debug Utili

```javascript
// Abilita logging dettagliato
const DEBUG = true;

async function fetchWithLogging(url) {
  if (DEBUG) console.log(`[FETCH] ${url}`);
  const start = Date.now();
  
  try {
    const response = await fetch(url);
    const duration = Date.now() - start;
    
    if (DEBUG) {
      console.log(`[RESPONSE] ${url} - ${response.status} (${duration}ms)`);
    }
    
    return response;
  } catch (error) {
    if (DEBUG) {
      console.error(`[ERROR] ${url} - ${error.message}`);
    }
    throw error;
  }
}
```

### Segnalazione Bug

Quando segnali un bug, includi:
1. **Endpoint** chiamato con parametri completi
2. **Risposta** completa (JSON)
3. **Comportamento atteso** vs comportamento osservato
4. **Timestamp** della richiesta
5. **Browser** e versione

---

## 🔄 Changelog API

### Versione 3.1 (Gennaio 2026)
- ✨ Aggiunto endpoint `/api/lefrecce/autocomplete`
- ✨ Supporto risoluzione automatica nomi stazioni in `/api/solutions`
- 🐛 Fix gestione binari variati
- 📝 Documentazione completa parametri JSON

### Versione 3.0 (Gennaio 2026)
- ✨ Nuovo campo `computed` con tutti i dati formattati
- ✨ Orari probabili pre-calcolati
- ✨ Campo `_computed` in `/api/stations/departures` e `/api/stations/arrivals`
- 🔧 Migliorate performance calcolo ritardi

---

## Note Tecniche

- Tutti gli orari sono formattati in **HH:mm** (es. "19:20", "07:05")
- I timestamp interni restano in millisecondi Unix
- Il campo `deltaTempo` è sempre una stringa per facilitare la visualizzazione
- Le fermate soppresse hanno `soppressa: true`
- I binari variati hanno `binarioVariato: true` per evidenziazioni visive

---

**Documentazione completa aggiornata**: 11 gennaio 2026  
**Versione API Backend**: 3.1  
**Autore**: Cristian Ceni

Per ulteriori informazioni tecniche consultare:
- [API-DOCUMENTATION.md](API-DOCUMENTATION.md) - Documentazione API pubbliche
- [src/app.js](src/app.js) - Codice sorgente backend
- [script.js](script.js) - Esempi implementazione frontend
