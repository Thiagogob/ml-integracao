const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/authMiddleware');
const failuresService = require('../services/failures.service');
const logger = require('../config/logger');

// Lista as falhas de atualização de anúncios no ML.
// Filtros opcionais via query string: ?sku=...&origem=venda|upload_pdf|cross_store_loja2&desde=2026-06-01&limit=200
router.get('/', authMiddleware.protect, async (req, res) => {
    try {
        const falhas = await failuresService.listarFalhasML({
            sku: req.query.sku,
            origem: req.query.origem,
            desde: req.query.desde,
            limit: req.query.limit
        });
        return res.status(200).json({ total: falhas.length, falhas });
    } catch (error) {
        logger.error({ err: error }, 'erro ao listar falhas de atualizacao ML');
        return res.status(500).json({ error: 'Falha ao consultar as falhas de atualização.' });
    }
});

module.exports = router;
