const { Token, Venda } = require('../config/database');
const logger = require('../config/logger');
const { QueryTypes } = require('sequelize');
require('dotenv').config();
const anunciosService = require('../services/anuncios.service');
const stockService = require('../services/stock.service');
const failuresService = require('../services/failures.service');

const DEBUG_SKU = 'M17ARO174-1004-108HD';
let _debugTrace = [];
const dbg = (msg) => { _debugTrace.push(msg); logger.debug({ sku: DEBUG_SKU }, msg); };

// ML IDs being watched for diagnostic — search "[DEBUG-ANUNCIO]" in Railway logs
const DEBUG_ML_IDS = new Set(['MLB6082884922', 'MLB6082770068']);
const dbgML = (ml_id, stage, data = {}) => {
    logger.warn({ ...data, ml_id, stage, tag: 'DEBUG-ANUNCIO' }, `[DEBUG-ANUNCIO] ${stage} | ml_id=${ml_id}`);
};

const SELLER_ID = process.env.SELLER_ID;
const SECRET_KEY = process.env.SECRET_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const APP_ID = process.env.APP_ID;
const STORE_ID = parseInt(process.env.STORE_ID, 10);
const DELAY_MS = 500;
const INITIAL_RETRY_DELAY_MS = 2000; // 2 segundos
const MAX_RETRIES = 12; // Limita a 3 tentativas totais

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getAuth = async () => {
    try {
        // 1. Obtém o refresh_token do banco de dados usando a função 'all'
        const tokenRecord = await Token.findOne({ where: { store_id: STORE_ID } });


        if (!tokenRecord || !tokenRecord.refresh_token) {
            throw new Error("Refresh Token não encontrado no banco de dados.");
        }

        const refresh_token_antigo = tokenRecord.refresh_token;

        //console.log("Refresh Token Antigo = ", refresh_token_antigo);

        // 2. Prepara e faz a requisição para a API do Mercado Livre
        const url_principal = "https://api.mercadolibre.com/oauth/token";
        const headers = {
            "accept": "application/json",
            "content-type": "application/x-www-form-urlencoded"
        };

        const dados = new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: APP_ID,
            client_secret: SECRET_KEY,
            refresh_token: refresh_token_antigo,
        });

        const resposta = await fetch(url_principal, {
            method: 'POST',
            headers: headers,
            body: dados
        });

        // Verifica se a resposta foi bem-sucedida
        if (!resposta.ok) {
            throw new Error(`Erro ao obter novos tokens: ${resposta.statusText}`);
        }

        const resposta_json = await resposta.json();

        //console.log("Refresh token novo = ", resposta_json.refresh_token);



        
        await Token.update(
            {
                refresh_token: resposta_json.refresh_token,
                access_token: resposta_json.access_token
            },
            {
                where: { store_id: STORE_ID }
            }
        );

        logger.info('tokens ML atualizados com sucesso');

        // 4. Retorna o novo access_token
        return resposta_json.access_token;

    } catch (err) {
        logger.error({ err }, 'erro ao obter/atualizar tokens ML');
        throw err; // Lança o erro para que o controller o capture
    }
};



const authTest = async () => {
   try {
        // 1. Busca o token usando o Modelo. O método findOne retorna o objeto Token.
        const resultado = await Token.findOne({ where: { store_id: STORE_ID } });
        
        // Se o resultado for nulo (tabela vazia), o Sequelize retorna null.
        if (!resultado || !resultado.access_token) {
            logger.error('tokens nao encontrados no banco de dados');
            return false;
        }

        // O valor do token é acessado diretamente pelas propriedades do objeto Sequelize
        const access_token = resultado.access_token;

        const url_teste = "https://api.mercadolibre.com/users/me";
        const headers = { "Authorization": `Bearer ${access_token}` };

        const resposta = await fetch(url_teste, {
            method: 'GET',
            headers: headers,
        });

        if (resposta.status === 200) {
            logger.info('token ML ainda valido');
            return access_token;
        } else if (resposta.status === 401) {
            logger.info('token ML invalido');
            return false;
        } else {
            // Lança um erro para status inesperados
            throw new Error(`Erro inesperado ao testar o token: ${resposta.status}`);
        }
    } catch (err) {
        logger.error({ err }, 'erro ao testar autenticacao ML');
        throw err;
    }
};



