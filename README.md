# Treninfo

_Treninfo_ è un **client non ufficiale** per le API di ViaggiaTreno/RFI, pensato per:

- consultare velocemente **andamento treno**, **ritardi**, **fermate**  
- visualizzare **tabelloni arrivi/partenze** per una stazione  
- offrire un’API “decente” (JSON pulito) da usare in altri progetti

Backend e frontend sono separati: il backend fa da **proxy** verso ViaggiaTreno, il frontend è una **web app** leggera, mobile–friendly, ospitata su Netlify.

> ⚠️ **Disclaimer**  
> Treninfo non è in alcun modo affiliato, sponsorizzato o approvato da Trenitalia, RFI o Gruppo FS.  
> Usa API non documentate, soggette a cambi improvvisi e rotture improvvise.

---

## Funzionalità

### 🔍 Ricerca treno

- Ricerca per **numero treno** (es. `23567`)
- Visualizzazione **andamento in tempo reale**:
  - orario programmato / effettivo
  - ritardo in minuti e stato testuale
  - fermate effettuate e future (con timeline grafica)
  - eventuali provvedimenti (soppresso, limitato, ecc.)

### 🚉 Stazioni

- Autocomplete stazioni (via endpoints ViaggiaTreno)
- Info stazione (tramite backend):
  - nome completo
  - regione
  - posizione (coordinate, se disponibili)
- Tabellone **partenze** e **arrivi**:
  - numero treno + categoria (REG, IC, FR, …)
  - destinazione / provenienza
  - orario
  - binario programmato/effettivo
  - ritardo

### 🧠 Backend “pulitore”

Il backend espone API “pulite” che:

- nascondono gli endpoint interni di ViaggiaTreno
- uniformano i formati (date, ritardi, binari, ecc.)
- sono pensate per essere consumate sia dal frontend web sia da altri client (es. un’app Unity)

---

## Architettura

### Panoramica

- **Frontend**:  
  - `index.html`, `script.js`, `style.css`  
  - nessun framework, solo HTML/CSS/JS vanilla  
  - chiama il backend tramite `fetch()` su endpoint REST

- **Backend**:
  - Node.js + Express
  - esposto come **Netlify Function** (proxy verso ViaggiaTreno)
  - si occupa di:
    - fare le richieste HTTP a ViaggiaTreno
    - interpretare JSON/HTML di risposta
    - restituire JSON pulito al frontend

Schema concettuale:

```text
Browser / Client (web o app)  --->  Treninfo API (Netlify / Express)  --->  ViaggiaTreno
                                         ↑
                                   normalizzazione,
                                  gestione errori, CORS
```
