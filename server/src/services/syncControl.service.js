
const { SyncControl } = require('../config/database');
const logger = require('../config/logger');
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
        logger.error({ err: error }, 'erro ao buscar checkpoint de sincronizacao');
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
        
        logger.info({ timestamp: new Date(newTimestamp).toISOString() }, 'checkpoint de sincronizacao atualizado');

    } catch (error) {
        logger.error({ err: error, newTimestamp }, 'erro ao atualizar checkpoint');
        throw error;
    }
};

module.exports = {
    getCheckpoint,
    updateCheckpoint
};