const getVendas = async (access_token) => {
    
    let todasAsVendas = [];
    let offset = 0;
    let limit=50;
    
    // Configura o início e o fim do dia
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const endOfToday = new Date();
    endOfToday.setHours(23, 59, 59, 999);

    const formattedStart = startOfToday.toISOString();
    const formattedEnd = endOfToday.toISOString();

    const headers = {
        "Authorization": `Bearer ${access_token}`
    };

    let totalVendasApi = 0;

    // Loop principal para a paginação
    while (true) {
        
        // Constrói a URL com os parâmetros de paginação
        const url = `https://api.mercadolibre.com/orders/search?seller=${SELLER_ID}&order.date_created.from=${formattedStart}&order.date_created.to=${formattedEnd}&offset=${offset}&limit=${limit}`;
        
   

        try {
            const resposta = await fetch(url, {
                method: 'GET',
                headers: headers
            });

            if (!resposta.ok) {
                // Lidar com erros de requisição, como 401 (não autorizado)
                throw new Error(`Erro na requisição: ${resposta.status}`);
            }

            const resposta_json = await resposta.json();


            const vendasDaPagina = resposta_json.results;
            
            // Define o total de vendas na primeira iteração
            if (offset === 0) {
                totalVendasApi = resposta_json.paging.total;
            }

            // Adiciona as vendas da página atual ao array principal
            if (vendasDaPagina && vendasDaPagina.length > 0) {
                todasAsVendas = todasAsVendas.concat(vendasDaPagina);
                offset += limit;
            }
            

            // Se o total de vendas coletadas for igual ou maior que o total da API, sai do loop
            if (todasAsVendas.length >= totalVendasApi) {
                //console.log("PARADA: Condição de parada atingida. Saindo do loop.");
                break;
                
            }

        } catch (error) {
            logger.error({ err: error }, 'erro ao buscar vendas ML');
            // Lança o erro para que o controller o capture
            throw error;
        }
    }

    // Retorna o objeto com todas as vendas para a rota
    return { results: todasAsVendas };
};




// A função refatorada para usar o fluxo 'scan'
const getIdsAnuncios = async (access_token) => {
    
    
    let todosOsAnuncios = [];
    

    const limit = 50; 

    const headers = {
        "Authorization": `Bearer ${access_token}`
    };

    let scroll_id = null; // O scroll_id será atualizado a cada requisição
    let totalAnunciosApi = 0; // Para acompanhamento do progresso

    try {
        // --- 1. Primeira Chamada: Inicia o Scan e Obtém o 1º scroll_id e 1ª página ---
        
        let url = `https://api.mercadolibre.com/users/${SELLER_ID}/items/search?search_type=scan&limit=${limit}`; 
        
        let resposta = await fetch(url, {
            method: 'GET',
            headers: headers
        });

        if (!resposta.ok) {
            throw new Error(`Erro na requisição inicial: ${resposta.status}`);
        }

        let resposta_json = await resposta.json();
        
        // Configura o total e o primeiro scroll_id
        totalAnunciosApi = resposta_json.paging.total || 0;
        scroll_id = resposta_json.scroll_id;
        
        logger.info({ totalAnunciosApi }, 'total de anuncios a buscar');
        
        // Adiciona a primeira página de resultados
        if (resposta_json.results && resposta_json.results.length > 0) {
            todosOsAnuncios = todosOsAnuncios.concat(resposta_json.results);
            //console.log(`1ª página capturada. Total até agora: ${todosOsAnuncios.length}`);
        }

        // --- 2. Loop: Continua a Busca usando o scroll_id ---
        
        // Continua enquanto houver um scroll_id válido para a próxima página
        while (scroll_id) { 
            
            // Se o total for 0 ou já tivermos capturado tudo, saímos
            if (totalAnunciosApi > 0 && todosOsAnuncios.length >= totalAnunciosApi) {
                break;
            }
            
            // URL com o scroll_id da requisição anterior
            url = `https://api.mercadolibre.com/users/${SELLER_ID}/items/search?search_type=scan&limit=${limit}&scroll_id=${scroll_id}`;

            resposta = await fetch(url, {
                method: 'GET',
                headers: headers
            });

            if (!resposta.ok) {
                throw new Error(`Erro na requisição com scroll_id: ${resposta.status}`);
            }

            resposta_json = await resposta.json();
            
            const anunciosDaPagina = resposta_json.results;
            
            // 3. Condição de Parada: Se a página estiver vazia, o scan acabou.
            if (!anunciosDaPagina || anunciosDaPagina.length === 0) {
                break;
            }
            
            // Adiciona a página atual de resultados
            todosOsAnuncios = todosOsAnuncios.concat(anunciosDaPagina);
            
            // ATUALIZA o scroll_id para a próxima iteração
            scroll_id = resposta_json.scroll_id;
            
            //console.log(`Próxima página capturada. Total até agora: ${todosOsAnuncios.length}`);
        }

    } catch (error) {
        logger.error({ err: error }, 'erro no scan de anuncios ML');
        throw error;
    }
    
    logger.info({ total: todosOsAnuncios.length }, 'busca de IDs de anuncios finalizada');
    
    return { results: todosOsAnuncios };
}






