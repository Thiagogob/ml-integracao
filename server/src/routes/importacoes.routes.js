// /server/src/routes/importacoes.routes.js
//
// Rotas da importacao acompanhada. TODAS autenticadas.
//
// As rotas legadas de envio de relatorio em /api/stock nao exigem token, o que
// o proprio TCC aponta como limitacao: quem conheca o endereco altera o estoque
// e, por consequencia, os anuncios. Expor um botao em tela sem exigir token
// multiplicaria essa exposicao, de modo que aqui o middleware vem antes de
// tudo. As rotas legadas seguem intactas, para nao quebrar quem as chama hoje
// por fora da interface.

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const authMiddleware = require('../middlewares/authMiddleware');
const ImportacoesController = require('../controllers/ImportacoesController');

// Os relatorios reais medem algumas centenas de KB. 25 MB e folga larga e ao
// mesmo tempo impede que um envio acidental consuma o disco do contêiner, coisa
// que o multer sem limite permite.
const LIMITE_BYTES = 25 * 1024 * 1024;

const EXTENSOES_ACEITAS = new Set(['.pdf']);

const upload = multer({
    dest: path.join(__dirname, '../../uploads'),
    limits: { fileSize: LIMITE_BYTES, files: 1 },
    fileFilter: (req, file, cb) => {
        const extensao = path.extname(file.originalname || '').toLowerCase();
        if (!EXTENSOES_ACEITAS.has(extensao)) {
            return cb(Object.assign(
                new Error('Envie o relatorio em PDF.'),
                { code: 'EXTENSAO_NAO_ACEITA' }
            ));
        }
        return cb(null, true);
    }
});

// Traduz os erros do multer, que de outro modo subiriam como 500
const tratarErroDeUpload = (handler) => (req, res, next) => {
    handler(req, res, (erro) => {
        if (!erro) return next();

        if (erro.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: `Arquivo acima do limite de ${Math.round(LIMITE_BYTES / 1024 / 1024)} MB.`
            });
        }
        if (erro.code === 'EXTENSAO_NAO_ACEITA') {
            return res.status(415).json({ error: erro.message });
        }
        return res.status(400).json({ error: 'Falha ao receber o arquivo.', detalhe: erro.message });
    });
};

// Envio: analisa e devolve 202 com o diagnostico, sem gravar nada
router.post('/',
    authMiddleware.protect,
    tratarErroDeUpload(upload.single('arquivo')),
    ImportacoesController.receber
);

// Historico e consulta
router.get('/', authMiddleware.protect, ImportacoesController.listar);
router.get('/:id', authMiddleware.protect, ImportacoesController.obter);
router.get('/:id/eventos', authMiddleware.protect, ImportacoesController.eventos);

// Transicoes de estado
router.post('/:id/confirmar', authMiddleware.protect, ImportacoesController.confirmar);
router.post('/:id/retomar', authMiddleware.protect, ImportacoesController.retomar);
router.post('/:id/cancelar', authMiddleware.protect, ImportacoesController.cancelar);

module.exports = router;
