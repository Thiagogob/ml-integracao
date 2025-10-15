const { Token, Venda } = require('../config/database');
const { QueryTypes } = require('sequelize');
require('dotenv').config();
const SELLER_ID = process.env.SELLER_ID;
const SECRET_KEY = process.env.SECRET_KEY;
const ACCESS_TOKEN = process.env.ACCESS_TOKEN;
const APP_ID = process.env.APP_ID;


const getAuth = async () => {
    try {
        // 1. Obtém o refresh_token do banco de dados usando a função 'all'
        const tokenRecord = await Token.findOne({ where: { id: 1 } });


        if (!tokenRecord || !tokenRecord.refresh_token) {
            throw new Error("Refresh Token não encontrado no banco de dados.");
        }

        const refresh_token_antigo = tokenRecord.refresh_token;

        console.log("Refresh Token Antigo = ", refresh_token_antigo);

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

        console.log("Refresh token novo = ", resposta_json.refresh_token);

        // 3. Atualiza os tokens no banco de dados, usando `run` e parâmetros
        //const sql = `UPDATE tokens_ml SET refresh_token = ?, access_token = ? WHERE id = 1`;
        //const params = [resposta_json.refresh_token, resposta_json.access_token];

        //await run(sql, params);
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


const salvarVendas = async (vendas) => {
    let vendasSalvas = 0;
    try{
        console.log("Iniciando o salvamento de vendas no banco de dados...");

    for (const venda of vendas) {
        
        //const sql = `
        //    INSERT INTO vendas_ml (data, id_ml, sku, valor, comissao) 
        //    VALUES (?, ?, ?, ?, ?)
//
        //`;
        //const params = [
        //    venda.date_closed,
        //    venda.id,
        //    venda.order_items[0].item.seller_sku,
        //    venda.order_items[0].unit_price,
        //    venda.order_items[0].sale_fee
        //];
        //
                            
            await Venda.create({
                    data: venda.date_closed,
                    id_ml: venda.id, // O ID do pedido
                    sku: venda.order_items[0].item.seller_sku,
                    valor: venda.order_items[0].unit_price,
                    comissao: venda.order_items[0].sale_fee
                });

             vendasSalvas++;
        
    }
    console.log(`Dados de ${vendasSalvas} vendas salvas no banco de dados.`);
    } catch(error){
         console.error('Erro ao salvar as vendas:', error);
            throw error; // Lança o erro para que o controller o capture
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
        
        //console.log("URL da Requisição:", url);

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
                offset += vendasDaPagina.length;
            }
            
            // Se o total de vendas coletadas for igual ou maior que o total da API, sai do loop
            if (todasAsVendas.length >= totalVendasApi) {
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

const getIdsAnuncios = async (access_token) => {

    let todosOsAnuncios = [];

    let offset = 0;

    let limit = 50;

    const headers = {

        "Authorization": `Bearer ${access_token}`

    };

    let totalAnunciosApi = 0;


    while (true) {

        //URL requisição de anuncios

        const url = `https://api.mercadolibre.com/users/${SELLER_ID}/items/search?status=active&offset=${offset}&limit=${limit}`;
        //`https://api.mercadolibre.com/users/${SELLER_ID}/items/search?search_type=scan&offset=${offset}`;

        //`https://api.mercadolibre.com/users/${SELLER_ID}/items/search?search_type=scan&offset=${offset}`

        //`https://api.mercadolibre.com/users/${SELLER_ID}/items/search?&offset=${offset}`;


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

            const anunciosDaPagina = resposta_json.results;


            if (offset === 0) {

                totalAnunciosApi = resposta_json.paging.total;

                console.log(resposta_json.paging.total);

            }



            if (anunciosDaPagina && anunciosDaPagina.length > 0) {

                todosOsAnuncios = todosOsAnuncios.concat(anunciosDaPagina);

                offset += anunciosDaPagina.length;

            }


            if (todosOsAnuncios.length >= totalAnunciosApi) {

                break;

            }


        } catch (error) {

            console.error('Erro ao capturar anúncios', error);

            throw error;

        }


    }

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
                // Retry only for a timeout error
                if (retries < maxRetries && error.cause && error.cause.code === 'UND_ERR_CONNECT_TIMEOUT') {
                    retries++;
                    console.warn(`Timeout! Retrying request ${retries}/${maxRetries}`);
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for 2 seconds
                    return executeFetchWithRetry(); // Call the function recursively
                } else {
                    throw error; // Re-throw the error if it's not a timeout or if max retries are reached
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




module.exports = {
  getAuth,
  getVendas,
  authTest,
  salvarVendas,
  getIdsAnuncios,
  getDetalhesAnuncios
};