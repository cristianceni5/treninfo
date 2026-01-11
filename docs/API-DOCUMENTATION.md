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

**Risposta** (struttura completa con dati formattati):
```json
{
  "ok": true,
  "originCode": "S09818",
  "technical": "9544-S09818",
  "referenceTimestamp": 1736524800000,
  "data": { /* dati grezzi RFI completi */ },
  
  "computed": {
    // === INFORMAZIONI TRENO ===
    "tipologiaTreno": "FR",                         // String: sigla tipo (FR/FA/IC/REG/ecc)
    "numeroTreno": "9544",                          // String: numero treno
    "origine": "SALERNO",                           // String: stazione capolinea partenza
    "destinazione": "MILANO CENTRALE",              // String: stazione capolinea arrivo
    
    // === ORARI PRINCIPALI ===
    "orarioPartenzaProg": "12:38",                  // String: orario partenza programmato (HH:mm)
    "orarioArrivoProg": "18:30",                    // String: orario arrivo programmato (HH:mm)
    
    // === RITARDO E STATO ===
    "deltaTempo": "+3",                             // String: ritardo (+3=ritardo, -2=anticipo, 0=orario)
    "statoTreno": "partito",                        // String: stato (programmato/partito/concluso/soppresso/parziale)
    
    // === POSIZIONE CORRENTE ===
    "prossimaFermata": "REGGIO EMILIA AV MEDIOPADANA", // String: prossima fermata prevista
    "oraLuogoRilevamento": "17:56-PM PC RUBIERA",   // String: ultimo rilevamento (HH:mm-AM/PM Stazione)
    
    // === MESSAGGI ===
    "messaggioRfi": "con un ritardo di 3 min.",     // String: messaggi ufficiali RFI
    "infoAgg": "Executive in testa in partenza da Reggio Emilia", // String: info composizione/servizi
    
    // === FERMATE (array completo) ===
    "fermate": [
      {
        "stazione": "SALERNO",                      // String: nome fermata
        "id": "S09818",                             // String: codice RFI fermata
        "progressivo": 1,                           // Number: ordine fermata nel percorso
        
        // Orari programmati (dall'orario ufficiale)
        "orarioArrivoProgrammato": null,            // String: orario arrivo previsto (HH:mm) - null per origine
        "orarioPartenzaProgrammato": "12:38",       // String: orario partenza previsto (HH:mm)
        
        // Orari probabili (calcolati: programmato + deltaTempo)
        "orarioArrivoProbabile": null,              // String: orario arrivo stimato (HH:mm)
        "orarioPartenzaProbabile": "12:41",         // String: orario partenza stimato (HH:mm)
        
        // Orari effettivi/reali (quando disponibili)
        "orarioArrivoReale": null,                  // String: orario arrivo effettivo (HH:mm) - null se non ancora arrivato
        "orarioPartenzaReale": "12:40",             // String: orario partenza effettivo (HH:mm) - null se non ancora partito
        
        // Binari
        "binarioProgrammato": "1",                  // String: binario previsto
        "binarioReale": "1",                        // String: binario effettivo
        "binarioVariato": false,                    // Boolean: true se binario cambiato
        
        // Stato
        "soppressa": false,                         // Boolean: true se fermata soppressa
        "tipoFermata": "P"                          // String: tipo fermata (P=partenza, A=arrivo, F=fermata)
      },
      {
        "stazione": "NAPOLI CENTRALE",
        "id": "S09218",
        "progressivo": 2,
        "orarioArrivoProgrammato": "13:30",         // Orario arrivo previsto
        "orarioPartenzaProgrammato": "13:35",       // Orario partenza previsto
        "orarioArrivoProbabile": "13:33",           // Orario arrivo stimato con ritardo
        "orarioPartenzaProbabile": "13:38",         // Orario partenza stimato con ritardo
        "orarioArrivoReale": "13:32",               // Orario arrivo effettivo (già transitato)
        "orarioPartenzaReale": "13:37",             // Orario partenza effettivo
        "binarioProgrammato": "20",
        "binarioReale": "20",
        "binarioVariato": false,
        "soppressa": false
      }
    ],
    
    // === DATI LEGACY (per compatibilità) ===
    "trainKind": {
      "code": "FR",
      "label": "FR",
      "category": "high-speed"
    },
    "globalDelay": 3,
    "journeyState": {
      "state": "RUNNING",
      "label": "In viaggio"
    },
    "currentStop": {
      "stationName": "PC RUBIERA",
      "stationCode": "S05106",
      "index": 5,
      "timestamp": 1736524560000
    }
  }
}
```