const getDetalhesAnuncios = async (anuncioIds, access_token) => {
    let todosOsDetalhes = [];
    const BATCH_SIZE = 20;
    const IS_TESTING = false; 

    const headers = {
        "Authorization": `Bearer ${access_token}`
    };

    if (IS_TESTING) {
        const headers = {
            "Authorization": `Bearer ${access_token}`
        };
        const url_teste = `https://api.mercadolibre.com/items?include_attributes=all&ids=MLB4648973900`;

        try {
            const resposta = await fetch(url_teste, {
                method: 'GET',
                headers: headers
            });

            if (!resposta.ok) {
                throw new Error(`Erro na requisição de teste: ${resposta.status} - ${resposta.statusText}`);
            }
            
            const resposta_json = await resposta.json();
            
            // Retorna o JSON completo da resposta para que você possa inspecioná-lo
            // O `map(item => item.body)` garante que você obtenha o conteúdo do objeto
            return resposta_json.map(item => item.body);

        } catch (error) {
            logger.error({ err: error }, 'erro na requisicao de teste ML');
            throw error;
        }
    }
    else{
    // 1. Divide os IDs em lotes de 20
    const lotes = [];
    for (let i = 0; i < anuncioIds.length; i += BATCH_SIZE) {
        lotes.push(anuncioIds.slice(i, i + BATCH_SIZE));
    }
    
    logger.info({ lotes: lotes.length }, 'iniciando busca de detalhes de anuncios');

    
    // 2. Processa cada lote de forma assíncrona
    // Usa Promise.all para fazer as requisições em paralelo, o que é muito mais rápido
    const promessasLotes = lotes.map(lote => {
        const idsString = lote.join(',');
        const url = `https://api.mercadolibre.com/items?include_attributes=all&ids=${idsString}`;
        
        // This is the new retry logic for each fetch call
        const maxRetries = 3;
        let retries = 0;
        
        const executeFetchWithRetry = async () => {
            try {
                const resposta = await fetch(url, {
                    method: 'GET',
                    headers: headers
                });
                
                if (!resposta.ok) {
                    throw new Error(`Erro na requisição em lote: ${resposta.status} - ${resposta.statusText}`);
                }
                
                return resposta.json();
            } catch (error) {
                if (retries < maxRetries && error.cause && error.cause.code === 'UND_ERR_CONNECT_TIMEOUT') {
                    retries++;
                    logger.warn({ retries, maxRetries }, 'timeout na requisicao ML, retentando');
                    await new Promise(resolve => setTimeout(resolve, 2000)); 
                    return executeFetchWithRetry(); 
                } else {
                    throw error; 
                }
            }
        };
        
        return executeFetchWithRetry();
    });


        try {
            const resultadosLotes = await Promise.all(promessasLotes);

            // 3. Junta os resultados de todos os lotes
            resultadosLotes.forEach(lote => {
                if (Array.isArray(lote)) {
                    todosOsDetalhes = todosOsDetalhes.concat(lote.map(item => item.body));
                }
            });

            logger.info({ total: todosOsDetalhes.length }, 'detalhes de anuncios capturados');

            return todosOsDetalhes.map(anuncio => {
                let skus = []; // O SKU agora é um array
                let marca = null;

                // Lógica para encontrar o SKU
                // Tenta encontrar SKUs em todas as variações
                if (anuncio.variations && anuncio.variations.length > 0) {
                    anuncio.variations.forEach(variation => {
                        if (variation.attributes && Array.isArray(variation.attributes)) {
                            const skuAttribute = variation.attributes.find(attr => attr.id === 'SELLER_SKU');
                            if (skuAttribute) {
                                skus.push({
                                    id: variation.id, // Captura o ID da variação
                                    sku: skuAttribute.value_name,
                                    quantidade: variation.available_quantity

                                });
                            }
                        }
                    });
                }

                // Se a array de SKUs ainda estiver vazia, tenta encontrar o SKU no array principal de atributos (fallback)
                if (skus.length === 0 && anuncio.attributes && Array.isArray(anuncio.attributes)) {
                    const skuAttribute = anuncio.attributes.find(attr => attr.id === 'SELLER_SKU');
                    if (skuAttribute) {
                        skus.push({
                            id: anuncio.id, // Usa o ID do anúncio como referência
                            sku: skuAttribute.value_name,
                            quantidade: anuncio.available_quantity
                        });
                    }
                }

                // Lógica para encontrar a Marca (inalterada)
                if (anuncio.attributes && Array.isArray(anuncio.attributes)) {
                    const marcaAttribute = anuncio.attributes.find(attr => attr.id === 'BRAND');
                    if (marcaAttribute) {
                        marca = marcaAttribute.value_name;
                    }
                }

                return {
                    id: anuncio.id,
                    titulo: anuncio.title,
                    categoria: anuncio.listing_type_id,
                    marca: marca,
                    skus: skus // Retorna a array de SKUs
                };
            });

        } catch (error) {
            logger.error({ err: error }, 'erro ao buscar detalhes dos anuncios');
            throw error;
        }
    }
};

