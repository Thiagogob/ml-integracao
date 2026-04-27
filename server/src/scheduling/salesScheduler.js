const cron = require('node-cron');
const meliService = require('../services/meli.service');
const vendasService = require('../services/vendas.service');
const anunciosService = require('../services/anuncios.service');
const stockService = require('../services/stock.service');

const CROSS_STORE_ID = 2;
const CROSS_STORE_MAX_RETRIES = 3;
const store2RetryQueue = {}; // { [sku]: attemptsRemaining }

const pushSkuToStore2 = async (sku, tokenStr) => {
    const listaMLIDs = await anunciosService.getAnunciosBySkuForStore(sku, CROSS_STORE_ID);
    for (const { ml_id } of listaMLIDs) {
        const detalhesAnuncio = await anunciosService.getAnuncioForStore(ml_id, CROSS_STORE_ID);
        const detalhesEstoque = await stockService.getRoda(detalhesAnuncio);
        const updatePayload = anunciosService.generateUpdatePayload(detalhesAnuncio, detalhesEstoque);
        await meliService.updateEstoqueAnuncio(detalhesAnuncio, tokenStr, updatePayload, 1);
    }
};

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

        // Load store 2 token for cross-store updates (read-only; store 2 refreshes its own token)
        let store2TokenThisTick = await meliService.getStoredToken(CROSS_STORE_ID);
        let store2AuthFailedThisTick = false;

        // Process pending cross-store retries from previous ticks
        if (store2TokenThisTick) {
            for (const sku of Object.keys(store2RetryQueue)) {
                if (store2AuthFailedThisTick) break;
                try {
                    await pushSkuToStore2(sku, store2TokenThisTick);
                    delete store2RetryQueue[sku];
                    console.log(`[CROSS-STORE] Retry OK for SKU ${sku}.`);
                } catch (error) {
                    if (/Status 401/.test(error.message)) {
                        store2TokenThisTick = null;
                        store2AuthFailedThisTick = true;
                        store2RetryQueue[sku]--;
                        if (store2RetryQueue[sku] <= 0) {
                            delete store2RetryQueue[sku];
                            console.warn(`[CROSS-STORE] SKU ${sku} exhausted retries. Giving up.`);
                        } else {
                            console.warn(`[CROSS-STORE] 401 on retry for SKU ${sku} (${store2RetryQueue[sku]} left). Stopping cross-store this tick.`);
                        }
                    } else {
                        delete store2RetryQueue[sku];
                        console.warn(`[CROSS-STORE] Non-auth error on retry for SKU ${sku}. Discarding.`);
                    }
                }
            }
        }

        const skusEAnuncios = await vendasService.syncVendas(access_token);


        if (skusEAnuncios.length === 0) {
            return console.log("[OBSERVADOR] Nenhuma nova venda a ser processada.");
        }

        console.log(`[OBSERVADOR] ${skusEAnuncios.length} nova(s) venda(s) a processar.`);

        for(const anuncio of skusEAnuncios){

            //baseado no ML_ID da venda, pegamos infos importantes do anúncio em que houve venda
            detalhesAnuncioQueVendeu = await anunciosService.getAnuncio(anuncio.ml_id);

            //Essa função pega as infos da roda dentro do estoque da distribuidora. Baseado nas infos do anuncio que capturamos anteriormente
            if(!SKUs_DUAS_TALAS.includes(detalhesAnuncioQueVendeu[0].sku)){

                detalhesRodaQueVendeu = await stockService.getRoda(detalhesAnuncioQueVendeu);

            } else {

                detalhesRodaQueVendeu = await stockService.getRodaDeVendaDuasTalas(detalhesAnuncioQueVendeu);

            }

            //Essa condição garante que estamos lidando com uma
            //venda que tem um SKU correspondente no estoque da distribuidora
            if(detalhesRodaQueVendeu.length > 0){



                if(!anuncio.isUnitario){


                    await vendasService.preencherDisponibilidade(anuncio.id_venda, anuncio.sku, 4)
                    //Primeiro Atualizar a quantidade disponível no estoque interno da distribuidora
                    if(!SKUs_DUAS_TALAS.includes(anuncio.sku)){
                        await stockService.subtrairRodasDoEstoque(anuncio.sku, anuncio.quantidade * 4);
                    }
                    else{
                        await stockService.subtrairRodasDeUmAnuncioDuasTalas(anuncio.sku, anuncio.quantidade * 4)
                    }
                    console.log(`[OBSERVADOR] Venda processada: ${anuncio.sku} | jogo de roda | qtde: ${anuncio.quantidade}`);

                }
                else{


                    await vendasService.preencherDisponibilidade(anuncio.id_venda, anuncio.sku, 1)

                    await stockService.subtrairRodasDoEstoque(anuncio.sku, anuncio.quantidade);

                    console.log(`[OBSERVADOR] Venda processada: ${anuncio.sku} | unidade | qtde: ${anuncio.quantidade}`);

                }

                    //Agora começar o processo para atualizar a quantidade em estoque nos anúncios

                    //Primeiro capturar todos os anúncios que tem aquele respectivo SKU
                    listaMLIDs = await anunciosService.getAnunciosBySku(anuncio.sku);


                    //E esse loop aqui é pra fazer a atualização em massa do estoque disponível já que não estamos
                    //fragmentando o estoque para cada anúncio. Todos os anúncios da mesma roda tem o mesmo estoque
                    for(const ML_ID of listaMLIDs){

                        const detalhesAnuncio = await anunciosService.getAnuncio(ML_ID.ml_id);

                        const detalhesEstoque = await stockService.getRoda(detalhesAnuncio);

                        const updatePayload = anunciosService.generateUpdatePayload(detalhesAnuncio, detalhesEstoque)

                        await meliService.updateEstoqueAnuncio(detalhesAnuncio, access_token, updatePayload, 1)

                    }

                    // Push updated quantity to store 2's ML listings
                    if (store2TokenThisTick && !store2AuthFailedThisTick) {
                        try {
                            await pushSkuToStore2(anuncio.sku, store2TokenThisTick);
                            console.log(`[CROSS-STORE] Store 2 updated for SKU ${anuncio.sku}.`);
                        } catch (error) {
                            if (/Status 401/.test(error.message)) {
                                store2TokenThisTick = null;
                                store2AuthFailedThisTick = true;
                                if (!(anuncio.sku in store2RetryQueue)) {
                                    store2RetryQueue[anuncio.sku] = CROSS_STORE_MAX_RETRIES;
                                }
                                console.warn(`[CROSS-STORE] 401 for SKU ${anuncio.sku}. Enqueued for retry (${CROSS_STORE_MAX_RETRIES} attempts left).`);
                            }
                            // non-auth errors are transient noise; discard immediately
                        }
                    } else if (store2AuthFailedThisTick && !(anuncio.sku in store2RetryQueue)) {
                        store2RetryQueue[anuncio.sku] = CROSS_STORE_MAX_RETRIES;
                        console.log(`[CROSS-STORE] Auth failed this tick; enqueued SKU ${anuncio.sku} for retry.`);
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
