const cron = require('node-cron');
const meliService = require('../services/meli.service');
const vendasService = require('../services/vendas.service');
const anunciosService = require('../services/anuncios.service');
const stockService = require('../services/stock.service');
// Onde a lógica de observação e sincronização reside
const runSalesSync = async () => {
    console.log(`\n--- [OBSERVADOR] Iniciando verificação de vendas (${new Date().toLocaleTimeString()}) ---`);
    let access_token;
    const SKUs_DUAS_TALAS = [
        'M08ARO14675-114BD', 
        'M08ARO14675-114FBD',
        'M08ARO15785-114BD',
        'M08ARO15785-114FBD',
    ];
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
            
        
        //await vendasService.salvarVendas(vendasDoDia.results);
        if (skusEAnuncios.length === 0) {
            return console.log("[OBSERVADOR] Nenhuma nova venda a ser processada.");
        }
        
        console.log(skusEAnuncios);
        //AQUI VOU FAZER A ATUALIZACAO DE ESTOQUE

        //PRIMEIRO DESCOBRINDO SE FOI UMA VENDA UNITÁRIA OU NÃO
        for(const anuncio of skusEAnuncios){

            //baseado no ML_ID da venda, pegamos infos importantes do anúncio em que houve venda
            detalhesAnuncioQueVendeu = await anunciosService.getAnuncio(anuncio.ml_id);

            console.log(detalhesAnuncioQueVendeu);

            //Essa função pega as infos da roda dentro do estoque da distribuidora. Baseado nas infos do anuncio que capturamos anteriormente
            if(!SKUs_DUAS_TALAS.includes(detalhesAnuncioQueVendeu[0].sku)){

                detalhesRodaQueVendeu = await stockService.getRoda(detalhesAnuncioQueVendeu);

            } else {

                detalhesRodaQueVendeu = await stockService.getRodaDeVendaDuasTalas(detalhesAnuncioQueVendeu);

            }
            

            console.log(detalhesRodaQueVendeu);

            //Essa condição garante que estamos lidando com uma
            //venda que tem um SKU correspondente no estoque da distribuidora 
            if(detalhesRodaQueVendeu.length > 0){


                if(!anuncio.isUnitario){

                    //Primeiro Atualizar a quantidade disponível no estoque interno da distribuidora
                    if(!SKUs_DUAS_TALAS.includes(anuncio.sku)){
                        await stockService.subtrairRodasDoEstoque(anuncio.sku, anuncio.quantidade * 4);
                    }
                    else{
                        await stockService.subtrairRodasDeUmAnuncioDuasTalas(anuncio.sku, anuncio.quantidade * 4)
                    }
                    console.log('é jogo de roda');

                }
                else{

                    await stockService.subtrairRodasDoEstoque(anuncio.sku, anuncio.quantidade);

                    console.log('é unidade de roda');

                }

                    //Agora começar o processo para atualizar a quantidade em estoque nos anúncios

                    //Primeiro capturar todos os anúncios que tem aquele respectivo SKU
                    listaMLIDs = await anunciosService.getAnunciosBySku(anuncio.sku);

                    //console.log(listaMLIDs);

                    //E esse loop aqui é pra fazer a atualização em massa do estoque disponível já que não estamos
                    //fragmentando o estoque para cada anúncio. Todos os anúncios da mesma roda tem o mesmo estoque
                    for(const ML_ID of listaMLIDs){

                        const detalhesAnuncio = await anunciosService.getAnuncio(ML_ID.ml_id);

                        const detalhesEstoque = await stockService.getRoda(detalhesAnuncio);

                        const updatePayload = anunciosService.generateUpdatePayload(detalhesAnuncio, detalhesEstoque)
                        
                        await meliService.updateEstoqueAnuncio(detalhesAnuncio, access_token, updatePayload)

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
    cron.schedule( '*/10 * * * *', () => {
        runSalesSync();
    });
    console.log("Serviço de agendamento de vendas iniciado (a cada 10 minutos).");
};

// Você exportará isso e chamará no seu server.js
module.exports = {
    startSalesScheduler
};