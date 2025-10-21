const cron = require('node-cron');
const meliService = require('../services/meli.service');
const vendasService = require('../services/vendas.service');
const anunciosService = require('../services/anuncios.service');
const stockService = require('../services/stock.service');
// Onde a lógica de observação e sincronização reside
const runSalesSync = async () => {
    console.log(`\n--- [OBSERVADOR] Iniciando verificação de vendas (${new Date().toLocaleTimeString()}) ---`);
    let access_token;
    
    try {

        const resposta = await meliService.authTest();
            if(!resposta){
                    console.log("Token Inválido. Gerando um novo...")
                    access_token = await meliService.getAuth();
            }
            else{
                    access_token = resposta;
            }


        const skusEAnuncios = await vendasService.syncVendas(access_token);
        //vendasDoDia = await meliService.getVendas(access_token);
            
        console.log(skusEAnuncios);
        //await vendasService.salvarVendas(vendasDoDia.results);
        if (skusEAnuncios.length === 0) {
            return console.log("[OBSERVADOR] Nenhuma nova venda a ser processada.");
        }
        
        console.log(skusEAnuncios);
        //AQUI VOU FAZER A ATUALIZACAO DE ESTOQUE

        //PRIMEIRO DESCOBRINDO SE FOI UMA VENDA UNITÁRIA OU NÃO
        for(const anuncio of skusEAnuncios){
            detalhesAnuncioQueVendeu = await anunciosService.getAnuncio(anuncio.ml_id);

            detalhesRodaQueVendeu = await stockService.getRoda(detalhesAnuncioQueVendeu);

            if(detalhesRodaQueVendeu.length > 0){


                if(!anuncio.isUnitario){

                    await stockService.subtrairJogoDeRoda(anuncio.sku);
                    
                    console.log('é jogo de roda');

                }
                else{

                    console.log('é unidade de roda');

                }


            }else{

                console.log(`${anuncio.sku} nao é roda`);

                
            }
            //console.log(detalhesAnuncioQueVendeu);
        }

        console.log("--- [OBSERVADOR] Sincronização de vendas concluída com sucesso. ---");
        
    } catch (error) {
        console.error("[OBSERVADOR] Erro fatal durante a sincronização de vendas/estoque:", error.message);
    }
};

// Configura o agendamento: Executa a cada 10 minutos
const startSalesScheduler = () => {
    // Cron expression: */10 * * * * (a cada 10 minutos)
    cron.schedule( '*/10 * * * * *', () => {
        runSalesSync();
    });
    console.log("Serviço de agendamento de vendas iniciado (a cada 10 minutos).");
};

// Você exportará isso e chamará no seu server.js
module.exports = {
    startSalesScheduler
};