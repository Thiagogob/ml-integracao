// /server/src/controllers/ImportacoesController.js
//
// Camada HTTP da importacao acompanhada. Nao contem regra: traduz requisicao em
// chamada ao orquestrador e desfecho em codigo de status.
//
// O envio responde 202 Accepted com o id, nunca espera o fim. Medido nos
// relatorios reais, uma execucao leva de oito minutos para cima; o cliente tem
// timeout de dez segundos.

const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');
const { obterServicoImportacoes, ORIGENS_ACOMPANHADAS } = require('../services/importacoes.wiring');
const { ORIGENS } = require('../services/importacoes.service');
const { LIMITE_EVENTOS_POR_PAGINA } = require('../services/importacoes.repo');

const STORE_ID = parseInt(process.env.STORE_ID, 10) || 1;

// Onde o arquivo enviado e guardado para auditoria. Apenas auditoria: a
// execucao le a entrada do banco, nao daqui, porque este diretorio desaparece
// a cada deploy no Railway.
const DIR_IMPORTACOES = process.env.IMPORTACOES_DIR
    || path.join(__dirname, '../../uploads/importacoes');

const garantirDiretorio = () => {
    try {
        if (!fs.existsSync(DIR_IMPORTACOES)) {
            fs.mkdirSync(DIR_IMPORTACOES, { recursive: true });
        }
        return true;
    } catch (erro) {
        logger.warn({ err: erro, dir: DIR_IMPORTACOES },
            'nao foi possivel preparar o diretorio de importacoes; segue sem copia de auditoria');
        return false;
    }
};

const limparTemporario = (caminho) => {
    if (!caminho) return;
    fs.promises.unlink(caminho).catch(() => {});
};

/**
 * POST /api/importacoes
 * multipart com o campo 'arquivo'. Responde 202 com a importacao em
 * aguardando_confirmacao e o diagnostico, ou 409 se o mesmo arquivo ja estiver
 * em curso ou concluido.
 */
exports.receber = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado. Use o campo "arquivo".' });
    }

    const origem = req.body.origem || ORIGENS.PDF_SP;

    if (!ORIGENS_ACOMPANHADAS.includes(origem)) {
        limparTemporario(req.file.path);
        return res.status(422).json({
            error: `A importacao acompanhada esta implementada apenas para ${ORIGENS_ACOMPANHADAS.join(', ')}.`,
            detalhe: 'As demais origens nao sincronizam anuncios no Mercado Livre e concluem em segundos; use as rotas diretas em /api/stock.'
        });
    }

    let buffer;
    try {
        buffer = await fs.promises.readFile(req.file.path);
    } catch (erro) {
        logger.error({ err: erro }, 'nao foi possivel ler o arquivo enviado');
        return res.status(500).json({ error: 'Falha ao ler o arquivo enviado.' });
    }

    const servico = obterServicoImportacoes();

    try {
        // Guarda uma copia nomeada pelo conteudo antes de analisar. Nomear pelo
        // hash evita duas copias do mesmo relatorio.
        let caminhoGuardado = null;
        if (garantirDiretorio()) {
            const { sha256 } = require('../services/importacoes.service');
            const hash = sha256(buffer);
            const extensao = path.extname(req.file.originalname || '') || '.pdf';
            caminhoGuardado = path.join(DIR_IMPORTACOES, `${hash}${extensao}`);
            await fs.promises.writeFile(caminhoGuardado, buffer).catch((erro) => {
                logger.warn({ err: erro }, 'copia de auditoria do arquivo nao pudo ser gravada');
                caminhoGuardado = null;
            });
        }

        const desfecho = await servico.receberArquivo({
            origem,
            buffer,
            arquivo_nome: req.file.originalname || 'relatorio.pdf',
            arquivo_caminho: caminhoGuardado,
            store_id: STORE_ID,
            // authMiddleware.protect poe as afirmacoes do JWT em req.user;
            // AuthController assina { userId, username }
            usuario_id: req.user ? req.user.userId : null,
            usuario_nome: req.user ? req.user.username : null
        });

        if (desfecho.conflito) {
            return res.status(409).json({
                error: 'Este mesmo arquivo ja tem uma importacao em curso ou concluida.',
                detalhe: 'O conteudo foi comparado por SHA-256. Reenviar repetiria as chamadas ao Mercado Livre sem necessidade.',
                importacao: desfecho.conflito
            });
        }

        return res.status(202).json({ importacao: desfecho.importacao });
    } catch (erro) {
        const mapa = {
            ARQUIVO_VAZIO: [400, 'O arquivo enviado esta vazio.'],
            ARQUIVO_SEM_LINHAS: [422, 'Nenhuma linha de roda foi reconhecida no arquivo. Confira se e o relatorio certo.'],
            ORIGEM_INVALIDA: [400, 'Origem desconhecida.'],
            ORIGEM_NAO_ACOMPANHADA: [422, 'Origem sem importacao acompanhada.']
        };
        const [status, mensagem] = mapa[erro.codigo] || [500, 'Falha ao analisar o arquivo enviado.'];
        logger.error({ err: erro, codigo: erro.codigo }, 'falha no recebimento da importacao');
        return res.status(status).json({ error: mensagem, detalhe: erro.message });
    } finally {
        limparTemporario(req.file.path);
    }
};

