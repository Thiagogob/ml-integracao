const { Token, Venda } = require('../config/database');
const { QueryTypes } = require('sequelize');
require('dotenv').config();
const anunciosService = require('../services/anuncios.service');
const stockService = require('../services/stock.service');

const SELLER_ID = process.env.SELLER_ID;
const SECRET_KEY = process.env.SECRET_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const APP_ID = process.env.APP_ID;
const DELAY_MS = 500;
const INITIAL_RETRY_DELAY_MS = 2000; // 2 segundos
const MAX_RETRIES = 3; // Limita a 3 tentativas totais

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const getAuth = async () => {
    try {
        // 1. Obtém o refresh_token do banco de dados usando a função 'all'
        const tokenRecord = await Token.findOne({ where: { id: 1 } });


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
                where: { id: 1 } 
            }
        );

        console.log('Tokens atualizados com sucesso.');

        // 4. Retorna o novo access_token
        return resposta_json.access_token;

    } catch (err) {
        console.error('Erro ao obter/atualizar tokens:', err.message);
        throw err; // Lança o erro para que o controller o capture
    }
};



const authTest = async () => {
   try {
        // 1. Busca o token usando o Modelo. O método findOne retorna o objeto Token.
        const resultado = await Token.findOne({ where: { id: 1 } });
        
        // Se o resultado for nulo (tabela vazia), o Sequelize retorna null.
        if (!resultado || !resultado.access_token) {
            console.error("Tokens não encontrados no banco de dados.");
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
            console.log("Token ainda válido.");
            return access_token;
        } else if (resposta.status === 401) {
            console.log("Token inválido.");
            return false;
        } else {
            // Lança um erro para status inesperados
            throw new Error(`Erro inesperado ao testar o token: ${resposta.status}`);
        }
    } catch (err) {
        console.error('Erro ao testar a autenticação:', err.message);
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
            console.error('Erro ao buscar vendas:', error);
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
        
        console.log(`Total de anúncios a buscar: ${totalAnunciosApi}`);
        
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
        console.error('Erro no processo de scan de anúncios', error);
        throw error;
    }
    
    console.log(`Busca finalizada. Total de IDs capturados: ${todosOsAnuncios.length}`);
    
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
            console.error('Erro na requisição de teste:', error);
            throw error;
        }
    }
    else{
    // 1. Divide os IDs em lotes de 20
    const lotes = [];
    for (let i = 0; i < anuncioIds.length; i += BATCH_SIZE) {
        lotes.push(anuncioIds.slice(i, i + BATCH_SIZE));
    }
    
    console.log(`Iniciando a busca de detalhes em ${lotes.length} lotes.`);

    
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
                    console.warn(`Timeout! Retrying request ${retries}/${maxRetries}`);
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

            console.log(`Detalhes de ${todosOsDetalhes.length} anúncios capturados.`);

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
            console.error('Erro ao buscar detalhes dos anúncios:', error);
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

    if (!resposta.ok) {

        if (statusCode === 409) {
            console.warn(`[ML API - 409 IGNORADO] Conflito de concorrência detectado para ML ID ${detalhesAnuncio[0].ml_id}. Continuando o processo.`);
            return { status: 409, message: 'Conflict ignored.' }; // Retorna sucesso silencioso
        }

        if (statusCode === 429 && attempt < MAX_RETRIES) {
                const retryDelay = INITIAL_RETRY_DELAY_MS * attempt; // 2s, 4s, 6s, etc.
                
                console.warn(`[ML API - 429 RETRY] Rate Limit atingido para ML ID ${mlItemId}. Tentativa ${attempt}/${MAX_RETRIES}. Retrying in ${retryDelay / 1000}s...`);
                
                await delay(retryDelay); // Pausa a execução
                
                // 🎯 CHAMADA RECURSIVA: Tenta novamente com a próxima tentativa
                return updateEstoqueAnuncio(detalhesAnuncio, access_token, updatePayload, attempt + 1);
            }

        console.error(`Erro ao atualizar estoque (${resposta.status}):`, respostaJson);
        throw new Error(`Falha na atualização do estoque (Status ${resposta.status}).`);
    }

    console.log("[ML API] Estoque atualizado com sucesso.");
    return respostaJson;
};

const processCriticalUpdates = async(mudancasCriticas,access_token) => {
try{
    for (rodaAlterada of mudancasCriticas) {

        if(!(rodaAlterada.sku==='')){

            listaMLIDs = await anunciosService.getAnunciosBySku(rodaAlterada.sku);

            for(const ML_ID of listaMLIDs){
            
                const detalhesAnuncio = await anunciosService.getAnuncio(ML_ID.ml_id);
            
                const detalhesEstoque = await stockService.getRoda(detalhesAnuncio);

                console.log(detalhesEstoque)
            
                const updatePayload = anunciosService.generateUpdatePayload(detalhesAnuncio, detalhesEstoque)

                await delay(DELAY_MS);
                
                await updateEstoqueAnuncio(detalhesAnuncio, access_token, updatePayload)
            
            }

        }
    }
    }
    catch(error){
        console.error("[PROCESSAR VENDAS/REPOSICOES] Erro fatal durante o processamento de vendas/reposicoes:", error.message);

    }
}



module.exports = {
  getAuth,
  getVendas,
  authTest,
  getIdsAnuncios,
  getDetalhesAnuncios,
  updateEstoqueAnuncio,
  processCriticalUpdates,
  delay
};