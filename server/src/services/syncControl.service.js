// /server/src/services/syncControl.service.js

const { SyncControl } = require('../config/database');
const { Op } = require('sequelize');

// A chave fixa que identifica o registro de controle de vendas no DB
const CHECKPOINT_ID = 'last_sale_sync';

/**
 * Busca o timestamp da última sincronização bem-sucedida de vendas.
 * @returns {Promise<string | null>} A data da última sincronização (em formato string) ou null se for a primeira vez.
 */
const getCheckpoint = async () => {
    try {
        // Busca o registro onde a chave é 'last_sale_sync'
        const controlRecord = await SyncControl.findByPk(CHECKPOINT_ID);
        
        if (controlRecord && controlRecord.last_timestamp) {
            // Retorna o timestamp em formato ISO para ser usado na URL da API do ML
            return controlRecord.last_timestamp.toISOString();
        }

        // Se o registro não existe ou o timestamp é nulo, retorna null
        return null; 

    } catch (error) {
        console.error(`Erro ao buscar o checkpoint de sincronização: ${error.message}`);
        // Em caso de erro no DB, é mais seguro retornar null para buscar TODAS as vendas
        return null; 
    }
};

/**
 * Atualiza o timestamp do último processamento de vendas bem-sucedido.
 * @param {Date | string} newTimestamp A nova data/hora da última venda processada.
 * @returns {Promise<void>}
 */
const updateCheckpoint = async (newTimestamp) => {
    try {
        
        const updateValue = { 
            id: CHECKPOINT_ID, 
            last_timestamp: new Date(newTimestamp) 
        };
        
        // Usa upsert (encontra ou cria, depois atualiza)
        await SyncControl.upsert(updateValue, {
            where: { id: CHECKPOINT_ID },
            conflictFields: ['id'] // Define a chave primária para evitar conflito
        });
        
        console.log(`[Checkpoint] Ponto de sincronização atualizado para: ${new Date(newTimestamp).toISOString()}`);

    } catch (error) {
        console.error(`Erro ao atualizar o checkpoint para ${newTimestamp}: ${error.message}`);
        throw error;
    }
};

module.exports = {
    getCheckpoint,
    updateCheckpoint
};