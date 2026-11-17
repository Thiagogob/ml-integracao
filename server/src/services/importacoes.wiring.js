// /server/src/services/importacoes.wiring.js
//
// Liga o orquestrador (importacoes.service.js) aos servicos reais. Fica em
// arquivo separado porque e justamente o que a suite NAO usa: lá as portas sao
// dublês e o banco e um sqlite em memoria.
//
// ESCOPO: apenas o relatorio de Sao Paulo (origem 'upload_pdf').
//
// Nao e limitacao, e precisao. Das tres rotas de envio existentes, so essa toca
// o Mercado Livre: 'upload_pdf_sul' carrega a entidade de estagio e harmoniza
// codigos de modelo, e 'upload_local' grava a planilha de estoque proprio.
// Nenhuma das duas chama processCriticalUpdates, logo nao ha anuncio a
// acompanhar nelas, e ambas terminam em segundos. Acompanhamento anuncio por
// anuncio so faz sentido onde existem ~980 anuncios e 500 ms entre chamadas.

const { sequelize, Importacao, ImportacaoEvento } = require('../config/database');
const logger = require('../config/logger');
const pdfService = require('./pdf.service');
const stockService = require('./stock.service');
const meliService = require('./meli.service');
const anunciosService = require('./anuncios.service');
const { criarRepositorioImportacoes } = require('./importacoes.repo');
const { criarServicoImportacoes, ORIGENS } = require('./importacoes.service');

// Origens para as quais a importacao acompanhada esta implementada
const ORIGENS_ACOMPANHADAS = [ORIGENS.PDF_SP];

// Dublê de sincronizacao usado quando queremos que saveStock grave o estoque
// mas NAO fale com o Mercado Livre. O laco do orquestrador assume essa parte,
// anuncio por anuncio, para poder registrar evento em cada um. Devolve o mesmo
// formato que processCriticalUpdates devolveria vazio.
const semSincronizacaoDeAnuncios = async () => ({
    atualizados: [],
    jaAtualizados: [],
    erros: [],
    debugTrace: []
});

const criarPortasDeProducao = () => ({
    /**
     * Le o arquivo cru. Para o PDF de Sao Paulo, texto limpo.
     */
    lerArquivo: async ({ buffer, origem }) => {
        if (origem !== ORIGENS.PDF_SP) {
            throw Object.assign(
                new Error(`importacao acompanhada nao implementada para a origem ${origem}`),
                { codigo: 'ORIGEM_NAO_ACOMPANHADA' }
            );
        }
        return pdfService.parsePdf(buffer);
    },

    extrairRodas: async ({ conteudo, origem }) => {
        if (origem !== ORIGENS.PDF_SP) {
            throw Object.assign(
                new Error(`importacao acompanhada nao implementada para a origem ${origem}`),
                { codigo: 'ORIGEM_NAO_ACOMPANHADA' }
            );
        }
        return stockService.parseTxtToWheels(conteudo);
    },

    /**
     * Conferencia. saveStock em dryRun faz a normalizacao, o cruzamento com o
     * cadastro e o diagnostico, e desfaz a transacao sem gravar. Nao usa o
     * token: a fase de analise nao fala com o Mercado Livre.
     */
    conferir: async ({ rodas }) =>
        stockService.saveStock(rodas, null, semSincronizacaoDeAnuncios, { dryRun: true }),

    /**
     * Aplica o estoque consolidado. A sincronizacao dos anuncios e passada como
     * dublê vazio de proposito: ela e conduzida pelo laco do orquestrador.
     */
    aplicarEstoque: async ({ rodas }) =>
        stockService.saveStock(rodas, null, semSincronizacaoDeAnuncios),

    expandirAnuncios: async (skus) => anunciosService.expandirAnunciosPorSkus(skus),

    /**
     * Token do Mercado Livre, renovado se o atual nao responder. Mesma logica
     * do controller legado.
     */
    obterToken: async () => {
        const atual = await meliService.authTest();
        if (!atual) {
            logger.info('token invalido, gerando novo token');
            return meliService.getAuth();
        }
        return atual;
    },

    sincronizarAnuncio: (argumentos) => meliService.sincronizarAnuncio(argumentos)
});

let instancia = null;

/**
 * Instancia unica do servico, usada pelo controller e pelo server.js.
 */
const obterServicoImportacoes = () => {
    if (instancia) return instancia;

    const repo = criarRepositorioImportacoes({
        Importacao,
        ImportacaoEvento,
        sequelize,
        logger
    });

    instancia = criarServicoImportacoes({
        repo,
        portas: criarPortasDeProducao(),
        logger
    });

    return instancia;
};

module.exports = {
    obterServicoImportacoes,
    criarPortasDeProducao,
    semSincronizacaoDeAnuncios,
    ORIGENS_ACOMPANHADAS
};
