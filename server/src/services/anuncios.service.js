require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { Anuncio, sequelize } = require('../config/database');

const salvarAnuncios = async (anuncios) => {

    const isAnuncioUnitario = (titulo) => {
        if (!titulo || typeof titulo !== 'string') return false;
        // Normaliza o título para maiúsculas e remove espaços antes de verificar
         
            const tituloNormalizado = titulo.trim().toUpperCase();
            
            return tituloNormalizado.startsWith('1 U') || tituloNormalizado.startsWith('1 R');
    };

    try {
        console.log("Iniciando o salvamento de anúncios no banco de dados...");
        


        console.log("Apagando dados existentes na tabela 'anuncios'...");
        await Anuncio.destroy({ where: {} })

        console.log("Dados anteriores apagados com sucesso.");

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
                    isUnitario: isUnitarioValue
            };
            registrosParaInserir.push(novoRegistro);
            skusSalvos++    
        }
    }
        if (registrosParaInserir.length > 0) {
            await Anuncio.bulkCreate(registrosParaInserir);
        }
        console.log(`Dados de ${skusSalvos} SKUs inseridos/atualizados com sucesso na tabela 'anuncios'.`);
    } catch (error) {
        console.error("Erro ao salvar os anúncios:", error);
        throw error; // Lança o erro para o controller
    }
};

const getAnuncio = async (id_anuncio) => {
    try{
        let detalhesAnuncio = [];

        console.log("Capturando anúncio...");

        const arrayAnuncio = await Anuncio.findAll({
            where: { 
                ml_id: id_anuncio
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
        console.error("Erro ao capturar anúncio", error);
        throw error; // Lança o erro para o controller
    }
}

const getAnunciosBySku = async (sku) => {
    try{
        let listaMLIDsDoMesmoSku = [];

        //console.log("Capturando anúncio...");

        const arrayAnuncios = await Anuncio.findAll({
            where: { 
                sku: sku
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
        console.error("Erro ao capturar anúncio", error);
        throw error; // Lança o erro para o controller
    }
}


const generateUpdatePayload = (detalhesAnuncio, detalhesEstoque) => {

    console.log("Gerando payload... ")

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
        console.log("Payload Gerado (Simples):", simpleItemPayload);
        // Retorna APENAS o objeto simples
        return simpleItemPayload;
    } else {
        console.log("Payload Gerado (Variações):", variationsPayload);
        // Retorna APENAS o array de variações
        return variationsPayload;
    }


    
};

module.exports = {
    salvarAnuncios,
    getAnuncio,
    generateUpdatePayload,
    getAnunciosBySku
};