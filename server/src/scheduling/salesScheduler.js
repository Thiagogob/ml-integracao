const cron = require('node-cron');
const logger = require('../config/logger');
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
        if (detalhesEstoque.length === 0) continue; // anuncio sem nenhum SKU de roda: nao gerenciado
        const updatePayload = anunciosService.generateUpdatePayload(detalhesAnuncio, detalhesEstoque);
        await meliService.updateEstoqueAnuncio(detalhesAnuncio, tokenStr, updatePayload, 1);
    }
};

const runSalesSync = async () => {
    logger.info('observador: iniciando verificacao de vendas');
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
                    logger.info('token invalido, gerando novo token');
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
                    logger.info({ sku }, 'cross-store retry OK');
                } catch (error) {
                    if (/Status 401/.test(error.message)) {
                        store2TokenThisTick = null;
                        store2AuthFailedThisTick = true;
                        store2RetryQueue[sku]--;
                        if (store2RetryQueue[sku] <= 0) {
                            delete store2RetryQueue[sku];
                            logger.warn({ sku }, 'cross-store: SKU esgotou tentativas, desistindo');
                        } else {
                            logger.warn({ sku, attemptsLeft: store2RetryQueue[sku] }, 'cross-store: 401 no retry, parando neste tick');
                        }
                    } else {
                        delete store2RetryQueue[sku];
                        logger.warn({ sku }, 'cross-store: erro nao-auth no retry, descartando');
                    }
                }
            }
        }

        const skusEAnuncios = await vendasService.syncVendas(access_token);


        if (skusEAnuncios.length === 0) {
            logger.info('observador: nenhuma nova venda a processar');
            return;
        }

        logger.info({ count: skusEAnuncios.length }, 'observador: novas vendas a processar');

        const falhasML = [];

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
                    logger.info({ sku: anuncio.sku, tipo: 'jogo', quantidade: anuncio.quantidade }, 'venda processada');

                }
                else{


                    await vendasService.preencherDisponibilidade(anuncio.id_venda, anuncio.sku, 1)

                    await stockService.subtrairRodasDoEstoque(anuncio.sku, anuncio.quantidade);

                    logger.info({ sku: anuncio.sku, tipo: 'unidade', quantidade: anuncio.quantidade }, 'venda processada');

                }

                    //Agora começar o processo para atualizar a quantidade em estoque nos anúncios

                    //Primeiro capturar todos os anúncios que tem aquele respectivo SKU
                    listaMLIDs = await anunciosService.getAnunciosBySku(anuncio.sku);


                    //E esse loop aqui é pra fazer a atualização em massa do estoque disponível já que não estamos
                    //fragmentando o estoque para cada anúncio. Todos os anúncios da mesma roda tem o mesmo estoque
                    for(const ML_ID of listaMLIDs){

                        const detalhesAnuncio = await anunciosService.getAnuncio(ML_ID.ml_id);

                        const detalhesEstoque = await stockService.getRoda(detalhesAnuncio);

                        if (detalhesEstoque.length === 0) {
                            logger.info({ ml_id: ML_ID.ml_id }, 'anuncio sem nenhum SKU de roda no estoque: ignorando atualizacao');
                            continue;
                        }

                        const updatePayload = anunciosService.generateUpdatePayload(detalhesAnuncio, detalhesEstoque)

                        try {
                            await meliService.updateEstoqueAnuncio(detalhesAnuncio, access_token, updatePayload, 1)
                        } catch (mlError) {
                            falhasML.push({ sku: anuncio.sku, ml_id: ML_ID.ml_id, erro: mlError.message });
                        }

                    }

                    // Push updated quantity to store 2's ML listings
                    if (store2TokenThisTick && !store2AuthFailedThisTick) {
                        try {
                            await pushSkuToStore2(anuncio.sku, store2TokenThisTick);
                            logger.info({ sku: anuncio.sku }, 'cross-store: loja 2 atualizada');
                        } catch (error) {
                            if (/Status 401/.test(error.message)) {
                                store2TokenThisTick = null;
                                store2AuthFailedThisTick = true;
                                if (!(anuncio.sku in store2RetryQueue)) {
                                    store2RetryQueue[anuncio.sku] = CROSS_STORE_MAX_RETRIES;
                                }
                                logger.warn({ sku: anuncio.sku, maxRetries: CROSS_STORE_MAX_RETRIES }, 'cross-store: 401, enfileirado para retry');
                            }
                            // non-auth errors are transient noise; discard immediately
                        }
                    } else if (store2AuthFailedThisTick && !(anuncio.sku in store2RetryQueue)) {
                        store2RetryQueue[anuncio.sku] = CROSS_STORE_MAX_RETRIES;
                        logger.warn({ sku: anuncio.sku }, 'cross-store: auth falhou neste tick, enfileirado para retry');
                    }

            }else{

                logger.info({ sku: anuncio.sku }, 'SKU nao e roda, ignorando');


            }
            //console.log(detalhesAnuncioQueVendeu);
        }

        if (falhasML.length > 0) {
            logger.error({ falhas: falhasML }, `ATENCAO: ${falhasML.length} anuncio(s) nao atualizados no ML apos vendas - estoque pode estar desatualizado`);
        }

        logger.info('observador: sincronizacao de vendas concluida');

    } catch (error) {
        logger.error({ err: error }, 'observador: erro fatal na sincronizacao de vendas/estoque');
    }
};

// Configura o agendamento: Executa a cada 10 minutos
const startSalesScheduler = () => {
    // Cron expression: */10 * * * * (a cada 10 minutos)
    cron.schedule( '*/10 * * * *', () => {
        runSalesSync();
    });
    logger.info('servico de agendamento de vendas iniciado (a cada 10 minutos)');
};

// Você exportará isso e chamará no seu server.js
module.exports = {
    startSalesScheduler
};
