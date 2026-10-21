const cron = require('node-cron');
const logger = require('../config/logger');
const meliService = require('../services/meli.service');
const anunciosService = require('../services/anuncios.service');

// Anúncios criados no ML depois da última sincronização não existem na tabela `anuncios`,
// então o sistema nunca ajusta o estoque deles (ficam com a quantidade digitada na criação,
// que pode incluir o estoque do Sul). Esta rotina mantém a tabela em dia automaticamente.
const CRON_SINCRONIZACAO = '0 16 * * *'; // todo dia às 16h (horário de Brasília)
const TIMEZONE = 'America/Sao_Paulo';

let emExecucao = false;

const runAnunciosSync = async () => {
    if (emExecucao) {
        logger.warn('sincronizacao de anuncios ja em andamento, ignorando disparo');
        return;
    }
    emExecucao = true;
    logger.info('sincronizacao diaria de anuncios: iniciando');
    try {
        let access_token = await meliService.authTest();
        if (!access_token) {
            logger.info('token invalido, gerando novo token');
            access_token = await meliService.getAuth();
        }

        const anunciosId = await meliService.getIdsAnuncios(access_token);
        const anuncios = await meliService.getDetalhesAnuncios(anunciosId.results, access_token);

        // salvarAnuncios apaga a tabela da loja antes de inserir: nunca rodar com resposta vazia
        if (!anuncios || anuncios.length === 0) {
            logger.error('sincronizacao diaria de anuncios: ML retornou 0 anuncios, tabela mantida como esta');
            return;
        }

        await anunciosService.salvarAnuncios(anuncios);
        logger.info({ total: anuncios.length }, 'sincronizacao diaria de anuncios: concluida');
    } catch (error) {
        logger.error({ err: error }, 'sincronizacao diaria de anuncios: erro');
    } finally {
        emExecucao = false;
    }
};

const startAnunciosScheduler = () => {
    cron.schedule(CRON_SINCRONIZACAO, () => {
        runAnunciosSync();
    }, { timezone: TIMEZONE });
    logger.info({ cron: CRON_SINCRONIZACAO, timezone: TIMEZONE }, 'servico de sincronizacao diaria de anuncios iniciado');
};

module.exports = {
    startAnunciosScheduler,
    runAnunciosSync
};
