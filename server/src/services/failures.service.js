// /server/src/services/failures.service.js
// Registro persistente de anúncios que NÃO conseguimos atualizar no Mercado Livre.
// Os logs do Railway são efêmeros e limitados por taxa; esta tabela guarda cada
// falha com o máximo de contexto para auditoria posterior (GET /api/falhas-ml).
const { FalhaAtualizacaoML, Anuncio } = require('../config/database');
const { Op } = require('sequelize');
const logger = require('../config/logger');

// Nunca propaga erro: registrar a falha não pode derrubar o fluxo que falhou.
const registrarFalhaML = async ({ origem, store_id = 1, sku = null, ml_id = null, statusHttp = null, motivo, respostaML = null, payloadEnviado = null }) => {
    try {
        let titulo = null;
        if (ml_id) {
            // Enriquecimento opcional: se a consulta falhar, registra a falha mesmo assim.
            try {
                const anuncio = await Anuncio.findOne({ where: { ml_id }, raw: true });
                if (anuncio) {
                    titulo = anuncio.titulo || null;
                    if (!sku) sku = anuncio.sku || null;
                }
            } catch (lookupError) {
                logger.warn({ err: lookupError, ml_id }, 'nao foi possivel buscar titulo do anuncio para a falha');
            }
        }

        await FalhaAtualizacaoML.create({
            origem,
            store_id,
            sku,
            ml_id,
            titulo,
            status_http: statusHttp,
            motivo: String(motivo || '').slice(0, 1000),
            resposta_ml: respostaML ? JSON.stringify(respostaML) : null,
            payload_enviado: payloadEnviado ? JSON.stringify(payloadEnviado) : null
        });

        logger.warn({ origem, sku, ml_id, statusHttp, motivo }, 'falha de atualizacao ML registrada na tabela falhas_atualizacao_ml');
    } catch (error) {
        logger.error({ err: error, origem, sku, ml_id }, 'nao foi possivel registrar a falha de atualizacao ML');
    }
};

// Lista as falhas mais recentes. Filtros opcionais: sku, origem, desde (ISO date), limit.
const listarFalhasML = async ({ sku, origem, desde, limit = 200 } = {}) => {
    const where = {};
    if (sku) where.sku = sku;
    if (origem) where.origem = origem;
    if (desde) where.created_at = { [Op.gte]: new Date(desde) };

    return FalhaAtualizacaoML.findAll({
        where,
        order: [['created_at', 'DESC']],
        limit: Math.min(parseInt(limit, 10) || 200, 1000),
        raw: true
    });
};

module.exports = {
    registrarFalhaML,
    listarFalhasML
};
