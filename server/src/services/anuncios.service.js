require('dotenv').config();
const fs = require('fs').promises;
const logger = require('../config/logger');
const path = require('path');
const { Anuncio, sequelize } = require('../config/database');
const { Op } = require('sequelize');
const STORE_ID = parseInt(process.env.STORE_ID, 10);

const salvarAnuncios = async (anuncios) => {

    const isAnuncioUnitario = (titulo) => {
        if (!titulo || typeof titulo !== 'string') return false;
        // Normaliza o título para maiúsculas e remove espaços antes de verificar
         
            const tituloNormalizado = titulo.trim().toUpperCase();
            
            return tituloNormalizado.startsWith('1 U') || tituloNormalizado.startsWith('1 R');
    };

    // destroy + insert numa única transação: quem lê a tabela durante a sincronização
    // (ex: observador de vendas) continua vendo os anúncios antigos até o commit
    const transaction = await sequelize.transaction();
    try {
        await Anuncio.destroy({ where: { store_id: STORE_ID }, transaction })

        let skusSalvos = 0;
        let registrosParaInserir = [];
        // Itera sobre cada anúncio
        for (const anuncio of anuncios) {

            const isUnitarioValue = isAnuncioUnitario(anuncio.titulo);
            // Itera sobre cada SKU dentro do anúncio
            for (const skuData of anuncio.skus) {

                const novoRegistro = {
                    ml_id: anuncio.id,
                    titulo: anuncio.titulo,
                    marca: anuncio.marca,
                    sku_id: skuData.id,
                    sku: skuData.sku,
                    quantidade: skuData.quantidade,
                    categoria: anuncio.categoria,
                    isUnitario: isUnitarioValue,
                    store_id: STORE_ID
            };
            registrosParaInserir.push(novoRegistro);
            skusSalvos++    
        }
    }
        if (registrosParaInserir.length > 0) {
            await Anuncio.bulkCreate(registrosParaInserir, { transaction });
        }
        await transaction.commit();
        logger.info({ skusSalvos }, 'anuncios salvos na tabela anuncios');
    } catch (error) {
        await transaction.rollback();
        logger.error({ err: error }, 'erro ao salvar anuncios');
        throw error; // Lança o erro para o controller
    }
};

const getAnuncio = async (id_anuncio) => {
    try{
        let detalhesAnuncio = [];


        const arrayAnuncio = await Anuncio.findAll({
            where: {
                ml_id: id_anuncio,
                store_id: STORE_ID
            },
            raw: true
         });


        for (const anuncio of arrayAnuncio){
            detalhesAnuncio.push({
                ml_id: anuncio.ml_id,
                variation_id: anuncio.sku_id, 
                sku: anuncio.sku,
                isUnitario: anuncio.isUnitario
            });
        }

        return (detalhesAnuncio);

    }catch(error){
        logger.error({ err: error }, 'erro ao capturar anuncio');
        throw error; // Lança o erro para o controller
    }
}

const getAnunciosBySku = async (sku) => {
    try{
        let listaMLIDsDoMesmoSku = [];

        //console.log("Capturando anúncio...");

        const arrayAnuncios = await Anuncio.findAll({
            where: {
                sku: sku,
                store_id: STORE_ID
            },
            raw: true
         });


        for (const anuncio of arrayAnuncios){

            listaMLIDsDoMesmoSku.push({
                ml_id: anuncio.ml_id,
                //variation_id: anuncio.sku_id, 
                //sku: anuncio.sku,
                //isUnitario: anuncio.isUnitario
            });

        }

        return (listaMLIDsDoMesmoSku);

    }catch(error){
        logger.error({ err: error }, 'erro ao capturar anuncio');
        throw error; // Lança o erro para o controller
    }
}


/**
 * Expande uma lista de SKUs nos pares (sku, ml_id) que serao tocados.
 *
 * Existe para que a importacao acompanhada saiba o TOTAL de anuncios antes de
 * comecar, e possa mostrar barra de progresso e estimativa de termino reais em
 * lugar de adivinhadas. Uma consulta so, em lugar de uma por SKU.
 *
 * Reproduz deliberadamente a semantica de getAnunciosBySku, que devolve uma
 * entrada por LINHA da tabela anuncios, e percorre os SKUs na ordem recebida.
 * Sem isso a contagem e a ordem divergiriam do caminho legado, e o teste de
 * regressao contra os relatorios de abril nao fecharia.
 *
 * @param {string[]} skus
 * @param {number} [storeId]
 * @returns {Promise<Array<{sku: string, ml_id: string, titulo: string|null}>>}
 */