**Struttura campo `computed`**:

### Informazioni Generali
- `tipologiaTreno` (String): sigla tipo treno (FR/FA/FB/IC/REG/RV/ecc)
- `numeroTreno` (String): numero identificativo del treno
- `origine` (String): nome stazione capolinea partenza (maiuscolo)
- `destinazione` (String): nome stazione capolinea arrivo (maiuscolo)

### Orari Principali
- `orarioPartenzaProg` (String): orario partenza programmato in formato HH:mm (es. "12:38")
  - Estratto dalla prima fermata del percorso
- `orarioArrivoProg` (String): orario arrivo programmato in formato HH:mm (es. "18:30")
  - Estratto dall'ultima fermata del percorso

### Ritardo e Stato
- `deltaTempo` (String): ritardo formattato con segno
  - `"+3"` = 3 minuti di ritardo
  - `"-2"` = 2 minuti di anticipo
  - `"0"` = perfettamente in orario
  - `null` = non disponibile
- `statoTreno` (String): stato semplificato per visualizzazione
  - `"programmato"` = treno non ancora partito
  - `"partito"` = treno in viaggio
  - `"concluso"` = treno arrivato a destinazione
  - `"soppresso"` = treno completamente cancellato
  - `"parziale"` = treno con alcune fermate soppresse

### Posizione Corrente
- `prossimaFermata` (String): nome della prossima fermata prevista
  - Calcolata automaticamente dalla posizione corrente
  - Salta fermate soppresse
  - `null` se non ci sono fermate successive
- `oraLuogoRilevamento` (String): ultimo rilevamento formattato
  - Formato: `"HH:mm-AM/PM NomeStazione"` (es. "17:56-PM PC RUBIERA")
  - Include ora, periodo giornata e stazione
  - `null` se non disponibile

### Messaggi
- `messaggioRfi` (String): messaggi ufficiali da RFI
  - Include: soppressioni, motivazioni ritardi, comunicazioni
  - Può contenere testo multilingua
  - `null` se nessun messaggio
- `infoAgg` (String): informazioni aggiuntive sul treno
  - Composizione: "Executive in testa in partenza da Reggio Emilia"
  - Servizi: "Servizio di ristorazione disponibile"
  - Altre info operative
  - `null` se nessuna info

### Fermate (Array)
Array completo di tutte le fermate del percorso. Ogni fermata include:

**Identificazione**:
- `stazione` (String): nome completo fermata
- `id` (String): codice RFI fermata (formato Sxxxxx)
- `progressivo` (Number): ordine fermata (1 = prima, 2 = seconda, ecc)

