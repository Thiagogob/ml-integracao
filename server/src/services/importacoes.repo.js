// /server/src/services/importacoes.repo.js
//
// Porta de persistencia da importacao acompanhada. Recebe os modelos por
// parametro (fabrica em config/models/importacoes.js), de modo que a suite de
// testes usa as mesmas operacoes sobre sqlite em memoria.
//
// Tres decisoes que valem explicacao:
//
// 1. Contadores sobem por UPDATE incremental (col = col + 1), nunca por
//    ler-somar-gravar. O CHECK da migracao exige
//    processados = atualizados + ja_atualizados + erros + ignorados, e a unica
//    forma de nunca violar isso e subir os dois contadores na mesma instrucao.
//
// 2. A transicao de estado e feita por comparacao e troca: o UPDATE carrega o
//    estado esperado no WHERE e o chamador confere quantas linhas mudaram. Duas
//    instancias que tentem confirmar a mesma importacao: so uma ganha.
//
// 3. O ordinal do evento (seq) vem da memoria do executor, nao de um
//    SELECT MAX() por evento, que custaria uma ida ao banco a cada anuncio.
//    A unicidade de (importacao_id, seq) e o arbitro: se dois executores
//    disputarem o mesmo job, o segundo colide e para.

const { Op } = require('sequelize');
const {
    ESTADOS,
    ESTADOS_QUE_BLOQUEIAM_REENVIO,
    ESTADOS_EM_VOO,
    CONTADOR_POR_RESULTADO
} = require('../config/models/importacoes');

const LIMITE_MOTIVO = 1000;
const LIMITE_EVENTOS_POR_PAGINA = 500;

const truncar = (texto, limite = LIMITE_MOTIVO) =>
    texto === null || texto === undefined ? null : String(texto).slice(0, limite);

// Colunas JSON precisam ser normalizadas na leitura.
//
// Com raw: true, o Postgres devolve JSONB ja desserializado, mas o sqlite
// devolve a coluna JSON como string. Sem isto, plano_anuncios chega como texto
// e o laco da execucao percorreria os CARACTERES do JSON em lugar dos anuncios.
// Foi exatamente o que a suite pegou: 52 iteracoes por anuncio, que e o tamanho
// medio em caracteres de cada item do plano.
const COLUNAS_JSON = ['resumo', 'detalhe_analise', 'entrada_rodas', 'plano_anuncios'];

const comoJson = (valor) => {
    if (typeof valor !== 'string') return valor;
    try {
        return JSON.parse(valor);
    } catch (erro) {
        return null;
    }
};

const normalizarJson = (linha) => {
    if (!linha) return linha;
    for (const coluna of COLUNAS_JSON) {
        if (coluna in linha) linha[coluna] = comoJson(linha[coluna]);
    }
    return linha;
};

/**
 * @param {object} deps
 * @param {import('sequelize').Model} deps.Importacao
 * @param {import('sequelize').Model} deps.ImportacaoEvento
 * @param {import('sequelize').Sequelize} deps.sequelize
 * @param {object} [deps.logger]
 * @param {() => Date} [deps.agora] relogio injetavel, para os testes
 */
