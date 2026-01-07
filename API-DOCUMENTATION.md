# 🚆 API Treninfo — Documentazione Completa

Documentazione API backend **Treninfo** — tutte le chiamate disponibili per consultare dati treni e stazioni in tempo reale.

**Base URL**: `https://treninfo.netlify.app`

---

## 📑 Indice

1. [Cerca stazioni](#1-cerca-stazioni)
2. [Informazioni stazione](#2-informazioni-stazione)
3. [Partenze da stazione](#3-partenze-da-stazione)
4. [Arrivi in stazione](#4-arrivi-in-stazione)
5. [Stato treno](#5-stato-treno)
6. [Soluzioni di viaggio](#6-soluzioni-di-viaggio)
7. [Dati computati](#7-dati-computati)

---

## 1. Cerca stazioni

Cerca una stazione per nome (autocomplete).

**Endpoint**: `GET /api/viaggiatreno/autocomplete`

**Parametri**:
- `query` (string, obbligatorio): testo da cercare (min 2 caratteri)

**Esempio**:
```bash
curl "https://treninfo.netlify.app/api/viaggiatreno/autocomplete?query=FIREN"
```

**Risposta**:
```json
{
  "ok": true,                    // Booleano: true se richiesta completata con successo
  "data": [                      // Array di stazioni trovate
    {
      "nome": "FIRENZE SANTA MARIA NOVELLA",  // String: nome completo stazione (maiuscolo)
      "codice": "S06421"                      // String: codice identificativo RFI (formato Sxxxxx)
    },
    {
      "nome": "FIRENZE CAMPO MARTE",
      "codice": "S06900"
    }
  ]
}
```

---

## 2. Informazioni stazione

Dettagli completi di una stazione (coordinate, nome, meteo).

**Endpoint**: `GET /api/stations/info`

**Parametri**:
- `stationCode` (string, obbligatorio): codice stazione RFI (es. "S06421")

**Esempio**:
```bash
curl "https://treninfo.netlify.app/api/stations/info?stationCode=S06421"
```

**Risposta**:
```json
{
  "ok": true,                                       // Booleano: true se richiesta completata
  "codiceStazione": "S06421",                       // String: codice RFI stazione
  "nome": "FIRENZE SANTA MARIA NOVELLA",            // String: nome completo ufficiale (maiuscolo)
  "nomeBreve": "FIRENZE S.M.N.",                    // String: nome abbreviato per visualizzazione
  "latitudine": 43.776893,                          // Number: coordinate GPS latitudine (gradi decimali)
  "longitudine": 11.247373,                         // Number: coordinate GPS longitudine (gradi decimali)
  "regione": "13"                                   // String: codice regione italiana (1-20)
}
```

---

## 3. Partenze da stazione

Lista treni in partenza da una stazione.

**Endpoint**: `GET /api/stations/departures`

**Parametri**:
- `stationCode` (string, obbligatorio): codice stazione
- `when` (string, opzionale): timestamp ISO o "now" (default: "now")

**Esempio**:
```bash
curl "https://treninfo.netlify.app/api/stations/departures?stationCode=S06421"
```

**Risposta**:
```json
{
  "ok": true,                                       // Booleano: true se richiesta completata
  "codiceStazione": "S06421",                       // String: codice stazione richiesta
  "data": "2026-01-07T18:30:00",                    // String: timestamp riferimento ISO 8601
  "treni": [                                        // Array: lista treni in partenza
    {
      "numeroTreno": 9544,                          // Number: numero identificativo treno
      "categoria": "FR",                            // String: categoria ufficiale (FR/FA/FB/IC/REG/ecc)
      "origine": "SALERNO",                         // String: stazione capolinea partenza
      "destinazione": "MILANO CENTRALE",            // String: stazione capolinea arrivo
      "orarioPartenza": 1767801300000,              // Number: timestamp partenza in millisecondi epoch
      "orarioPartenzaLeggibile": "16:55",           // String: orario partenza formato HH:mm
      "ritardo": 79,                                // Number: ritardo in minuti (>0 ritardo, 0 orario, <0 anticipo)
      "binarioProgrammato": "8",                    // String: binario previsto da orario
      "binarioEffettivo": "8",                      // String: binario reale (può differire da programmato)
      "circolante": true,                           // Booleano: true se treno attivo, false se soppresso
      "tipoTreno": {                                // Object: tipo treno riconosciuto dal backend
        "codice": "FR",                             // String: sigla breve (FR/FA/FB/IC/REG/ecc)
        "nome": "FR",                               // String: etichetta per visualizzazione
        "categoria": "high-speed"                  // String: categoria semantica (high-speed/intercity/regional/bus/unknown)
      }
    }
  ]
}
```

**Campi treno**:
- `numeroTreno` (Number): numero identificativo univoco del treno (es. 9544)
- `categoria` (String): categoria ufficiale RFI (FR, FA, FB, IC, ICN, REG, RV, R, ecc.)
- `origine` (String): nome stazione capolinea di partenza (maiuscolo)
- `destinazione` (String): nome stazione capolinea di arrivo (maiuscolo)
- `orarioPartenza` (Number): timestamp Unix in millisecondi (compatibile con `new Date()`)
- `orarioPartenzaLeggibile` (String): orario locale formato HH:mm (es. "16:55")
- `ritardo` (Number): ritardo in minuti
  - Valori positivi: treno in ritardo (es. 79 = 79 minuti di ritardo)
  - Valore 0: treno in orario
  - Valori negativi: treno in anticipo (es. -5 = 5 minuti di anticipo)
- `binarioProgrammato` (String): binario previsto dall'orario ufficiale (può essere null)
- `binarioEffettivo` (String): binario reale/aggiornato dove il treno parte effettivamente (può essere null o differire da programmato)
- `circolante` (Boolean): indica se il treno è attivo
  - `true`: treno circolante regolarmente
  - `false`: treno soppresso o cancellato
- `tipoTreno` (Object): tipo treno riconosciuto automaticamente dal backend
  - `codice` (String): sigla breve ufficiale (FR, FA, FB, IC, ICN, REG, RV, R, SUB, MET, ecc.)
  - `nome` (String): etichetta per visualizzazione (uguale a codice)
  - `categoria` (String): categoria semantica per styling UI
    - `high-speed`: Alta velocità (Frecce, Italo, TGV, Eurostar)
    - `intercity`: Intercity e lunga percorrenza (IC, ICN, EC, EN, FB)
    - `regional`: Regionali e suburbani (REG, RV, R, SUB, MET, FL)
    - `bus`: Bus sostitutivi
    - `unknown`: Non riconosciuto

---

## 4. Arrivi in stazione

Lista treni in arrivo in una stazione.

**Endpoint**: `GET /api/stations/arrivals`

**Parametri**:
- `stationCode` (string, obbligatorio): codice stazione
- `when` (string, opzionale): timestamp ISO o "now"

**Esempio**:
```bash
curl "https://treninfo.netlify.app/api/stations/arrivals?stationCode=S06421"
```

**Risposta**: stessa struttura di [Partenze](#3-partenze-da-stazione), con:
- `orarioArrivo` invece di `orarioPartenza`
- `orarioArrivoLeggibile` invece di `orarioPartenzaLeggibile`

---

## 5. Stato treno

Informazioni dettagliate su un treno specifico (percorso, fermate, ritardi).

**Endpoint**: `GET /api/trains/status`

**Parametri**:
- `trainNumber` (string, obbligatorio): numero treno
- `originCode` (string, opzionale): codice stazione origine (per disambiguare)
- `technical` (string, opzionale): ID tecnico completo
- `epochMs` (number, opzionale): timestamp riferimento

**Esempio**:
```bash
curl "https://treninfo.netlify.app/api/trains/status?trainNumber=9544"
```

**Risposta**:
```json
{
  "ok": true,                                       // Booleano: true se richiesta completata
  "numeroTreno": 9544,                              // Number: numero identificativo treno
  "origine": "SALERNO",                             // String: nome stazione capolinea partenza
  "codiceOrigine": "S09818",                        // String: codice RFI stazione origine
  "destinazione": "MILANO CENTRALE",                // String: nome stazione capolinea arrivo
  "ritardo": 79,                                    // Number: ritardo globale in minuti (calcolato)
  "stazioneAttuale": "FIRENZE SANTA MARIA NOVELLA", // String: nome fermata dove si trova ora il treno
  "codiceStazioneAttuale": "S06421",                // String: codice RFI fermata attuale
  "ultimoRilevamento": 1767805470000,               // Number: timestamp ultimo aggiornamento posizione (epoch ms)
  "tipoTreno": {                                    // Object: tipo treno riconosciuto
    "codice": "FR",                                 // String: sigla breve (FR/FA/FB/IC/REG/ecc)
    "nome": "FR",                                   // String: etichetta visualizzazione
    "categoria": "high-speed"                      // String: categoria (high-speed/intercity/regional/bus/unknown)
  },
  "stato": {                                        // Object: stato corsa corrente
    "codice": "RUNNING",                           // String: codice stato (PLANNED/RUNNING/COMPLETED/CANCELLED/PARTIAL/UNKNOWN)
    "descrizione": "In viaggio"                    // String: descrizione italiana stato
  },
  "fermate": [                                      // Array: lista tutte le fermate del percorso
    {
      "stazione": "SALERNO",                        // String: nome fermata
      "codiceStazione": "S09818",                   // String: codice RFI fermata
      "progressivo": 1,                             // Number: ordine fermata (1 = prima, 2 = seconda, ecc)
      "partenzaProgrammata": 1767740400000,         // Number: orario partenza previsto (epoch ms)
      "partenzaReale": 1767740400000,               // Number: orario partenza effettivo (null se non ancora partito)
      "ritardoPartenza": 0,                         // Number: ritardo partenza in minuti
      "binarioProgrammato": "2",                    // String: binario previsto (può essere null)
      "binarioEffettivo": "2"                       // String: binario effettivo (può essere null o differire)
    },
    {
      "stazione": "FIRENZE SANTA MARIA NOVELLA",
      "codiceStazione": "S06421",
      "progressivo": 5,                             // Number: quinta fermata nel percorso
      "arrivoProgrammato": 1767801000000,           // Number: orario arrivo previsto (epoch ms)
      "arrivoReale": 1767805470000,                 // Number: orario arrivo effettivo (null se non ancora arrivato)
      "ritardoArrivo": 74,                          // Number: ritardo arrivo in minuti
      "partenzaProgrammata": 1767801300000,         // Number: orario partenza previsto da questa fermata
      "partenzaReale": null,                        // Number|null: orario partenza effettivo (null = non ancora partito)
      "ritardoPartenza": 79,                        // Number: ritardo partenza previsto in minuti
      "binarioProgrammato": "8",                    // String: binario previsto
      "binarioEffettivo": "8",                      // String: binario effettivo
      "attuale": true                               // Booleano: true se è la fermata corrente del treno
    }
  ]
}
```

**Campi principali**:
- `numeroTreno` (Number): identificativo univoco del treno (es. 9544)
- `origine` (String): nome completo stazione capolinea di partenza (maiuscolo)
- `destinazione` (String): nome completo stazione capolinea di arrivo (maiuscolo)
- `codiceOrigine` (String): codice RFI della stazione di origine (formato Sxxxxx)
- `ritardo` (Number): ritardo globale corrente in minuti
  - Calcolato dal backend combinando dati RFI
  - Positivo = ritardo, 0 = in orario, negativo = anticipo
- `stazioneAttuale` (String): nome della fermata dove si trova attualmente il treno
  - Determinato dall'ultimo rilevamento RFI
  - null se treno non ancora partito o già arrivato
- `codiceStazioneAttuale` (String): codice RFI della fermata corrente (formato Sxxxxx)
- `ultimoRilevamento` (Number): timestamp Unix in millisecondi dell'ultimo aggiornamento posizione
  - Aggiornato automaticamente da RFI quando il treno transita/ferma
- `tipoTreno` (Object): tipo treno riconosciuto automaticamente (vedi [Dati computati](#7-dati-computati))
  - Analizza categoria, tipo, numero per determinare sigla e categoria
- `stato` (Object): stato corrente della corsa
  - `codice` (String): codice stato macchina-readable
    - `PLANNED`: Programmato (nessun orario reale ancora disponibile)
    - `RUNNING`: In viaggio (ha orari reali ma non è arrivato a destinazione)
    - `COMPLETED`: Completato (arrivato a destinazione finale)
    - `CANCELLED`: Soppresso (treno cancellato)
    - `PARTIAL`: Parziale (alcune fermate soppresse)
    - `UNKNOWN`: Sconosciuto (stato non determinabile)
  - `descrizione` (String): etichetta italiana leggibile per UI

**Campo `fermate`** (Array di Object):
Array ordinato di tutte le fermate del percorso del treno, dalla prima all'ultima.

- `stazione` (String): nome completo della fermata (maiuscolo, come fornito da RFI)
- `codiceStazione` (String): codice identificativo RFI della fermata (formato Sxxxxx)
- `progressivo` (Number): ordine della fermata nel percorso
  - 1 = prima fermata (origine)
  - Incrementa per ogni fermata successiva
  - Ultimo valore = fermata finale (destinazione)
- `arrivoProgrammato` (Number): timestamp Unix in millisecondi dell'orario arrivo previsto
  - null per la prima fermata (origine) che ha solo partenza
- `partenzaProgrammata` (Number): timestamp Unix in millisecondi dell'orario partenza previsto
  - null per l'ultima fermata (destinazione) che ha solo arrivo
- `arrivoReale` (Number|null): timestamp Unix in millisecondi dell'orario arrivo effettivo
  - null se il treno non è ancora arrivato a questa fermata
  - Aggiornato in tempo reale da RFI quando il treno arriva
- `partenzaReale` (Number|null): timestamp Unix in millisecondi dell'orario partenza effettivo
  - null se il treno non è ancora partito da questa fermata
  - Aggiornato in tempo reale da RFI quando il treno parte
- `ritardoArrivo` (Number): ritardo in minuti rispetto all'orario arrivo programmato
  - Calcolato come differenza tra arrivoReale e arrivoProgrammato
  - Positivo = ritardo, 0 = puntuale, negativo = anticipo
- `ritardoPartenza` (Number): ritardo in minuti rispetto all'orario partenza programmata
  - Calcolato come differenza tra partenzaReale e partenzaProgrammata  
  - Positivo = ritardo, 0 = puntuale, negativo = anticipo
- `binarioProgrammato` (String|null): binario previsto dall'orario ufficiale
  - null se non specificato o non disponibile
- `binarioEffettivo` (String|null): binario reale/aggiornato
  - null se non ancora assegnato
  - Può differire da binarioProgrammato in caso di cambi
- `attuale` (Boolean): indica se questa è la fermata corrente del treno
  - true solo per una fermata alla volta (dove il treno si trova ora)
  - false per tutte le altre fermate

**Disambiguazione** (se ci sono più corse con lo stesso numero):
Quando esistono più treni con lo stesso numero (es. corse giornaliere), il backend restituisce:

```json
{
  "ok": true,                                       // Booleano: richiesta completata
  "richiestaSelezione": true,                       // Booleano: true indica che serve disambiguazione
  "messaggio": "Trovati più treni con questo numero", // String: messaggio descrittivo per l'utente
  "opzioni": [                                      // Array: lista corse disponibili da scegliere
    {
      "etichetta": "9544 - SALERNO - 07/01/26",     // String: descrizione leggibile (numero - origine - data)
      "idTecnico": "9544-S09818-1767740400000",     // String: ID univoco corsa (formato: numero-codiceOrigine-timestamp)
      "codiceOrigine": "S09818",                    // String: codice RFI stazione origine
      "timestamp": 1767740400000                    // Number: timestamp partenza origine (epoch ms)
    }
  ]
}
```

Richiama l'API con `technical` per selezionare la corsa:
```bash
curl "https://treninfo.netlify.app/api/trains/status?trainNumber=9544&technical=9544-S09818-1767740400000"
```

---

## 6. Soluzioni di viaggio

Cerca soluzioni di viaggio tra due stazioni (combinazioni treni disponibili).

**Endpoint**: `GET /api/solutions`

**Parametri**:
- `fromName` (string): nome stazione partenza
- `toName` (string): nome stazione arrivo
- `date` (string, obbligatorio): data viaggio (YYYY-MM-DD)
- `time` (string, opzionale): ora viaggio (HH:mm)
- `adults` (number, default: 1): numero adulti
- `children` (number, default: 0): numero bambini
- `frecceOnly` (boolean): solo Frecce
- `regionalOnly` (boolean): solo regionali
- `intercityOnly` (boolean): solo Intercity
- `noChanges` (boolean): solo soluzioni dirette

**Esempio**:
```bash
curl "https://treninfo.netlify.app/api/solutions?fromName=Firenze&toName=Milano&date=2026-01-15&time=10:00"
```

**Risposta**:
```json
{
  "ok": true,                                       // Booleano: true se richiesta completata
  "idRicerca": "abc123xyz",                         // String: ID univoco ricerca (per eventuali richieste successive)
  "soluzioni": [                                    // Array: lista soluzioni viaggio trovate (ordinate per orario)
    {
      "durata": 125,                                // Number: durata totale viaggio in minuti
      "partenza": "10:05",                          // String: orario partenza primo treno (HH:mm)
      "arrivo": "12:10",                            // String: orario arrivo ultimo treno (HH:mm)
      "cambi": 0,                                   // Number: numero cambi necessari (0 = diretto)
      "treni": [                                    // Array: sequenza treni da prendere
        {
          "numeroTreno": "9524",                    // String: numero identificativo treno
          "categoria": "FR",                        // String: categoria treno (FR/FA/FB/IC/REG/ecc)
          "da": "Firenze S.M.N.",                   // String: stazione partenza questo treno
          "a": "Milano Centrale",                   // String: stazione arrivo questo treno
          "orarioPartenza": "10:05",                // String: orario partenza (HH:mm)
          "orarioArrivo": "12:10"                   // String: orario arrivo (HH:mm)
        }
      ]
    }
  ]
}
```

**Note soluzioni**:
- Le soluzioni sono ordinate cronologicamente (prima partenza → ultima partenza)
- Ogni soluzione può includere più treni se ci sono cambi
- `cambi: 0` indica viaggio diretto (un solo treno)
- `cambi: 1` indica un cambio (due treni), ecc.
- Applicando filtri (frecceOnly, regionalOnly, noChanges) si riducono le soluzioni

---

## 7. Dati computati

Il backend calcola automaticamente questi campi aggiuntivi:

### 🚄 Tipo treno (`tipoTreno`)

Oggetto computato automaticamente dal backend analizzando i seguenti campi RFI (in ordine di priorità):
1. `categoriaDescrizione` (es. " FR", " IC") — campo più affidabile
2. `categoria` (es. "FRECCIAROSSA", "INTERCITY") — nome categoria
3. `tipoTreno` (es. "FR", "REG") — tipo generico
4. `compNumeroTreno` (es. "FR 9544", "REG 12345") — numero completo con prefisso

**Struttura restituita**:
```json
{
  "codice": "FR",           // String: sigla breve ufficiale (2-4 caratteri)
  "nome": "FR",             // String: etichetta per visualizzazione (uguale a codice)
  "categoria": "high-speed" // String: categoria semantica per styling
}
```

**Categorie semantiche**:
- `high-speed`: Alta velocità e treni veloci
  - Include: Frecciarossa (FR), Frecciargento (FA), Italo (ITA), TGV, Eurostar (ES)
  - Caratteristiche: velocità >200 km/h, prenotazione obbligatoria, poche fermate
- `intercity`: Intercity e lunga percorrenza
  - Include: Frecciabianca (FB), Intercity (IC), Intercity Notte (ICN), Eurocity (EC), Euronight (EN), Railjet (RJ)
  - Caratteristiche: collegamenti interregionali/internazionali, prenotazione consigliata
- `regional`: Regionali e suburbani
  - Include: Regionale (REG), Regionale Veloce (RV), Regionale semplice (R), Suburbano (SUB), Metropolitano (MET), Malpensa Express (MXP), Leonardo Express (LEX), Ferrovie Laziali (FL)
  - Caratteristiche: servizio locale, fermate frequenti, biglietto libero
- `bus`: Bus sostitutivi
  - Include: Bus sostitutivi per tratte sospese o lavori in corso
- `unknown`: Non riconosciuto
  - Restituito quando nessuna regola matcha i dati disponibili

**Codici supportati** (40+):
- Alta velocità: FR, FA, ITA, TGV, ES, ESC
- Intercity: FB, IC, ICN, EC, EN, RJ
- Regionali: REG, RV, R, SUB, MET, MXP, LEX, FL, TEXP, CEXP, PEXP, DD, DIR, ACC
- Bus: BUS
- Altri: e molti altri riconosciuti automaticamente

### ⏱️ Ritardo globale (`ritardo`)

Valore numerico computato dal backend che rappresenta il ritardo corrente del treno.

**Logica di calcolo** (in ordine di priorità):
1. Campo `ritardo` da dati RFI (se disponibile) — valore diretto
2. Parsing di `compRitardo[0]` (se disponibile) — stringa tipo "Ritardo 15" → 15
3. Calcolo da differenza orari (arrivoReale - arrivoProgrammato) — fallback

**Valori possibili**:
- `> 0` (Number positivo): treno in ritardo
  - Esempio: `79` = 79 minuti di ritardo
  - Esempio: `5` = 5 minuti di ritardo
- `= 0` (Zero): treno in perfetto orario
  - Il treno sta rispettando gli orari previsti
- `< 0` (Number negativo): treno in anticipo
  - Esempio: `-3` = 3 minuti di anticipo
  - Raro ma possibile su alcune tratte
- `null`: ritardo non disponibile
  - Nessun dato RFI disponibile per calcolare il ritardo

**Note**:
- Il ritardo è sempre espresso in **minuti interi**
- Aggiornato in tempo reale da RFI ad ogni fermata
- Per i treni non ancora partiti, può essere 0 o basato su ritardi previsti
- Per i treni già arrivati, mostra il ritardo finale

### 📍 Stato corsa (`stato`)

Oggetto computato dal backend che indica lo stato corrente della corsa.

**Struttura restituita**:
```json
{
  "codice": "RUNNING",     // String: codice stato macchina-readable
  "descrizione": "In viaggio" // String: etichetta italiana per UI
}
```

**Logica di calcolo**:
Il backend analizza:
- Presenza di orari reali (partenzaReale, arrivoReale)
- Stato circolazione (circolante true/false)
- Timestamp corrente vs orari programmati
- Fermate soppresse

**Stati possibili**:

| Codice | Descrizione | Quando viene assegnato | Esempio |
|--------|-------------|------------------------|----------|
| `PLANNED` | Programmato | Nessun orario reale ancora disponibile. Il treno è nell'orario ma non è ancora partito dall'origine. | Treno delle 18:00, sono le 15:00 |
| `RUNNING` | In viaggio | Il treno ha almeno un orario reale (è partito) ma non è ancora arrivato alla destinazione finale. | Treno partito da Milano, attualmente a Bologna, destinazione Roma |
| `COMPLETED` | Completato | Il treno è arrivato alla destinazione finale (ultima fermata ha arrivoReale). | Treno arrivato a destinazione alle 12:30 |
| `CANCELLED` | Soppresso | Il treno è stato cancellato completamente (circolante = false per tutte le fermate). | Treno soppresso per sciopero |
| `PARTIAL` | Parziale | Alcune fermate sono soppresse ma il treno circola su parte del percorso. | Treno salta 3 fermate intermedie per lavori |
| `UNKNOWN` | Sconosciuto | Stato non determinabile dai dati RFI disponibili. | Dati incompleti o inconsistenti |

**Utilizzo**:
- `codice`: usare per logica condizionale nel codice
- `descrizione`: mostrare all'utente nell'interfaccia

### 🗺️ Fermata attuale (`currentStop`)

Oggetto computato che identifica dove si trova attualmente il treno.

**Struttura restituita** (nell'oggetto `computed` della risposta):
```json
{
  "stationName": "FIRENZE SANTA MARIA NOVELLA",  // String: nome fermata corrente
  "stationCode": "S06421",                        // String: codice RFI fermata
  "index": 4,                                     // Number: indice nell'array fermate (0-based)
  "timestamp": 1767805470000                      // Number: timestamp ultimo rilevamento (epoch ms)
}
```

**Logica di determinazione** (in ordine di priorità):
1. Campo `stazioneUltimoRilevamento` da RFI (se disponibile)
   - Dato ufficiale da sistemi di tracciamento RFI
   - Include timestamp preciso del rilevamento
2. Ultima fermata con `arrivoReale` o `partenzaReale` non null (fallback)
   - Cerca all'indietro nell'array fermate
   - Identifica l'ultima fermata dove il treno ha effettivamente transitato
3. null (se treno non ancora partito o dati insufficienti)

**Campi inclusi**:
- `stationName` (String): nome completo della stazione attuale (maiuscolo)
- `stationCode` (String): codice identificativo RFI (formato Sxxxxx)
- `index` (Number): posizione nell'array `fermate` (0 = prima fermata)
  - Utile per calcolare quante fermate mancano
  - Esempio: se index=4 e fermate.length=10, mancano 5 fermate
- `timestamp` (Number): momento esatto dell'ultimo rilevamento in millisecondi epoch
  - Aggiornato da RFI quando il treno arriva/parte dalla fermata
  - Può essere usato per calcolare "ultimo aggiornamento X minuti fa"

**Valori speciali**:
- Tutto l'oggetto è `null` se:
  - Il treno non è ancora partito dall'origine
  - Il treno è già arrivato a destinazione
  - Dati RFI insufficienti per determinare la posizione

**Note**:
- La fermata attuale si aggiorna automaticamente quando il treno transita
- Per fermate senza sosta (solo transito), timestamp indica il momento del passaggio
- Il campo `attuale: true` nell'array `fermate` corrisponde a questa fermata

---

## ⚙️ Formato risposte

Tutte le API restituiscono JSON con questa struttura:

```json
{
  "ok": true,
  "...": "dati specifici"
}
```

In caso di errore:
```json
{
  "ok": false,
  "errore": "Descrizione errore"
}
```

**Codici HTTP**:
- `200`: Richiesta completata con successo
- `400`: Parametri mancanti o non validi
- `500`: Errore del server

**Timestamp**: tutti gli epoch sono in millisecondi (compatibili con JavaScript `new Date(epoch)`)

---

## 📝 Note

- **Aggiornamento consigliato**: 60 secondi per stato treni
- **Timeout**: le richieste hanno timeout di 12 secondi
- **CORS**: abilitato per richieste cross-origin
- **Formato date**: ISO 8601 (YYYY-MM-DD) o epoch milliseconds
- **Nomi stazioni**: maiuscoli come forniti da RFI

---

**Documentazione aggiornata**: 7 gennaio 2026  
**Versione API**: 2.0 (con dati computati)

---

## Dati computati

Il backend calcola e aggiunge automaticamente questi campi:

### Tipo treno (`trainKind`)

Riconosciuto da:
- `categoriaDescrizione`
- `categoria`
- `tipoTreno`
- `compNumeroTreno`

**Categorie supportate**:
- `high-speed`: Frecciarossa, Frecciargento, Italo, TGV, Eurostar, ecc.
- `intercity`: Frecciabianca, Intercity, Eurocity, Euronight, Railjet, ecc.
- `regional`: Regionali, Suburbani, Metropolitani, Express regionali, ecc.
- `bus`: Bus sostitutivi
- `unknown`: Non riconosciuto

**Codici treno supportati**: FR, FA, FB, ITA, IC, ICN, EC, EN, TGV, RJ, REG, RV, R, SUB, MET, MXP, LEX, FL, BUS, e molti altri.

### Ritardo globale (`globalDelay`)

Estratto da:
1. Campo `ritardo` (priorità)
2. Parsing da `compRitardo[0]` (fallback)

Valori:
- `> 0`: ritardo in minuti
- `= 0`: in orario
- `< 0`: anticipo in minuti
- `null`: non disponibile

### Stato corsa (`journeyState`)

Stati possibili:
- **PLANNED**: Nessun orario reale ancora disponibile
- **RUNNING**: Treno in viaggio (ha orari reali ma non è ancora arrivato)
- **COMPLETED**: Treno arrivato a destinazione
- **CANCELLED**: Treno soppresso
- **PARTIAL**: Percorso parziale (fermate soppresse)
- **UNKNOWN**: Stato non determinabile

### Fermata attuale (`currentStop`)

Determinata da:
1. Campo `stazioneUltimoRilevamento` (priorità)
2. Ultima fermata con orario reale (fallback)

Include:
- Nome e codice stazione
- Indice nell'array fermate
- Timestamp ultimo rilevamento

---

## Convenzioni risposte

Tutte le API restituiscono JSON con struttura:
```json
{
  "ok": true | false,
  "data": {...},
  "error": "messaggio errore" // solo se ok: false
}
```

**Codici HTTP**:
- `200`: Success
- `400`: Bad request (parametri mancanti/invalidi)
- `500`: Server error

**Timestamp**: tutti gli epoch sono in **millisecondi** (JavaScript `Date.now()`)

---

## Note implementative

- **Refresh consigliato**: 60 secondi (TRAIN_AUTO_REFRESH_INTERVAL_MS)
- **Timeout fetch**: 12 secondi (FETCH_TIMEOUT_MS)
- **CORS**: configurabile via `CORS_ORIGINS` env var
- **Dati upstream**: da ViaggiaTreno (RFI) e LeFrecce (Trenitalia)
- **Robustezza**: retry automatici, offset temporali per snapshot treni, fallback multipli

---

Per dettagli implementativi, vedere:
- [src/app.js](src/app.js): logica backend e funzioni computate
- [script.js](script.js): logica frontend e rendering UI
- [rfi-viaggiatreno-api.md](rfi-viaggiatreno-api.md): documentazione chiamate RFI upstream