const expandirAnunciosPorSkus = async (skus, storeId = STORE_ID) => {
    const unicos = [...new Set((skus || []).filter(Boolean))];
    if (unicos.length === 0) return [];

    const linhas = await Anuncio.findAll({
        where: { sku: { [Op.in]: unicos }, store_id: storeId },
        attributes: ['sku', 'ml_id', 'titulo'],
        raw: true
    });

    // agrupa por SKU para preservar a ordem de iteracao do caminho legado
    const porSku = new Map();
    for (const linha of linhas) {
        if (!porSku.has(linha.sku)) porSku.set(linha.sku, []);
        porSku.get(linha.sku).push({
            sku: linha.sku,
            ml_id: linha.ml_id,
            titulo: linha.titulo || null
        });
    }

    const plano = [];
    for (const sku of unicos) {
        const doSku = porSku.get(sku);
        if (doSku) plano.push(...doSku);
    }
    return plano;
};


const getAnunciosBySkuForStore = async (sku, storeId) => {
    try {
        const arrayAnuncios = await Anuncio.findAll({
            where: { sku, store_id: storeId },
            raw: true
        });
        return arrayAnuncios.map(a => ({ ml_id: a.ml_id }));
    } catch (error) {
        logger.error({ err: error }, 'erro ao capturar anuncio');
        throw error;
    }
};

const getAnuncioForStore = async (id_anuncio, storeId) => {
    try {
        const arrayAnuncio = await Anuncio.findAll({
            where: { ml_id: id_anuncio, store_id: storeId },
            raw: true
        });
        return arrayAnuncio.map(a => ({
            ml_id: a.ml_id,
            variation_id: a.sku_id,
            sku: a.sku,
            isUnitario: a.isUnitario
        }));
    } catch (error) {
        logger.error({ err: error }, 'erro ao capturar anuncio');
        throw error;
    }
};

const generateUpdatePayload = (detalhesAnuncio, detalhesEstoque) => {


    // 1. Cria um mapa rápido de SKU -> Quantidade
    // Isso transforma o array de estoque em um objeto { 'SKU_A': 100, 'SKU_B': 16, ... }
    const mapaQuantidadesBrutas = detalhesEstoque.reduce((map, item) => {
        // Garante que a quantidade seja um número inteiro e positivo
        const quantidade = Math.max(0, parseInt(item.quantidade) || 0); 
        map[item.sku] = quantidade;
        return map;
    }, {});

    const variationsPayload = [];
    let simpleItemPayload = null; 
    // 2. Mapeia os detalhes do anúncio para criar o payload final
    detalhesAnuncio.forEach(detalhe => {
        // Busca a quantidade no mapa usando o SKU como chave
        const quantidadeBruta = mapaQuantidadesBrutas[detalhe.sku] || 0; 
        
        let quantidadeFinal;

        if(detalhe.isUnitario){
            quantidadeFinal = quantidadeBruta
        }else{
            quantidadeFinal = Math.floor(quantidadeBruta / 4);
        }

        if(detalhe.variation_id.startsWith('MLB')){
            simpleItemPayload = {
                available_quantity: quantidadeFinal
            };
            
        } else {
            variationsPayload.push({
                id: detalhe.variation_id, 
                available_quantity: quantidadeFinal
            });
        }

    });

        //console.log(`[Cálculo Estoque] SKU: ${detalhe.sku} | Bruto: ${quantidadeBruta} | É Unitário: ${detalhe.isUnitario} | Final: ${quantidadeFinal}`);

    if (simpleItemPayload) {
        return simpleItemPayload;
    } else {
        return variationsPayload;
    }


    
};

module.exports = {
    salvarAnuncios,
    getAnuncio,
    generateUpdatePayload,
    getAnunciosBySku,
    getAnunciosBySkuForStore,
    getAnuncioForStore,
    expandirAnunciosPorSkus
};