const criarRepositorioImportacoes = ({ Importacao, ImportacaoEvento, sequelize, logger, agora }) => {
    const relogio = agora || (() => new Date());
    const log = logger || { info() {}, warn() {}, error() {}, debug() {} };

    // ----------------------------------------------------------------- leitura

    const buscar = async (id) =>
        normalizarJson(await Importacao.findByPk(id, { raw: true }));

    const listar = async ({ store_id = 1, limite = 20 } = {}) => {
        const linhas = await Importacao.findAll({
            where: { store_id },
            order: [['criada_em', 'DESC']],
            limit: Math.min(parseInt(limite, 10) || 20, 100),
            // as listas de analise sao grandes (centenas de linhas) e nao
            // interessam no historico
            attributes: { exclude: ['detalhe_analise', 'entrada_rodas', 'plano_anuncios'] },
            raw: true
        });
        return linhas.map(normalizarJson);
    };

    /**
     * Busca incremental usada pela tela: devolve apenas o que chegou depois do
     * ultimo seq que o navegador ja tem.
     */
    const listarEventos = async ({ importacao_id, desde_seq = 0, resultado, limite = 200 }) => {
        const where = { importacao_id, seq: { [Op.gt]: parseInt(desde_seq, 10) || 0 } };
        if (resultado) where.resultado = resultado;

        return ImportacaoEvento.findAll({
            where,
            order: [['seq', 'ASC']],
            limit: Math.min(parseInt(limite, 10) || 200, LIMITE_EVENTOS_POR_PAGINA),
            raw: true
        });
    };

    /**
     * Retomada: o que ja foi tocado neste job. Devolve um Set de chaves
     * "sku|ml_id" e o maior seq gravado, para o executor continuar a numeracao.
     */
    const lerProgressoGravado = async (importacao_id) => {
        const eventos = await ImportacaoEvento.findAll({
            where: { importacao_id },
            attributes: ['seq', 'sku', 'ml_id'],
            raw: true
        });
        const jaFeitos = new Set(eventos.map((e) => `${e.sku || ''}|${e.ml_id || ''}`));
        const maiorSeq = eventos.reduce((m, e) => Math.max(m, e.seq), 0);
        return { jaFeitos, maiorSeq };
    };

    const cancelamentoPedido = async (id) => {
        const linha = await Importacao.findByPk(id, {
            attributes: ['cancelamento_pedido'],
            raw: true
        });
        return Boolean(linha && linha.cancelamento_pedido);
    };

    // ------------------------------------------------------------------ escrita

    /**
     * Cria o job. Antes disso recusa o reenvio de um arquivo que ja esta em voo
     * ou ja concluiu, comparando o SHA-256 do conteudo.
     *
     * A checagem aqui e a que a suite exercita; o indice unico parcial da
     * migracao e a rede de seguranca contra dois envios simultaneos, que esta
     * consulta sozinha nao pegaria.
     *
     * @returns {{ importacao: object } | { conflito: object }}
     */
    const criar = async ({ origem, store_id = 1, arquivo_nome, arquivo_bytes,
                           arquivo_sha256, usuario_id = null, usuario_nome = null }) => {
        const existente = await Importacao.findOne({
            where: {
                store_id,
                arquivo_sha256,
                estado: { [Op.in]: ESTADOS_QUE_BLOQUEIAM_REENVIO }
            },
            order: [['criada_em', 'DESC']],
            attributes: { exclude: ['detalhe_analise'] },
            raw: true
        });

        if (existente) return { conflito: normalizarJson(existente) };

        try {
            const criada = await Importacao.create({
                origem,
                store_id,
                estado: ESTADOS.ANALISANDO,
                arquivo_nome,
                arquivo_bytes,
                arquivo_sha256,
                usuario_id,
                usuario_nome,
                criada_em: relogio(),
                heartbeat_em: relogio()
            });
            return { importacao: criada.get({ plain: true }) };
        } catch (erro) {
            // Corrida perdida contra o indice unico parcial: outro envio do
            // mesmo arquivo entrou primeiro. Devolve o vencedor como conflito.
            if (erro && erro.name === 'SequelizeUniqueConstraintError') {
                const vencedor = await Importacao.findOne({
                    where: {
                        store_id,
                        arquivo_sha256,
                        estado: { [Op.in]: ESTADOS_QUE_BLOQUEIAM_REENVIO }
                    },
                    attributes: { exclude: ['detalhe_analise'] },
                    raw: true
                });
                if (vencedor) return { conflito: normalizarJson(vencedor) };
            }
            throw erro;
        }
    };

    /**
     * Fim da analise do PDF: grava o diagnostico e passa a esperar confirmacao.
     * Nada de estoque nem de Mercado Livre foi tocado ate aqui.
     */
    const registrarAnalise = async (id, {
        resumo, detalhe_analise, total_anuncios, entrada_rodas, plano_anuncios
    }) => {
        const [linhas] = await Importacao.update({
            estado: ESTADOS.AGUARDANDO_CONFIRMACAO,
            resumo: resumo || null,
            detalhe_analise: detalhe_analise || null,
            total_anuncios: total_anuncios === undefined ? null : total_anuncios,
            // gravados no banco para que confirmacao e retomada nao dependam do
            // arquivo em disco
            entrada_rodas: entrada_rodas || null,
            plano_anuncios: plano_anuncios || null,
            heartbeat_em: relogio()
        }, { where: { id, estado: ESTADOS.ANALISANDO } });

        return linhas === 1;
    };

    /**
     * Le a carga util gravada na analise. E daqui que a execucao tira o que
     * precisa, nunca do sistema de arquivos.
     */
    const lerCargaUtil = async (id) => {
        const linha = await Importacao.findByPk(id, {
            attributes: ['entrada_rodas', 'plano_anuncios'],
            raw: true
        });
        if (!linha) return null;

        const rodas = comoJson(linha.entrada_rodas) || [];
        const plano = comoJson(linha.plano_anuncios) || [];

        // Guarda explicita. Se um dia a desserializacao mudar de comportamento,
        // e melhor estourar aqui do que percorrer uma string caractere por
        // caractere achando que sao anuncios.
        if (!Array.isArray(rodas) || !Array.isArray(plano)) {
            throw new Error(
                `carga util da importacao ${id} nao desserializou em vetores ` +
                `(rodas: ${typeof rodas}, plano: ${typeof plano})`
            );
        }

        return { rodas, plano };
    };

    /**
     * Anula entrada e plano. Chamado quando o job encerra em um estado do qual
     * nao se retoma, para a tabela nao crescer ~260 KB por importacao sem
     * necessidade. Nao e chamado em 'interrompida' nem em 'falhou', que sao
     * justamente os estados retomaveis.
     */
    const liberarCargaUtil = async (id) => {
        await Importacao.update(
            { entrada_rodas: null, plano_anuncios: null },
            { where: { id } }
        );
    };

    /**
     * Confirmacao do operador. Comparacao e troca: so sai de
     * aguardando_confirmacao uma vez.
     */
    const confirmar = async (id, { executor }) => {
        const instante = relogio();
        const [linhas] = await Importacao.update({
            estado: ESTADOS.PROCESSANDO,
            executor,
            confirmada_em: instante,
            iniciada_em: instante,
            heartbeat_em: instante
        }, { where: { id, estado: ESTADOS.AGUARDANDO_CONFIRMACAO } });

        return linhas === 1;
    };

    /**
     * Retomada de uma execucao interrompida. Mesma comparacao e troca, partindo
     * de interrompida. Os contadores e eventos ja gravados sao preservados.
     */
    const retomar = async (id, { executor }) => {
        const [linhas] = await Importacao.update({
            estado: ESTADOS.PROCESSANDO,
            executor,
            erro_mensagem: null,
            cancelamento_pedido: false,
            heartbeat_em: relogio()
        }, { where: { id, estado: ESTADOS.INTERROMPIDA } });

        return linhas === 1;
    };

    const baterHeartbeat = async (id) => {
        await Importacao.update(
            { heartbeat_em: relogio() },
            { where: { id, estado: ESTADOS.PROCESSANDO } }
        );
    };

    /**
     * Grava um anuncio processado e sobe os contadores na mesma transacao.
     *
     * Em caso de colisao de (importacao_id, seq) devolve false em lugar de
     * lancar: significa que outro executor gravou esse ordinal, e quem perde a
     * corrida deve parar, nao insistir.
     */
    const gravarEvento = async (importacao_id, evento) => {
        const coluna = CONTADOR_POR_RESULTADO[evento.resultado];
        if (!coluna) {
            throw new Error(`resultado de evento desconhecido: ${evento.resultado}`);
        }

        const transacao = await sequelize.transaction();
        try {
            await ImportacaoEvento.create({
                importacao_id,
                seq: evento.seq,
                criado_em: relogio(),
                sku: evento.sku || null,
                ml_id: evento.ml_id || null,
                titulo: truncar(evento.titulo, 300),
                resultado: evento.resultado,
                status_http: evento.status_http === undefined ? null : evento.status_http,
                quantidade_nova: evento.quantidade_nova === undefined ? null : evento.quantidade_nova,
                motivo: truncar(evento.motivo),
                duracao_ms: evento.duracao_ms === undefined ? null : evento.duracao_ms
            }, { transaction: transacao });

            // Uma instrucao, dois contadores: o CHECK nunca ve estado parcial.
            await Importacao.increment(
                { processados: 1, [coluna]: 1 },
                { where: { id: importacao_id }, transaction: transacao }
            );

            await Importacao.update(
                { heartbeat_em: relogio() },
                { where: { id: importacao_id }, transaction: transacao }
            );

            await transacao.commit();
            return true;
        } catch (erro) {
            await transacao.rollback();
            if (erro && erro.name === 'SequelizeUniqueConstraintError') {
                log.warn({ importacao_id, seq: evento.seq },
                    'ordinal de evento ja gravado: outro executor detem esta importacao');
                return false;
            }
            throw erro;
        }
    };

    const definirTotalAnuncios = async (id, total) => {
        await Importacao.update(
            { total_anuncios: total, heartbeat_em: relogio() },
            { where: { id } }
        );
    };

    const pedirCancelamento = async (id) => {
        const [linhas] = await Importacao.update(
            { cancelamento_pedido: true },
            {
                where: {
                    id,
                    estado: { [Op.in]: [ESTADOS.ANALISANDO, ESTADOS.AGUARDANDO_CONFIRMACAO, ESTADOS.PROCESSANDO] }
                }
            }
        );
        return linhas === 1;
    };

    /**
     * Estado terminal. Aceita apenas a partir de um estado em voo, para que uma
     * mensagem atrasada nao reabra nem reescreva um job ja encerrado.
     */
    const finalizar = async (id, estado, { erro_mensagem } = {}) => {
        const [linhas] = await Importacao.update({
            estado,
            erro_mensagem: truncar(erro_mensagem),
            concluida_em: relogio(),
            executor: null
        }, {
            where: {
                id,
                estado: { [Op.in]: [...ESTADOS_EM_VOO, ESTADOS.AGUARDANDO_CONFIRMACAO] }
            }
        });
        return linhas === 1;
    };

    /**
     * Reconciliador. Chamado na subida do processo e periodicamente: o que esta
     * em voo com heartbeat velho perdeu o executor (deploy, SIGKILL, queda) e
     * passa a interrompida, que e um estado honesto e retomavel.
     *
     * Nao marca concluida: o que foi feito esta nos eventos, e o que falta
     * continua faltando.
     */
    const reconciliar = async ({ toleranciaMs = 120000 } = {}) => {
        const corte = new Date(relogio().getTime() - toleranciaMs);

        const orfas = await Importacao.findAll({
            where: {
                estado: { [Op.in]: ESTADOS_EM_VOO },
                [Op.or]: [
                    { heartbeat_em: { [Op.lt]: corte } },
                    { heartbeat_em: null }
                ]
            },
            attributes: ['id', 'estado', 'heartbeat_em', 'processados', 'total_anuncios'],
            raw: true
        });

        for (const orfa of orfas) {
            await Importacao.update({
                estado: ESTADOS.INTERROMPIDA,
                erro_mensagem: 'execucao interrompida: o processo que a conduzia parou de responder',
                concluida_em: relogio(),
                executor: null
            }, { where: { id: orfa.id, estado: orfa.estado } });

            log.warn({
                importacao_id: orfa.id,
                estadoAnterior: orfa.estado,
                processados: orfa.processados,
                total: orfa.total_anuncios
            }, 'importacao orfa marcada como interrompida');
        }

        return orfas.map((o) => o.id);
    };

    /**
     * Invariante de contabilidade, verificavel pelo proprio banco. Devolve as
     * importacoes cuja soma nao fecha ou que processaram mais que o total
     * previsto. Em Postgres o CHECK impede a primeira; esta consulta cobre o
     * sqlite da suite e serve de verificacao independente em producao.
     */
    const verificarInvariantes = async ({ store_id = 1 } = {}) => {
        const linhas = await Importacao.findAll({
            where: { store_id },
            attributes: ['id', 'estado', 'processados', 'atualizados',
                'ja_atualizados', 'erros', 'ignorados', 'total_anuncios'],
            raw: true
        });

        return linhas.filter((l) => {
            const soma = l.atualizados + l.ja_atualizados + l.erros + l.ignorados;
            if (soma !== l.processados) return true;
            if (l.total_anuncios !== null && l.processados > l.total_anuncios) return true;
            return false;
        });
    };

    return {
        buscar,
        listar,
        listarEventos,
        lerProgressoGravado,
        lerCargaUtil,
        liberarCargaUtil,
        cancelamentoPedido,
        criar,
        registrarAnalise,
        confirmar,
        retomar,
        baterHeartbeat,
        gravarEvento,
        definirTotalAnuncios,
        pedirCancelamento,
        finalizar,
        reconciliar,
        verificarInvariantes
    };
};

module.exports = { criarRepositorioImportacoes, LIMITE_EVENTOS_POR_PAGINA };
