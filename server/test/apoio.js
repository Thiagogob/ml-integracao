// /server/test/apoio.js
//
// Bancada de testes da importacao acompanhada.
//
// Monta a maquina de estados inteira sobre um sqlite em memoria, com dublês no
// lugar das portas. Nao requer Postgres, nao requer credencial do Mercado Livre
// e nao carrega src/config/database.js, que exige variaveis de ambiente.
//
// E possivel porque o orquestrador recebe tudo que fala com o mundo por
// parametro: repositorio, leitura do arquivo, conferencia, gravacao do estoque,
// expansao em anuncios, sincronizacao de um anuncio e relogio.

const { Sequelize } = require('sequelize');
const { definirModelosImportacao } = require('../src/config/models/importacoes');
const { criarRepositorioImportacoes } = require('../src/services/importacoes.repo');
const { criarServicoImportacoes, ORIGENS } = require('../src/services/importacoes.service');

const silencioso = { info() {}, warn() {}, error() {}, debug() {} };

/**
 * Relogio controlavel. Os testes de heartbeat precisam adiantar o tempo sem
 * esperar por ele.
 */
const criarRelogio = (inicio = new Date('2026-11-17T09:00:00.000Z')) => {
    let agora = new Date(inicio);
    return {
        agora: () => new Date(agora),
        avancarMs: (ms) => { agora = new Date(agora.getTime() + ms); },
        definir: (d) => { agora = new Date(d); }
    };
};

/**
 * Dublê do Mercado Livre.
 *
 * @param {object} opcoes
 * @param {(item) => object} opcoes.responder recebe {sku, ml_id} e devolve
 *   { resultado, status_http?, motivo?, quantidade_nova? }, ou lanca para
 *   simular queda de rede, 429 esgotado etc.
 */
const criarMlFalso = ({ responder } = {}) => {
    const chamadas = [];
    const padrao = () => ({ resultado: 'atualizado', status_http: 200, quantidade_nova: 4 });

    return {
        chamadas,
        sincronizarAnuncio: async (item) => {
            chamadas.push({ sku: item.sku, ml_id: item.ml_id });
            // await obrigatorio: um responder assincrono devolveria uma
            // promessa, que espalhada em objeto perderia o campo resultado
            const desfecho = await (responder || padrao)(item, chamadas.length);
            if (desfecho instanceof Error) throw desfecho;
            return { duracao_ms: 1, ...desfecho };
        }
    };
};

/**
 * @param {object} opcoes
 * @param {Array<{sku:string, ml_id:string, titulo?:string}>} [opcoes.plano]
 * @param {object[]} [opcoes.rodas]
 * @param {Function} [opcoes.responderML]
 * @param {object} [opcoes.diagnostico]
 */
const montarBancada = async ({
    plano = [{ sku: 'SKU-1', ml_id: 'MLB1', titulo: 'Roda 1' }],
    rodas = [{ MODELO: 'ak2010', ARO: '20x8' }],
    responderML,
    diagnostico,
    toleranciaHeartbeatMs = 120000
} = {}) => {
    const sequelize = new Sequelize({
        dialect: 'sqlite',
        storage: ':memory:',
        logging: false
    });

    const { Importacao, ImportacaoEvento } = definirModelosImportacao(sequelize);
    await sequelize.sync({ force: true });

    const relogio = criarRelogio();
    const ml = criarMlFalso({ responder: responderML });

    const repo = criarRepositorioImportacoes({
        Importacao,
        ImportacaoEvento,
        sequelize,
        logger: silencioso,
        agora: relogio.agora
    });

    // Registro do que cada porta recebeu, para os testes afirmarem que a fase
    // de conferencia nao tocou em nada.
    const registro = {
        lerArquivo: 0,
        extrairRodas: 0,
        conferir: 0,
        aplicarEstoque: 0,
        expandirAnuncios: 0,
        obterToken: 0
    };

    const diagnosticoPadrao = {
        timestamp: relogio.agora().toISOString(),
        formatoNovoDetectado: false,
        resumo: {
            totalRodasNoPDF: rodas.length,
            atualizadasComSKU: new Set(plano.map((p) => p.sku)).size,
            semSKUNoBanco: 0,
            novasNaoEncontradas: 0,
            comSKUNaoCobertasPeloPDF: 0
        },
        semSKU: [],
        naoEncontradas: [],
        comSKUNaoCobertasPeloPDF: [],
        planoML: [...new Set(plano.map((p) => p.sku))],
        resultadosML: null
    };

    const portas = {
        lerArquivo: async () => { registro.lerArquivo += 1; return 'texto cru do pdf'; },
        extrairRodas: async () => { registro.extrairRodas += 1; return rodas; },
        conferir: async () => { registro.conferir += 1; return diagnostico || diagnosticoPadrao; },
        aplicarEstoque: async () => { registro.aplicarEstoque += 1; return { ok: true }; },
        expandirAnuncios: async () => { registro.expandirAnuncios += 1; return plano; },
        obterToken: async () => { registro.obterToken += 1; return 'token-de-teste'; },
        sincronizarAnuncio: ml.sincronizarAnuncio
    };

    const servico = criarServicoImportacoes({
        repo,
        portas,
        logger: silencioso,
        agora: relogio.agora,
        executorId: 'executor-de-teste',
        toleranciaHeartbeatMs
    });

    /**
     * Simula a morte do processo no meio da fila, pelo mecanismo real.
     *
     * Quando repo.gravarEvento devolve false, o executor entende que outro
     * processo detem o job e abandona SEM finalizar, deixando o estado em
     * 'processando' com heartbeat congelado. E exatamente o rastro que um
     * SIGKILL deixa, e nao exige mexer no banco a mao nem no estado.
     */
    const matarExecutorNoEvento = (seqDeCorte) => {
        const original = repo.gravarEvento;
        repo.gravarEvento = async (id, evento) => {
            if (evento.seq >= seqDeCorte) return false;
            return original(id, evento);
        };
        return () => { repo.gravarEvento = original; };
    };

    return {
        sequelize, Importacao, ImportacaoEvento,
        repo, servico, portas, registro, ml, relogio, plano, rodas,
        ORIGENS,
        matarExecutorNoEvento,
        fechar: () => sequelize.close()
    };
};

const enviar = (bancada, conteudo = 'relatorio-a') =>
    bancada.servico.receberArquivo({
        origem: ORIGENS.PDF_SP,
        buffer: Buffer.from(conteudo),
        arquivo_nome: 'relatorio.pdf',
        store_id: 1,
        usuario_id: 7,
        usuario_nome: 'operador'
    });

module.exports = { montarBancada, enviar, criarRelogio, criarMlFalso, silencioso };
