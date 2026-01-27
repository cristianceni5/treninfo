# Chiamate API Italo

## Cerca stazione con autocomplete simile a RFI.

- https://api-biglietti.italotreno.com/api/v1/stations?pn=1&ps=30&sn=Roma&culture=it-IT&ds=&onlyitalo=true&exb=false

- classico autocomplete, usa questi payload: 

- - `` url
pn=1&ps=30&sn=Fir&culture=it-IT&ds=&onlyitalo=true&exb=false'
``

- - sn=Fir è la sigla che cerca nel server.

## Cerca treno dal numero

- https://italoinviaggio.italotreno.com/api/RicercaTrenoService?TrainNumber=8903

- - fatto bene porco dio, non come RFI.

- - payload: 8903 e basta per il numero del treno

## Ricerca treni da stazione A a stazione B

- https://italoinviaggio.italotreno.com/api/RicercaTrattaService?Departure=SMN&Arrival=RMT

- - payload: SMN RMT sigle stazioni per partenza e arrivo

## Ottenere i codici Italo delle stazioni

- Gli `italoCode` usati nelle chiamate alle partenze/arrivi sono salvati nella `italoCode` di `stazioni.json`.
- Puoi popolare quel campo con uno script (per esempio usando l'endpoint `api-biglietti.italotreno.com.../stations`) oppure cercare manualmente la stazione e copiare `stationCode`.
- Una volta che hai `italoCode`, usalo per interrogare le partenze/arrivi senza fare guess sulle sigle RFI.

## Partenze/arrivi da stazione (itinerario in tempo reale)

- https://italoinviaggio.italotreno.com/api/RicercaStazioneService?CodiceStazione=SMN

- - payload: `CodiceStazione` = `italoCode` della stazione (es. `RMT`, `RMO`, `T30`, ...).
- - la risposta include array `Departures` e `Arrivals` con i treni Italo previsti o in arrivo; puoi filtrare per numero treno, destinazione o stato.

### Recuperare tutte le sigle delle stazioni per vedere i treni Italo
