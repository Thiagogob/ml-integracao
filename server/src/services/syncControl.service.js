
const { SyncControl } = require('../config/database');
const { Op } = require('sequelize');

const CHECKPOINT_ID = 'last_sale_sync';
const STORE_ID = parseInt(process.env.STORE_ID, 10);

/**
 * Busca o timestamp da última sincronização bem-sucedida de vendas.
 * @returns {Promise<string | null>} A data da última sincronização (em formato string) ou null se for a primeira vez.
 */
const getCheckpoint = async () => {
    try {

        const controlRecord = await SyncControl.findOne({ where: { id: CHECKPOINT_ID, store_id: STORE_ID } });
        
        if (controlRecord && controlRecord.last_timestamp) {
            // Retorna o timestamp em formato ISO para ser usado na URL da API do ML
            return controlRecord.last_timestamp.toISOString();
        }

        return null; 

    } catch (error) {
        console.error(`Erro ao buscar o checkpoint de sincronização: ${error.message}`);
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
        
        const record = await SyncControl.findOne({ where: { id: CHECKPOINT_ID, store_id: STORE_ID } });
        if (record) {
            await record.update({ last_timestamp: new Date(newTimestamp) });
        } else {
            await SyncControl.create({ id: CHECKPOINT_ID, store_id: STORE_ID, last_timestamp: new Date(newTimestamp) });
        }
        
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