const updateEstoqueAnuncio = async (detalhesAnuncio, access_token, updatePayload, attempt = 1) => {
    
    
    const mlItemId = detalhesAnuncio[0].ml_id
    //anuncio.ml_id;
    const url = `https://api.mercadolibre.com/items/${mlItemId}`;

    const headers = {
        "Authorization": `Bearer ${access_token}`,
        "Content-Type": "application/json",
        "Accept": "application/json"
    };


    let payload;
    let isSimpleUpdate = false;



    if(!Array.isArray(updatePayload)){
        

        isSimpleUpdate = true;

        payload = updatePayload
        //console.log("payload simples: ");
        //console.log(payload);
    } else {
        payload = {
            variations: updatePayload
        }
        //console.log("payload variations: ");
        //console.log(updatePayload);
    }
    // 2. Cria o payload no formato exigido pelo Mercado Livre
    //const payload = {
    //    variations: updatePayload
    //};

  

    // 3. Executa a requisição PUT
    const resposta = await fetch(url, {
        method: 'PUT',
        headers: headers,
        body: JSON.stringify(payload)
    });

    const respostaJson = await resposta.json();
    const statusCode = resposta.status;
    const isValidationError = statusCode === 400 && respostaJson.error === 'validation_error';

    if (!resposta.ok) {

        if (isValidationError && respostaJson.cause?.some(c => c.cause_id === 201)) {
             logger.warn({ mlItemId }, 'ML API 400: validacao de imagem falhou, pulando anuncio');
             return { status: 400, message: 'Image validation bypassed.', respostaML: respostaJson, payloadEnviado: payload };
        }

        if (statusCode === 409) {
            logger.warn({ mlId: detalhesAnuncio[0].ml_id }, 'ML API 409: conflito de concorrencia ignorado');
            return { status: 409, message: 'Conflict ignored.', respostaML: respostaJson, payloadEnviado: payload }; // Retorna sucesso silencioso
        }

        if (statusCode === 429 && attempt < MAX_RETRIES) {
                const retryDelay = INITIAL_RETRY_DELAY_MS * attempt; // 2s, 4s, 6s, etc.
                
                logger.warn({ mlItemId, attempt, maxRetries: MAX_RETRIES, retryDelaySecs: retryDelay / 1000 }, 'ML API 429: rate limit, retentando');
                
                await delay(retryDelay); // Pausa a execução
                
                // 🎯 CHAMADA RECURSIVA: Tenta novamente com a próxima tentativa
                return updateEstoqueAnuncio(detalhesAnuncio, access_token, updatePayload, attempt + 1);
            }

        logger.error({ status: resposta.status, body: respostaJson }, 'erro ao atualizar estoque ML');
        // Anexa o contexto completo ao erro para o chamador registrar em falhas_atualizacao_ml
        const erro = new Error(`Falha na atualização do estoque (Status ${resposta.status}).`);
        erro.statusHttp = statusCode;
        erro.respostaML = respostaJson;
        erro.payloadEnviado = payload;
        erro.mlItemId = mlItemId;
        throw erro;
    }

    logger.info({ mlItemId }, 'ML API: estoque atualizado com sucesso');
    return respostaJson;
};

const getStoredToken = async (storeId) => {
    const record = await Token.findOne({ where: { store_id: storeId } });
    return record ? record.access_token : null;
};

