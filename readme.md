# Treninfo — Informazioni treni in tempo reale

App web per consultare informazioni in tempo reale su treni e stazioni italiane.

**URL**: https://treninfo.netlify.app

---

## 📚 Documentazione API

**[API-DOCUMENTATION.md](API-DOCUMENTATION.md)** — Documentazione completa di tutte le chiamate API disponibili

---

## Funzionalità

- ✅ Cerca stazioni per nome
- ✅ Visualizza partenze/arrivi in tempo reale
- ✅ Traccia treni specifici con mappa itinerario
- ✅ Calcola ritardi e riconosce tipo treno automaticamente
- ✅ Trova soluzioni di viaggio

---

## Tecnologie

- **Frontend**: HTML, CSS, JavaScript vanilla
- **Backend**: Node.js, Express.js (Netlify Functions)
- **Dati**: RFI ViaggiaTreno, Trenitalia LeFrecce
- **Deploy**: Netlify

---

## Backend

Il backend (`src/app.js`) fornisce API REST che:

1. Recuperano dati da RFI/Trenitalia
2. Arricchiscono i dati con informazioni computate:
   - **Tipo treno**: riconosce automaticamente FR, IC, REG, ecc.
   - **Ritardo globale**: normalizza il ritardo in minuti
   - **Stato corsa**: determina se è programmato, in viaggio, completato, ecc.
   - **Fermata attuale**: identifica la posizione corrente del treno

### API disponibili

Vedi **[API-DOCUMENTATION.md](API-DOCUMENTATION.md)** per la documentazione completa.

Endpoint principali:
- `GET /api/viaggiatreno/autocomplete` - cerca stazioni
- `GET /api/stations/info` - info stazione
- `GET /api/stations/departures` - partenze
- `GET /api/stations/arrivals` - arrivi
- `GET /api/trains/status` - stato treno
- `GET /api/solutions` - soluzioni viaggio

---

## Sviluppo locale

```bash
# Installa dipendenze
npm install

# Avvia server sviluppo
npm run dev

# Apri browser
open http://localhost:8888
```

---

## Deploy

Deploy automatico su Netlify ad ogni push su `main`.

Configura variabili d'ambiente:
- `CORS_ORIGINS`: domini autorizzati (opzionale)

---

## Licenza

MIT
