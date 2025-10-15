require('dotenv').config();
const fs = require('fs').promises;
const path = require('path');
const { Anuncio, sequelize } = require('../config/database');

const salvarAnuncios = async (anuncios) => {

    try {
        console.log("Iniciando o salvamento de anúncios no banco de dados...");
        


        console.log("Apagando dados existentes na tabela 'anuncios'...");
        await Anuncio.destroy({ where: {} })

        console.log("Dados anteriores apagados com sucesso.");

        let skusSalvos = 0;
        let registrosParaInserir = [];
        // Itera sobre cada anúncio
        for (const anuncio of anuncios) {
            // Itera sobre cada SKU dentro do anúncio
            for (const skuData of anuncio.skus) {
                //const sql = `
                //    INSERT INTO anuncios (ml_id, titulo, marca, sku_id, sku, quantidade, categoria)
                //    VALUES (?, ?, ?, ?, ?, ?, ?)
                //`;
                const novoRegistro = {
                    ml_id: anuncio.id,
                    titulo: anuncio.titulo,
                    marca: anuncio.marca,
                    sku_id: skuData.id,
                    sku: skuData.sku,
                    quantidade: skuData.quantidade,
                    categoria: anuncio.categoria
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

    }catch(error){
        console.error("Erro ao capturar anúncio", error);
        throw error; // Lança o erro para o controller
    }
}

module.exports = {
    salvarAnuncios
};