const processCriticalUpdates = async(mudancasCriticas,access_token) => {
    _debugTrace = [];
    const relatorio = { atualizados: [], jaAtualizados: [], erros: [] };
    try{
        for (const rodaAlterada of mudancasCriticas) {

            if(!(rodaAlterada.sku==='')){

                try {
                    listaMLIDs = await anunciosService.getAnunciosBySku(rodaAlterada.sku);

                    // Check if any of our watched ML IDs were returned for this SKU
                    const debugHit = listaMLIDs.some(m => DEBUG_ML_IDS.has(m.ml_id));
                    if (debugHit) {
                        dbgML('batch', '0-SKU-LOOKUP', { sku: rodaAlterada.sku, totalAnuncios: listaMLIDs.length, ml_ids: listaMLIDs.map(m => m.ml_id) });
                    }

                    for(const ML_ID of listaMLIDs){

                        const isDebugML = DEBUG_ML_IDS.has(ML_ID.ml_id);

                        if (isDebugML) dbgML(ML_ID.ml_id, '1-ENCONTRADO', { sku: rodaAlterada.sku });

                        const detalhesAnuncio = await anunciosService.getAnuncio(ML_ID.ml_id);

                        if (isDebugML) dbgML(ML_ID.ml_id, '2-DETALHES', { detalhesAnuncio });

                        const detalhesEstoque = await stockService.getRoda(detalhesAnuncio);

                        if (isDebugML) dbgML(ML_ID.ml_id, '3-ESTOQUE', { detalhesEstoque });

                        if (detalhesEstoque.length === 0) {
                            logger.info({ ml_id: ML_ID.ml_id, sku: rodaAlterada.sku }, 'anuncio sem nenhum SKU de roda no estoque: ignorando atualizacao');
                            continue;
                        }

                        const updatePayload = anunciosService.generateUpdatePayload(detalhesAnuncio, detalhesEstoque)

                        if (isDebugML) dbgML(ML_ID.ml_id, '4-PAYLOAD', { updatePayload });

                        if (rodaAlterada.sku === DEBUG_SKU) {
                            dbg(`[6-PAYLOAD] ml_id=${ML_ID.ml_id} payload=${JSON.stringify(updatePayload)}`);
                        }

                        await delay(DELAY_MS);

                        const resultado = await updateEstoqueAnuncio(detalhesAnuncio, access_token, updatePayload)

                        if (isDebugML) dbgML(ML_ID.ml_id, '5-RESULTADO', { status: resultado?.status ?? 'ok', resultado });

                        if (rodaAlterada.sku === DEBUG_SKU) {
                            dbg(`[6-RESULT] ml_id=${ML_ID.ml_id} status=${resultado?.status ?? 'ok'}`);
                        }

                        if (resultado && (resultado.status === 400 || resultado.status === 409)) {
                            relatorio.jaAtualizados.push({ sku: rodaAlterada.sku, ml_id: ML_ID.ml_id });
                            // O anúncio NAO foi atualizado (validacao de imagem / conflito):
                            // registra para auditoria mesmo sem abortar o lote.
                            await failuresService.registrarFalhaML({
                                origem: 'upload_pdf',
                                sku: rodaAlterada.sku,
                                ml_id: ML_ID.ml_id,
                                statusHttp: resultado.status,
                                motivo: resultado.message,
                                respostaML: resultado.respostaML,
                                payloadEnviado: resultado.payloadEnviado
                            });
                        } else {
                            relatorio.atualizados.push({ sku: rodaAlterada.sku, ml_id: ML_ID.ml_id });
                        }
                    }
                } catch (skuError) {
                    relatorio.erros.push({ sku: rodaAlterada.sku, mensagem: skuError.message });
                    await failuresService.registrarFalhaML({
                        origem: 'upload_pdf',
                        sku: rodaAlterada.sku,
                        ml_id: skuError.mlItemId || null,
                        statusHttp: skuError.statusHttp || null,
                        motivo: skuError.message,
                        respostaML: skuError.respostaML,
                        payloadEnviado: skuError.payloadEnviado
                    });
                }
            }
        }
    }
    catch(error){
        logger.error({ err: error }, 'erro fatal no processamento de vendas/reposicoes');
    }
    relatorio.debugTrace = _debugTrace;
    return relatorio;
}



module.exports = {
  getAuth,
  getVendas,
  authTest,
  getIdsAnuncios,
  getDetalhesAnuncios,
  updateEstoqueAnuncio,
  processCriticalUpdates,
  getStoredToken,
  delay
};