**Orari Programmati** (dall'orario ufficiale):
- `orarioArrivoProgrammato` (String): orario arrivo previsto in HH:mm
  - `null` per la prima fermata (origine, solo partenza)
- `orarioPartenzaProgrammato` (String): orario partenza previsto in HH:mm
  - `null` per l'ultima fermata (destinazione, solo arrivo)

**Orari Probabili** (calcolati dal backend = programmato + deltaTempo):
- `orarioArrivoProbabile` (String): orario arrivo stimato con ritardo in HH:mm
- `orarioPartenzaProbabile` (String): orario partenza stimata con ritardo in HH:mm

**Orari Effettivi/Reali** (quando disponibili):
- `orarioArrivoReale` (String): orario arrivo effettivo in HH:mm
  - `null` se il treno non è ancora arrivato a questa fermata
  - Aggiornato in tempo reale da RFI
- `orarioPartenzaReale` (String): orario partenza effettivo in HH:mm
  - `null` se il treno non è ancora partito da questa fermata
  - Aggiornato in tempo reale da RFI

**Binari**:
- `binarioProgrammato` (String): binario previsto dall'orario ufficiale
- `binarioReale` (String): binario effettivo/aggiornato
- `binarioVariato` (Boolean): `true` se il binario è cambiato rispetto al programmato

**Stato**:
- `soppressa` (Boolean): `true` se questa fermata è stata soppressa
- `tipoFermata` (String): tipo fermata (P=partenza, A=arrivo, F=fermata, S=soppressa)

### Dati Legacy (per compatibilità con codice esistente)
- `trainKind` (Object): informazioni tipo treno formato legacy
- `globalDelay` (Number): ritardo in minuti (formato numerico)
- `journeyState` (Object): stato corsa formato legacy
- `currentStop` (Object): fermata attuale formato legacy

---

**Note importanti**:
1. **Tutti gli orari sono in formato HH:mm** per facile visualizzazione (es. "12:38", "18:30")
2. **Gli orari probabili sono già calcolati dal backend** sommando deltaTempo agli orari programmati
3. **Gli orari effettivi/reali sono disponibili solo dopo che il treno ha transitato** dalla fermata
4. **Per visualizzare l'orario più aggiornato**, usa questa priorità:
   - Mostra `orarioReale` se disponibile (dato effettivo)
   - Altrimenti mostra `orarioProbabile` (stima con ritardo)
   - Altrimenti mostra `orarioProgrammato` (orario ufficiale)

**Campi principali**:
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

**Note**:
- Tutti gli orari nel campo `computed` sono formattati in **HH:mm** (es. "12:38")
- I timestamp nei campi `data` grezzi sono in millisecondi Unix (compatibili con `new Date()`)
- I nomi stazioni sono in maiuscolo come forniti da RFI

---

## 📝 Best Practices

### Visualizzazione orari fermate
Per mostrare l'orario più accurato possibile, usa questa priorità:

```javascript
const orarioMostrato = fermata.orarioPartenzaReale || 
                        fermata.orarioPartenzaProbabile || 
                        fermata.orarioPartenzaProgrammato;
```

1. **Orario reale** (se disponibile): dato effettivo confermato da RFI
2. **Orario probabile** (se no reale): stima calcolata con il ritardo corrente
3. **Orario programmato** (fallback): orario ufficiale dall'orario

### Aggiornamento consigliato
- **Stato treni**: 60 secondi (1 minuto)
- **Partenze/Arrivi**: 30-60 secondi
- **Soluzioni viaggio**: on-demand (non necessita refresh)

### Gestione errori
- Timeout richieste: 12 secondi
- In caso di errore 500, ritenta dopo 5-10 secondi
- Se `ok: false`, mostra il campo `errore` all'utente

---

---

## 📖 Riferimento Rapido Parametri JSON

### Tipi di Dati

Tutti i parametri nelle risposte JSON seguono questi tipi:

| Tipo | Descrizione | Esempio |
|------|-------------|---------|
| **String** | Testo (sempre tra virgolette) | `"FIRENZE S.M.N."` |
| **Number** | Numero intero o decimale | `79`, `43.776893` |
| **Boolean** | Valore vero/falso | `true`, `false` |
| **Null** | Valore assente/non disponibile | `null` |
| **Object** | Oggetto con più proprietà | `{"codice": "FR", "nome": "FR"}` |
| **Array** | Lista di valori | `[1, 2, 3]` o `[{...}, {...}]` |
| **Timestamp** | Numero millisecondi dal 1970 | `1767801300000` |

### Valori Speciali

**Null vs Undefined vs Stringa Vuota**:
- `null`: campo presente ma valore non disponibile (es. binario non ancora assegnato)
- `undefined`: campo non presente nella risposta (non dovrebbe accadere)
- `""` (stringa vuota): campo presente con valore vuoto (usato raramente)

**Timestamp**:
- Formato: millisecondi Unix (epoch time)
- Conversione JavaScript: `new Date(timestamp)`
- Esempio: `1767801300000` → `2026-01-07T15:55:00.000Z`

**Formati Orari**:
- `HH:mm`: formato 24 ore con zero-padding (es. `"09:05"`, `"14:30"`, `"23:59"`)
- Sempre ora locale italiana (Europe/Rome timezone)

**Codici Stazione**:
- Formato: `S` seguito da 5 cifre (es. `"S06421"`)
- Codice univoco RFI per ogni stazione italiana

---

## 🔍 Parametri Dettagliati per Endpoint

### GET /api/viaggiatreno/autocomplete

**Query Parameters**:
```
?query=FIREN
```

| Parametro | Tipo | Obbligatorio | Validazione | Descrizione |
|-----------|------|--------------|-------------|-------------|
| `query` | String | Sì | min 2 caratteri | Testo da cercare (case-insensitive) |

**Response Body**:
```json
{
  "ok": Boolean,        // true se successo, false se errore
  "data": Array<Object> // array stazioni trovate (vuoto se nessun match)
}
```

**Oggetto Stazione nell'array**:
```json
{
  "nome": String,      // Nome completo (MAIUSCOLO)
  "codice": String     // Codice RFI (formato Sxxxxx)
}
```

---

### GET /api/stations/info

**Query Parameters**:
```
?stationCode=S06421
```

| Parametro | Tipo | Obbligatorio | Formato | Descrizione |
|-----------|------|--------------|---------|-------------|
| `stationCode` | String | Sì | Sxxxxx | Codice stazione RFI |

**Response Body**:
```json
{
  "ok": Boolean,              // true se successo
  "codiceStazione": String,   // codice richiesto (Sxxxxx)
  "nome": String,             // nome ufficiale (MAIUSCOLO)
  "nomeBreve": String,        // nome abbreviato visualizzazione
  "latitudine": Number,       // coordinate GPS gradi decimali
  "longitudine": Number,      // coordinate GPS gradi decimali
  "regione": String          // codice regione italiana (1-20)
}
```

**Range Valori**:
- `latitudine`: da 35.5 a 47.5 (Italia continentale + isole)
- `longitudine`: da 6.5 a 18.5 (Italia continentale + isole)
- `regione`: String numerica da "1" a "20" (codici regioni ISTAT)

---

### GET /api/stations/departures

**Query Parameters**:
```
?stationCode=S06421&when=now
```

| Parametro | Tipo | Obbligatorio | Formato | Default | Descrizione |
|-----------|------|--------------|---------|---------|-------------|
| `stationCode` | String | Sì | Sxxxxx | - | Codice stazione |
| `when` | String | No | ISO 8601 o "now" | "now" | Timestamp riferimento |

**Response Body**:
```json
{
  "ok": Boolean,                // true se successo
  "codiceStazione": String,     // codice richiesto
  "data": String,               // timestamp ISO riferimento
  "treni": Array<Object>        // array treni in partenza
}
```

**Oggetto Treno nell'array**:
```json
{
  "numeroTreno": Number,                  // numero treno (>0)
  "categoria": String,                    // sigla ufficiale
  "origine": String,                      // stazione capolinea partenza
  "destinazione": String,                 // stazione capolinea arrivo
  "orarioPartenza": Number,              // timestamp epoch ms
  "orarioPartenzaLeggibile": String,     // formato HH:mm
  "ritardo": Number,                      // minuti (+ ritardo, - anticipo)
  "binarioProgrammato": String|null,     // binario previsto
  "binarioEffettivo": String|null,       // binario reale
  "circolante": Boolean,                  // true=attivo, false=soppresso
  "tipoTreno": {
    "codice": String,                     // sigla breve (2-4 char)
    "nome": String,                       // etichetta display
    "categoria": String                   // high-speed|intercity|regional|bus|unknown
  }
}
```

**Range e Validazioni**:
- `numeroTreno`: intero positivo da 1 a 99999
- `ritardo`: intero da -60 a 999 (minuti)
- `categoria`: String con categorie RFI valide
- `binarioProgrammato/binarioEffettivo`: String numerica o alfanumerica (es. "1", "12", "4 Ovest")

---

### GET /api/stations/arrivals

Stessi parametri di `/api/stations/departures`, ma con:
- `orarioArrivo` invece di `orarioPartenza`
- `orarioArrivoLeggibile` invece di `orarioPartenzaLeggibile`

---

### GET /api/trains/status

**Query Parameters**:
```
?trainNumber=9544&originCode=S09818&technical=9544-S09818&epochMs=1736524800000
```

| Parametro | Tipo | Obbligatorio | Formato | Descrizione |
|-----------|------|--------------|---------|-------------|
| `trainNumber` | String | Sì | 1-5 cifre | Numero treno da cercare |
| `originCode` | String | No | Sxxxxx | Codice stazione origine (disambigua) |
| `technical` | String | No | numero-codice | ID tecnico completo |
| `epochMs` | Number | No | timestamp | Timestamp riferimento millisecondi |

**Response Body Root**:
```json
{
  "ok": Boolean,                  // true se successo
  "originCode": String,           // codice origine usato
  "technical": String,            // ID tecnico (numeroTreno-originCode)
  "referenceTimestamp": Number,   // timestamp riferimento epoch ms
  "data": Object,                 // dati grezzi completi da RFI
  "computed": Object              // dati elaborati e formattati dal backend
}
```

**Oggetto `computed` (dettaglio completo)**:

```typescript
{
  // === IDENTIFICAZIONE ===
  "tipologiaTreno": String,           // Sigla tipo (FR/FA/IC/REG/ecc)
  "numeroTreno": String,              // Numero treno (anche con prefisso)
  "origine": String,                  // Nome stazione partenza
  "destinazione": String,             // Nome stazione arrivo
  
  // === ORARI PRINCIPALI ===
  "orarioPartenzaProg": String,       // Partenza programmata HH:mm
  "orarioArrivoProg": String,         // Arrivo programmato HH:mm
  
  // === STATO E RITARDO ===
  "deltaTempo": String|null,          // Ritardo con segno: "+3", "-2", "0"
  "statoTreno": String,               // programmato|partito|concluso|soppresso|parziale
  
  // === POSIZIONE ===
  "prossimaFermata": String|null,     // Nome prossima fermata
  "oraLuogoRilevamento": String|null, // Formato: "HH:mm-AM/PM Stazione"
  
  // === MESSAGGI ===
  "messaggioRfi": String|null,        // Comunicazioni ufficiali RFI
  "infoAgg": String|null,             // Info composizione/servizi
  
  // === FERMATE (array completo) ===
  "fermate": Array<{
    // Identificazione
    "stazione": String,               // Nome fermata
    "id": String,                     // Codice RFI (Sxxxxx)
    "progressivo": Number,            // Ordine (1, 2, 3...)
    
    // Orari programmati (dall'orario)
    "orarioArrivoProgrammato": String|null,   // HH:mm
    "orarioPartenzaProgrammato": String|null, // HH:mm
    
    // Orari probabili (prog + deltaTempo)
    "orarioArrivoProbabile": String|null,     // HH:mm
    "orarioPartenzaProbabile": String|null,   // HH:mm
    
    // Orari effettivi (quando disponibili)
    "orarioArrivoReale": String|null,         // HH:mm
    "orarioPartenzaReale": String|null,       // HH:mm
    
    // Binari
    "binarioProgrammato": String|null,        // Binario previsto
    "binarioReale": String|null,              // Binario effettivo
    "binarioVariato": Boolean,                // true se cambiato
    
    // Stato
    "soppressa": Boolean,                     // true se soppressa
    "tipoFermata": String                     // P|A|F|S
  }>,
  
  // === LEGACY (compatibilità) ===
  "trainKind": {
    "code": String,
    "label": String,
    "category": String
  },
  "globalDelay": Number,                // Ritardo numerico (minuti)
  "journeyState": {
    "state": String,                    // PLANNED|RUNNING|COMPLETED|CANCELLED|PARTIAL
    "label": String                     // Etichetta italiana
  },
  "currentStop": {
    "stationName": String,              // Nome stazione attuale
    "stationCode": String,              // Codice stazione
    "index": Number,                    // Indice in array fermate
    "timestamp": Number                 // Timestamp rilevamento (epoch ms)
  } | null
}
```

**Tipi Fermata**:
- `P`: Partenza (prima fermata del percorso)
- `A`: Arrivo (ultima fermata del percorso)
- `F`: Fermata intermedia
- `S`: Soppressa

**Stati Treno**:
- `programmato`: non ancora partito
- `partito`: in viaggio
- `concluso`: arrivato a destinazione
- `soppresso`: cancellato completamente
- `parziale`: alcune fermate soppresse

---

### GET /api/solutions

**Query Parameters**:
```
?fromName=Firenze&toName=Milano&date=2026-01-15&time=10:00&adults=1&children=0&frecceOnly=false
```

| Parametro | Tipo | Obbligatorio | Formato | Default | Descrizione |
|-----------|------|--------------|---------|---------|-------------|
| `fromName` | String | Sì | testo | - | Nome stazione partenza |
| `toName` | String | Sì | testo | - | Nome stazione arrivo |
| `date` | String | Sì | YYYY-MM-DD | - | Data viaggio |
| `time` | String | No | HH:mm | ora attuale | Ora partenza |
| `adults` | Number | No | 1-9 | 1 | Numero adulti |
| `children` | Number | No | 0-9 | 0 | Numero bambini |
| `frecceOnly` | Boolean | No | true/false | false | Solo Frecce |
| `regionalOnly` | Boolean | No | true/false | false | Solo regionali |
| `intercityOnly` | Boolean | No | true/false | false | Solo Intercity |
| `noChanges` | Boolean | No | true/false | false | Solo diretti |

**Response Body**:
```json
{
  "ok": Boolean,                  // true se successo
  "idRicerca": String,            // ID univoco ricerca
  "soluzioni": Array<{
    "durata": Number,             // durata totale minuti
    "partenza": String,           // orario partenza HH:mm
    "arrivo": String,             // orario arrivo HH:mm
    "cambi": Number,              // numero cambi (0=diretto)
    "treni": Array<{
      "numeroTreno": String,      // numero treno
      "categoria": String,        // FR/IC/REG/ecc
      "da": String,               // stazione partenza
      "a": String,                // stazione arrivo
      "orarioPartenza": String,   // HH:mm
      "orarioArrivo": String      // HH:mm
    }>
  }>
}
```

**Validazioni Parametri**:
- `date`: non può essere nel passato
- `adults + children`: minimo 1, massimo 9
- Filtri mutuamente esclusivi: solo uno tra frecceOnly/regionalOnly/intercityOnly

---

## 🔧 Gestione Errori e Codici HTTP

### Struttura Risposta Errore

```json
{
  "ok": false,
  "errore": "Descrizione errore leggibile"
}
```

### Codici HTTP

| Codice | Significato | Quando | Azione Suggerita |
|--------|-------------|--------|-------------------|
| **200** | OK | Richiesta completata con successo | Processa i dati |
| **400** | Bad Request | Parametri mancanti o non validi | Controlla parametri richiesta |
| **404** | Not Found | Risorsa non trovata | Verifica codici stazione/numero treno |
| **500** | Server Error | Errore interno server o API RFI | Ritenta dopo 5-10 secondi |
| **503** | Service Unavailable | API RFI non disponibile | Ritenta dopo 30 secondi |
| **504** | Gateway Timeout | Timeout chiamata RFI (>12s) | Ritenta con timeout maggiore |

### Errori Comuni

**400 - Parametri mancanti**:
```json
{
  "ok": false,
  "errore": "Parametro 'query' obbligatorio (min 2 caratteri)"
}
```

**400 - Parametri non validi**:
```json
{
  "ok": false,
  "errore": "Il parametro 'stationCode' deve essere nel formato Sxxxxx"
}
```

**404 - Risorsa non trovata**:
```json
{
  "ok": false,
  "errore": "Treno 9999999 non trovato"
}
```

**500 - Errore interno**:
```json
{
  "ok": false,
  "errore": "Errore nel recupero dati da RFI"
}
```

**504 - Timeout**:
```json
{
  "ok": false,
  "errore": "Timeout chiamata API ViaggiaTreno (>12s)"
}
```

---

## 💡 Best Practices Implementazione

### 1. Gestione Null e Valori Assenti

Controlla sempre i valori null prima di usarli:

```javascript
// ❌ SBAGLIATO - può crashare
const binario = treno.binarioEffettivo.toString();

// ✅ CORRETTO
const binario = treno.binarioEffettivo ?? treno.binarioProgrammato ?? "N/D";
```

### 2. Parsing Timestamp

Usa sempre `Number()` per conversioni sicure:

```javascript
// ✅ CORRETTO
const date = new Date(Number(fermata.timestamp));

// Controlla validità
if (Number.isFinite(fermata.timestamp) && fermata.timestamp > 0) {
  const date = new Date(fermata.timestamp);
}
```

### 3. Formattazione Orari

Gli orari in `computed` sono già formattati:

```javascript
// ✅ GIÀ PRONTO
console.log(computed.orarioPartenzaProg); // "12:38"

// ❌ NON SERVE RIFORMATTARE
// const formatted = formatTime(computed.orarioPartenzaProg);
```

### 4. Priorità Orari Fermate

Usa questa logica per mostrare l'orario più accurato:

```javascript
function getOrarioPiuAccurato(fermata, tipo = 'partenza') {
  const field = tipo === 'arrivo' ? 'Arrivo' : 'Partenza';
  return fermata[`orario${field}Reale`] ||      // 1. Dato effettivo
         fermata[`orario${field}Probabile`] ||  // 2. Stima con ritardo
         fermata[`orario${field}Programmato`];  // 3. Orario ufficiale
}
```

### 5. Gestione Ritardi

Il ritardo è sempre un numero o null:

```javascript
function formattaRitardo(ritardo) {
  if (ritardo === null || ritardo === undefined) return "N/D";
  if (ritardo === 0) return "In orario";
  if (ritardo > 0) return `+${ritardo} min`;
  return `${ritardo} min`; // già negativo
}
```

### 6. Tipo Treno e Styling

Usa la categoria per applicare stili diversi:

```javascript
function getTrainColor(tipoTreno) {
  switch (tipoTreno.categoria) {
    case 'high-speed': return '#E60000'; // Rosso Frecciarossa
    case 'intercity':  return '#006699'; // Blu Intercity
    case 'regional':   return '#009933'; // Verde Regionale
    case 'bus':        return '#FF9900'; // Arancione Bus
    default:           return '#999999'; // Grigio
  }
}
```

### 7. Refresh Intelligente

Implementa refresh automatico solo quando necessario:

```javascript
// Refresh ogni 60 secondi solo per treni in viaggio
if (computed.journeyState.state === 'RUNNING') {
  setInterval(() => fetchTrainStatus(trainNumber), 60000);
}

// Nessun refresh per treni completati o soppressi
```

### 8. Cache Locale

Salva dati stazioni per evitare chiamate ripetute:

```javascript
const stationsCache = new Map();

async function getStation(code) {
  if (stationsCache.has(code)) {
    return stationsCache.get(code);
  }
  
  const data = await fetch(`/api/stations/info?stationCode=${code}`);
  stationsCache.set(code, data);
  return data;
}
```

### 9. Gestione Binari Variati

Evidenzia binari cambiati:

```javascript
function getBinarioDisplay(fermata) {
  const binario = fermata.binarioReale ?? fermata.binarioProgrammato ?? "N/D";
  const variato = fermata.binarioVariato;
  
  return {
    testo: binario,
    variato: variato,
    classe: variato ? 'binario-cambiato' : 'binario-normale'
  };
}
```

### 10. Fermate Soppresse

Filtra o evidenzia fermate soppresse:

```javascript
// Mostra solo fermate attive
const fermateAttive = computed.fermate.filter(f => !f.soppressa);

// O evidenzia soppresse
function getFermataClasse(fermata) {
  if (fermata.soppressa) return 'fermata-soppressa';
  if (fermata.tipoFermata === 'P') return 'fermata-partenza';
  if (fermata.tipoFermata === 'A') return 'fermata-arrivo';
  return 'fermata-intermedia';
}
```

---

## 🎯 Esempi Pratici Completi

### Esempio 1: Card Treno Completa

```javascript
async function renderTrainCard(trainNumber) {
  const response = await fetch(`/api/trains/status?trainNumber=${trainNumber}`);
  const { ok, computed } = await response.json();
  
  if (!ok) {
    return '<div class="error">Treno non trovato</div>';
  }
  
  const ritardoText = computed.deltaTempo 
    ? `Ritardo: ${computed.deltaTempo} min`
    : 'In orario';
    
  const statoClass = computed.journeyState.state.toLowerCase();
  const trainColor = getTrainColor(computed.trainKind);
  
  return `
    <div class="train-card ${statoClass}">
      <div class="train-header" style="border-left: 4px solid ${trainColor}">
        <span class="train-type">${computed.tipologiaTreno}</span>
        <span class="train-number">${computed.numeroTreno}</span>
      </div>
      <div class="train-route">
        <div>${computed.origine}</div>
        <div class="arrow">→</div>
        <div>${computed.destinazione}</div>
      </div>
      <div class="train-times">
        <span>Partenza: ${computed.orarioPartenzaProg}</span>
        <span>Arrivo: ${computed.orarioArrivoProg}</span>
      </div>
      <div class="train-status ${computed.deltaTempo > 0 ? 'delayed' : ''}">
        ${ritardoText}
      </div>
      ${computed.prossimaFermata 
        ? `<div class="next-stop">Prossima: ${computed.prossimaFermata}</div>`
        : ''}
    </div>
  `;
}
```

### Esempio 2: Tabella Fermate Interattiva

```javascript
function renderStopsTable(fermate) {
  return `
    <table class="stops-table">
      <thead>
        <tr>
          <th>Fermata</th>
          <th>Arrivo</th>
          <th>Partenza</th>
          <th>Binario</th>
          <th>Stato</th>
        </tr>
      </thead>
      <tbody>
        ${fermate.map(fermata => {
          const arrivo = getOrarioPiuAccurato(fermata, 'arrivo') || '-';
          const partenza = getOrarioPiuAccurato(fermata, 'partenza') || '-';
          const binario = getBinarioDisplay(fermata);
          
          return `
            <tr class="${getFermataClasse(fermata)}">
              <td class="station-name">${fermata.stazione}</td>
              <td class="time ${fermata.orarioArrivoReale ? 'actual' : ''}">${arrivo}</td>
              <td class="time ${fermata.orarioPartenzaReale ? 'actual' : ''}">${partenza}</td>
              <td class="platform ${binario.classe}">${binario.testo}</td>
              <td class="status">
                ${fermata.soppressa 
                  ? '<span class="badge suppressed">Soppressa</span>' 
                  : '<span class="badge active">Attiva</span>'}
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
}
```

### Esempio 3: Ricerca Soluzioni con Filtri

```javascript
async function searchSolutions(params) {
  const queryParams = new URLSearchParams({
    fromName: params.from,
    toName: params.to,
    date: params.date,
    time: params.time || '00:00',
    adults: params.adults || 1,
    children: params.children || 0,
    frecceOnly: params.onlyHighSpeed || false,
    regionalOnly: params.onlyRegional || false,
    noChanges: params.directOnly || false
  });
  
  const response = await fetch(`/api/solutions?${queryParams}`);
  const { ok, soluzioni } = await response.json();
  
  if (!ok || !soluzioni || soluzioni.length === 0) {
    return '<div class="no-results">Nessuna soluzione trovata</div>';
  }
  
  return soluzioni.map(sol => `
    <div class="solution-card">
      <div class="solution-times">
        <span class="departure">${sol.partenza}</span>
        <span class="duration">${Math.floor(sol.durata / 60)}h ${sol.durata % 60}m</span>
        <span class="arrival">${sol.arrivo}</span>
      </div>
      <div class="solution-changes">
        ${sol.cambi === 0 
          ? '<span class="badge direct">Diretto</span>' 
          : `<span class="badge changes">${sol.cambi} cambio/i</span>`}
      </div>
      <div class="solution-trains">
        ${sol.treni.map((treno, idx) => `
          <div class="train-segment">
            ${idx > 0 ? '<span class="change-icon">⟳</span>' : ''}
            <span class="train-category">${treno.categoria}</span>
            <span class="train-number">${treno.numeroTreno}</span>
            <span class="train-route">${treno.da} → ${treno.a}</span>
            <span class="train-times">${treno.orarioPartenza} - ${treno.orarioArrivo}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}
```

---

**Documentazione aggiornata**: 11 gennaio 2026  
**Versione API**: 3.1 (con riferimento completo parametri JSON)

---

## 📚 Risorse Aggiuntive

Per approfondimenti tecnici:
- [API-BACKEND-OPTIMIZED.md](API-BACKEND-OPTIMIZED.md): dettagli implementazione backend
- [src/app.js](src/app.js): codice sorgente backend completo
- [script.js](script.js): esempi implementazione frontend

**Supporto**:
- Segnalazioni bug: controllare console browser per errori JavaScript
- API RFI non disponibile: verificare stato servizi su viaggiatreno.it
- Timeout: aumentare FETCH_TIMEOUT_MS nelle variabili ambiente
