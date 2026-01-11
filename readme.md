# 🚆 Treninfo — Informazioni Treni in Tempo Reale

![Status](https://img.shields.io/badge/status-online-brightgreen)
![Version](https://img.shields.io/badge/version-3.1-blue)
![License](https://img.shields.io/badge/license-MIT-green)

Applicazione web professionale per consultare informazioni in tempo reale su treni e stazioni italiane, con API REST complete e frontend intuitivo.

🌐 **App Live**: [https://treninfo.netlify.app](https://treninfo.netlify.app)

---

## ✨ Funzionalità Principali

### 🔍 Ricerca e Monitoraggio
- **Cerca Stazioni**: autocomplete intelligente con supporto ViaggiaTreno e LeFrecce
- **Tabelloni Stazione**: partenze e arrivi in tempo reale con aggiornamento automatico
- **Tracciamento Treni**: monitora treni specifici con dettaglio completo del viaggio

### 🗺️ Visualizzazione Avanzata
- **Timeline Viaggio**: visualizzazione grafica del progresso del treno
- **Dettaglio Fermate**: orari programmati, probabili ed effettivi per ogni fermata
- **Binari e Ritardi**: evidenziazione automatica cambi binario e ritardi

### 🎫 Pianificazione Viaggi
- **Ricerca Soluzioni**: trova combinazioni di treni tra due stazioni
- **Filtri Avanzati**: solo Frecce, regionali, diretti, con/senza cambi
- **Prezzi Minimi**: visualizzazione prezzi per categoria di treno
- **Dettaglio Tratte**: informazioni complete su ogni treno della soluzione

### 💾 Persistenza Dati
- **Treni Recenti**: storico ultimi 5 treni consultati
- **Scelte Salvate**: ricorda disambiguazioni per numeri treno multipli
- **Debug Raw JSON**: mostra il payload completo delle risposte sotto ogni sezione

---

## 🏗️ Architettura

### Frontend
- **Framework**: Vanilla JavaScript (ES6+)
- **Styling**: CSS3 moderno con variabili CSS
- **UI/UX**: Design responsive, mobile-first
- **Performance**: Lazy loading, debouncing, caching locale

### Backend (Netlify Functions)
- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **API**: REST con JSON
- **Fonti Dati**: 
  - RFI ViaggiaTreno (dati treni in tempo reale)
  - Trenitalia LeFrecce (soluzioni viaggio e prezzi)

### Deploy
- **Hosting**: Netlify
- **CI/CD**: Deploy automatico da GitHub
- **SSL**: HTTPS automatico
- **CDN**: Edge network globale

---

## 📚 Documentazione

### API REST
- **[API-DOCUMENTATION.md](docs/API-DOCUMENTATION.md)** — Documentazione completa delle API pubbliche
  - Tutti gli endpoint con esempi
  - Parametri dettagliati con tipi e validazioni
  - Struttura risposte JSON completa
  - Best practices implementazione
  - Gestione errori e codici HTTP

- **[API-BACKEND-OPTIMIZED.md](docs/API-BACKEND-OPTIMIZED.md)** — Documentazione backend tecnica
  - Dati computati e formattati
  - Pattern di utilizzo comuni
  - Esempi codice avanzati
  - Ottimizzazioni performance

### Endpoint Principali

```bash
# Base URL
https://treninfo.netlify.app

# Cerca stazioni
GET /api/viaggiatreno/autocomplete?query=FIREN

# Info stazione con meteo
GET /api/stations/info?stationCode=S06421

# Partenze in tempo reale
GET /api/stations/departures?stationCode=S06421

# Stato treno completo
GET /api/trains/status?trainNumber=9544

# Soluzioni viaggio
GET /api/solutions?fromName=Firenze&toName=Milano&date=2026-01-15&time=10:00
```

Vedi [documentazione completa](docs/API-DOCUMENTATION.md) per tutti i parametri e opzioni.

---

## 🚀 Quick Start

### Prerequisiti
- Node.js 18+ 
- npm o yarn

### Installazione

```bash
# Clone repository
git clone https://github.com/tuousername/cercatreni.git
cd cercatreni

# Installa dipendenze
npm install

# Avvia server sviluppo (Netlify Dev)
npm run dev
```

L'app sarà disponibile su `http://localhost:8888`

### Comandi Disponibili

```bash
npm run dev          # Avvia Netlify Dev (frontend + functions)
npm start            # Alias per npm run dev
npm test             # Esegue test
```

---

## 🔧 Configurazione

### Variabili d'Ambiente (opzionali)

Crea un file `.env` nella root:

```bash
# CORS - domini autorizzati (separati da virgola)
CORS_ORIGINS=https://tuodominio.com,http://localhost:3000

# Timeout chiamate API upstream (millisecondi)
FETCH_TIMEOUT_MS=12000
```

### File di Configurazione

- `netlify.toml` — Configurazione deploy Netlify
- `package.json` — Dipendenze e script npm
- `stations.json` — Database stazioni con mapping codici RFI/LeFrecce

---

## 📂 Struttura Progetto

```
CercaTreni/
├── index.html              # Pagina principale
├── script.js               # Logica frontend (6000+ righe)
├── styles.css              # Stili CSS
├── stations.json           # Database stazioni
├── netlify.toml            # Config Netlify
├── package.json            # Dipendenze
│
├── src/
│   └── app.js             # Backend Express (1850+ righe)
│
├── netlify/functions/
│   └── api.js             # Entry point Netlify Function
│
├── test/
│   ├── test-api.js        # Test API backend
│   └── test-train-kind.js # Test riconoscimento tipo treno
│
├── docs/
│   ├── API-DOCUMENTATION.md        # Doc API pubbliche
│   ├── API-BACKEND-OPTIMIZED.md    # Doc backend tecnica
│   └── RIEPILOGO.txt               # Note sviluppo
│
└── img/                   # Assets immagini
```

---

## 🎨 Caratteristiche Tecniche

### Frontend

**Gestione Stato**
- LocalStorage per persistenza dati
- Cache intelligente con TTL
- Debouncing per autocomplete (300ms)
- AbortController per cancellazione fetch

**Performance**
- Lazy loading componenti
- Virtual scrolling per liste lunghe
- Throttling aggiornamenti UI
- Refresh intelligente (60s solo per treni attivi)

**UI/UX**
- Design responsive (mobile-first)
- Icone SVG inline
- Animazioni CSS smooth
- Feedback visivo immediato
- Gestione errori user-friendly

### Backend

**Elaborazione Dati**
- Riconoscimento automatico tipo treno (40+ categorie)
- Calcolo ritardi e orari probabili
- Normalizzazione nomi stazioni
- Mapping codici RFI ↔ LeFrecce

**Ottimizzazioni**
- Timeout configurabile (default 12s)
- Retry logic per errori temporanei
- Caching headers appropriati
- Compressione GZIP automatica

**Dati Computati**
- `trainKind`: tipo e categoria treno
- `globalDelay`: ritardo numerico normalizzato
- `journeyState`: stato corsa (PLANNED/RUNNING/COMPLETED)
- `currentStop`: posizione corrente treno
- Orari formattati HH:mm pronti per display

---

## 🧪 Testing

```bash
# Test API backend
npm test

# Test specifici
node test/test-api.js
node test/test-train-kind.js
```

I test coprono:
- ✅ Riconoscimento tipo treno
- ✅ Calcolo ritardi
- ✅ Parsing orari
- ✅ Gestione errori API
- ✅ Normalizzazione nomi stazioni

---

## 🚀 Deploy

### Deploy Automatico (Netlify)

Ogni push su `main` triggera deploy automatico:

```bash
git add .
git commit -m "feat: nuova funzionalità"
git push origin main
```

### Deploy Manuale

```bash
# Installa Netlify CLI
npm install -g netlify-cli

# Login
netlify login

# Deploy
netlify deploy --prod
```

---

## 🔒 Sicurezza

- **CORS**: configurabile per domini specifici
- **Rate Limiting**: implementabile lato Netlify
- **Input Validation**: validazione parametri API
- **Error Handling**: nessun leak di informazioni sensibili
- **HTTPS**: SSL automatico su tutti gli endpoint

---

## 🐛 Troubleshooting

### API non risponde
```bash
# Verifica stato API RFI
curl http://www.viaggiatreno.it/infomobilita/resteasy/viaggiatreno/cercaNumeroTrenoTrenoAutocomplete/9544
```

### Errori CORS in sviluppo
Usa Netlify Dev invece di server locale semplice:
```bash
npm run dev  # Non python -m http.server
```

### Build fallisce
```bash
# Pulisci cache
rm -rf node_modules package-lock.json
npm install
```

---

## 🤝 Contribuire

I contributi sono benvenuti! Per contribuire:

1. Fai fork del repository
2. Crea branch per la feature (`git checkout -b feature/AmazingFeature`)
3. Commit modifiche (`git commit -m 'feat: Add AmazingFeature'`)
4. Push su branch (`git push origin feature/AmazingFeature`)
5. Apri Pull Request

### Convenzioni Commit
- `feat:` — nuova funzionalità
- `fix:` — correzione bug
- `docs:` — documentazione
- `style:` — formattazione
- `refactor:` — refactoring codice
- `test:` — test
- `chore:` — task manutenzione

---

## 📊 Statistiche

- **Righe codice**: ~8000
  - Frontend: ~6000 righe (script.js)
  - Backend: ~1850 righe (src/app.js)
  - Stili: ~800 righe (styles.css)
- **Stazioni supportate**: 2000+
- **Tipi treno riconosciuti**: 40+
- **Tempo medio risposta API**: <1s
- **Uptime**: 99.9% (Netlify)

---

## 🔮 Roadmap

- [ ] **v3.2**: Progressive Web App (PWA) con offline support
- [ ] **v3.3**: Grafici storici ritardi
- [ ] **v3.4**: Integrazione API prezzi biglietti
- [ ] **v3.5**: Share link treni con QR code
- [ ] **v3.6**: Modalità dark mode automatica
- [ ] **v4.0**: App mobile nativa (React Native)

---

## 📄 Licenza

Questo progetto è rilasciato sotto licenza **MIT**.

```
MIT License

Copyright (c) 2025 Cristian Ceni

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 👤 Autore

**Cristian Ceni**  
Sviluppato nel 2025, continua nel 2026 dhnnnn

---

## 🙏 Crediti

- Dati treni forniti da [RFI ViaggiaTreno](http://www.viaggiatreno.it/)
- Dati soluzioni viaggio da [Trenitalia LeFrecce](https://www.lefrecce.it/)
- Hosting e Functions by [Netlify](https://www.netlify.com/)

---

## 📞 Supporto

Per bug, richieste di funzionalità o domande:
- 🐛 [Issues GitHub](https://github.com/tuousername/cercatreni/issues)
- 📧 Email: tua@email.com
- 📖 [Documentazione completa](docs/API-DOCUMENTATION.md)

---

**⭐ Se ti piace questo progetto, lascia una stella su GitHub!**
