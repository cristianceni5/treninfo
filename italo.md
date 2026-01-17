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

### Ricerca treni da stazione A a stazione B

- https://italoinviaggio.italotreno.com/api/RicercaTrattaService?Departure=SMN&Arrival=RMT

- - payload: SMN RMT sigle stazioni

### Recuperare tutte le sigle delle stazioni per vedere i treni Italo
