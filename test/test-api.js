// Script di test per verificare i nuovi campi formattati dell'API

const http = require('http');

function testTrain(trainNumber) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 3000,
      path: `/api/trains/status?trainNumber=${trainNumber}`,
      method: 'GET'
    };

    const req = http.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve(json);
        } catch (e) {
          reject(e);
        }
      });
    });
    
    req.on('error', reject);
    req.end();
  });
}

async function runTest() {
  console.log('='.repeat(60));
  console.log('TEST API BACKEND - CAMPI FORMATTATI');
  console.log('='.repeat(60));
  console.log();

  try {
    const response = await testTrain('9544');
    
    if (!response.ok) {
      console.log('❌ Errore API:', response.error || response.message);
      return;
    }

    const computed = response.computed;
    
    if (!computed) {
      console.log('❌ Campo computed non trovato nella risposta');
      return;
    }

    console.log('✅ INFORMAZIONI GENERALI');
    console.log('-'.repeat(60));
    console.log(`Tipologia Treno: ${computed.tipologiaTreno}`);
    console.log(`Numero Treno: ${computed.numeroTreno}`);
    console.log(`Origine: ${computed.origine}`);
    console.log(`Destinazione: ${computed.destinazione}`);
    console.log();

    console.log('✅ ORARI');
    console.log('-'.repeat(60));
    console.log(`Orario Partenza Programmato: ${computed.orarioPartenzaProg}`);
    console.log(`Orario Partenza Reale: ${computed.orarioPartenzaReale || 'Non ancora partito'}`);
    console.log(`Orario Arrivo Programmato: ${computed.orarioArrivoProg}`);
    console.log(`Orario Arrivo Reale: ${computed.orarioArrivoReale || 'Non ancora arrivato'}`);
    console.log();

    console.log('✅ STATO E RITARDO');
    console.log('-'.repeat(60));
    console.log(`Delta Tempo (Ritardo): ${computed.deltaTempo}`);
    console.log(`Stato Treno: ${computed.statoTreno}`);
    console.log();

    console.log('✅ POSIZIONE');
    console.log('-'.repeat(60));
    console.log(`Prossima Fermata: ${computed.prossimaFermata || 'N/A'}`);
    console.log(`Ora e Luogo Rilevamento: ${computed.oraLuogoRilevamento || 'N/A'}`);
    console.log();

    console.log('✅ MESSAGGI');
    console.log('-'.repeat(60));
    console.log(`Messaggio RFI: ${computed.messaggioRfi || 'Nessuno'}`);
    console.log(`Info Aggiuntive: ${computed.infoAgg || 'Nessuna'}`);
    console.log();

    console.log('✅ FERMATE');
    console.log('-'.repeat(60));
    console.log(`Numero Fermate: ${computed.fermate?.length || 0}`);
    
    if (computed.fermate && computed.fermate.length > 0) {
      console.log('\nPrime 3 fermate:');
      computed.fermate.slice(0, 3).forEach((fermata, i) => {
        console.log(`\n  ${i + 1}. ${fermata.stazione}`);
        console.log(`     Arrivo Programmato: ${fermata.orarioArrivoProgrammato || 'N/A'}`);
        console.log(`     Arrivo Probabile: ${fermata.orarioArrivoProbabile || 'N/A'}`);
        console.log(`     Arrivo Reale: ${fermata.orarioArrivoReale || 'N/A'}`);
        console.log(`     Partenza Programmata: ${fermata.orarioPartenzaProgrammato || 'N/A'}`);
        console.log(`     Partenza Probabile: ${fermata.orarioPartenzaProbabile || 'N/A'}`);
        console.log(`     Partenza Reale: ${fermata.orarioPartenzaReale || 'N/A'}`);
        console.log(`     Binario: ${fermata.binarioReale || fermata.binarioProgrammato || 'N/A'}`);
        console.log(`     Binario Variato: ${fermata.binarioVariato ? 'Sì' : 'No'}`);
        console.log(`     Soppressa: ${fermata.soppressa ? 'Sì' : 'No'}`);
      });
    }

    console.log();
    console.log('='.repeat(60));
    console.log('✅ TEST COMPLETATO CON SUCCESSO');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('❌ Errore durante il test:', error.message);
  }
}

runTest();