/** POST /api/importacoes/:id/confirmar */
exports.confirmar = async (req, res) => {
    const servico = obterServicoImportacoes();
    try {
        const desfecho = await servico.confirmar(parseInt(req.params.id, 10));

        if (desfecho.erro === 'NAO_ENCONTRADA') {
            return res.status(404).json({ error: 'Importacao nao encontrada.' });
        }
        if (desfecho.erro === 'ESTADO_INVALIDO') {
            return res.status(409).json({
                error: 'Esta importacao nao esta aguardando confirmacao.',
                estado: desfecho.estado
            });
        }

        return res.status(202).json({ importacao: desfecho.importacao });
    } catch (erro) {
        logger.error({ err: erro }, 'falha ao confirmar importacao');
        return res.status(500).json({ error: 'Falha ao confirmar a importacao.' });
    }
};

/** POST /api/importacoes/:id/retomar */
exports.retomar = async (req, res) => {
    const servico = obterServicoImportacoes();
    try {
        const desfecho = await servico.retomar(parseInt(req.params.id, 10));

        if (desfecho.erro === 'NAO_ENCONTRADA') {
            return res.status(404).json({ error: 'Importacao nao encontrada.' });
        }
        if (desfecho.erro === 'ESTADO_INVALIDO') {
            return res.status(409).json({
                error: 'So uma importacao interrompida pode ser retomada.',
                estado: desfecho.estado
            });
        }

        return res.status(202).json({ importacao: desfecho.importacao });
    } catch (erro) {
        logger.error({ err: erro }, 'falha ao retomar importacao');
        return res.status(500).json({ error: 'Falha ao retomar a importacao.' });
    }
};

/** POST /api/importacoes/:id/cancelar */
exports.cancelar = async (req, res) => {
    const servico = obterServicoImportacoes();
    try {
        const desfecho = await servico.cancelar(parseInt(req.params.id, 10));

        if (desfecho.erro === 'ESTADO_INVALIDO') {
            return res.status(409).json({
                error: 'Esta importacao ja terminou.',
                estado: desfecho.estado
            });
        }

        return res.status(200).json({ importacao: desfecho.importacao });
    } catch (erro) {
        logger.error({ err: erro }, 'falha ao cancelar importacao');
        return res.status(500).json({ error: 'Falha ao cancelar a importacao.' });
    }
};

/** GET /api/importacoes/:id */
exports.obter = async (req, res) => {
    const servico = obterServicoImportacoes();
    try {
        const importacao = await servico.obter(parseInt(req.params.id, 10));
        if (!importacao) {
            return res.status(404).json({ error: 'Importacao nao encontrada.' });
        }
        return res.status(200).json({ importacao });
    } catch (erro) {
        logger.error({ err: erro }, 'falha ao consultar importacao');
        return res.status(500).json({ error: 'Falha ao consultar a importacao.' });
    }
};

/** GET /api/importacoes */
exports.listar = async (req, res) => {
    const servico = obterServicoImportacoes();
    try {
        const importacoes = await servico.listar({
            store_id: STORE_ID,
            limite: req.query.limite
        });
        return res.status(200).json({ total: importacoes.length, importacoes });
    } catch (erro) {
        logger.error({ err: erro }, 'falha ao listar importacoes');
        return res.status(500).json({ error: 'Falha ao listar as importacoes.' });
    }
};

/**
 * GET /api/importacoes/:id/eventos?desde_seq=0&resultado=erro&limite=200
 *
 * Busca incremental: a tela manda o maior seq que ja tem e recebe so o que
 * chegou depois. Com ~980 eventos por execucao, refazer a lista a cada consulta
 * seria desperdicio de banda e de banco.
 */
exports.eventos = async (req, res) => {
    const servico = obterServicoImportacoes();
    try {
        const eventos = await servico.eventos({
            importacao_id: parseInt(req.params.id, 10),
            desde_seq: req.query.desde_seq,
            resultado: req.query.resultado,
            limite: req.query.limite
        });

        const maiorSeq = eventos.reduce((m, e) => Math.max(m, e.seq), parseInt(req.query.desde_seq, 10) || 0);

        return res.status(200).json({
            total: eventos.length,
            maior_seq: maiorSeq,
            // avisa a tela de que a pagina encheu e ha mais para buscar
            truncado: eventos.length >= Math.min(parseInt(req.query.limite, 10) || 200, LIMITE_EVENTOS_POR_PAGINA),
            eventos
        });
    } catch (erro) {
        logger.error({ err: erro }, 'falha ao listar eventos da importacao');
        return res.status(500).json({ error: 'Falha ao listar os eventos da importacao.' });
    }
};
