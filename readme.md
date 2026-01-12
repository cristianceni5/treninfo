# Treninfo Server

Backend leggero (Netlify Functions) che normalizza i dati di **ViaggiaTreno (RFI)** e **LeFrecce (Trenitalia)** e restituisce JSON “puliti” per l'app mobile Treninfo. Il riuso è **consentito** a patto di **menzionare** la fonte.

## Chiamate API (base path: `/api`)

- `GET /api/health`  
  Check rapido: DB stazioni caricato.

- `GET /api/stations/autocomplete?query=...`  
  Autocomplete locale usando `stations-viaggiatreno.json`.

- `GET /api/stations/info?stationName=...`  
  Info stazione + meteo (se disponibile).

- `GET /api/stations/departures?stationName=...&when=now`  
  Partenze normalizzate (stazioni canoniche, `tipoTreno`, orari, binari, ritardo).

- `GET /api/stations/arrivals?stationName=...&when=now`  
  Arrivi normalizzati.

- `GET /api/trains/status?trainNumber=...`  
  Stato treno normalizzato + fermate.  
  Se il numero è ambiguo ritorna `needsSelection` (usa `choice`/`originName`/`date`/`timestampRiferimento`).

- `GET /api/solutions?fromName=...&toName=...&date=YYYY-MM-DD&time=HH:mm`  
  Soluzioni viaggio LeFrecce (include `prezzo` quando disponibile).

## Esempi (curl)

```bash
curl "http://localhost:8888/api/stations/autocomplete?query=firen"
curl "https://treninfo.netlify.app/api/stations/departures?stationName=Firenze%20S.%20M.%20Novella&when=now"
curl "https://treninfo.netlify.app/api/trains/status?trainNumber=9544"
curl "https://treninfo.netlify.app/api/solutions?fromName=Firenze%20S.%20M.%20Novella&toName=Roma%20Termini&date=2026-01-13&time=10:00"
```

Nota: la pagina di test chiamate (`test-chiamate.html`) non è esposta in produzione.

## Crediti

- Upstream dati: ViaggiaTreno (RFI) e LeFrecce (Trenitalia)
- Runtime: Node.js, Express, Netlify Functions

### Sviluppato da Cristian Ceni

