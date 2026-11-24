// /server/src/services/importacoes.service.js
//
// Orquestrador da importacao acompanhada de relatorio de estoque.
//
// POR QUE ISTO EXISTE
//
// O caminho legado (POST /api/stock/upload-pdf) faz tudo em uma requisicao
// sincrona e responde uma frase no fim. Medido nos relatorios reais de abril de
// 2026, em server/logs/sync-*.json, uma execucao toca ~980 anuncios, e
// meli.service impoe 500 ms entre chamadas ao Mercado Livre para nao estourar o
// limite de taxa: 490 segundos de espera deliberada, como piso. O cliente tem
// timeout de 10 segundos. Nao e uma tela que falta, e o ciclo de vida do job.
//
// A MAQUINA DE ESTADOS
//
//   analisando ──► aguardando_confirmacao ──► processando ──► concluida
//        │                   │                     │
//        │                   │                     ├──► falhou
//        │                   │                     ├──► cancelada
//        │                   │                     └──► interrompida ──┐
//        └──► falhou         └──► cancelada                            │
//                                                                      │
//                                        retomar() volta a processando ┘
//
// Duas garantias que vem da divisao:
//
//   1. Entre 'analisando' e 'aguardando_confirmacao' nada e gravado e nada e
//      enviado ao Mercado Livre. O operador ve o diagnostico antes de autorizar.
//      A fase de analise nao usa nem o token do ML.
//
//   2. 'interrompida' e um estado honesto, nao um erro. O Railway manda SIGTERM
//      a cada deploy e uma execucao de vinte minutos sera morta no meio. O que
//      ja foi feito esta nos eventos; o que falta continua faltando; a retomada
//      pula o que tem evento gravado.
//
// AS PORTAS
//
// Tudo que fala com o mundo entra por parametro: repositorio, leitura de PDF,
// conferencia, aplicacao do estoque, expansao em anuncios, sincronizacao de um
// anuncio e relogio. E por isso que a suite exercita a maquina de estados
// inteira sobre sqlite em memoria, com um dublê do Mercado Livre, sem Postgres e
// sem credencial.

const crypto = require('crypto');
const { ESTADOS, RESULTADOS } = require('../config/models/importacoes');

// Quanto tempo sem heartbeat para considerar que o executor morreu.
// Folga generosa sobre o pior caso de um anuncio: 500 ms de espera deliberada
// mais as chamadas ao ML com retentativa exponencial.
const TOLERANCIA_HEARTBEAT_MS = 120000;

const ORIGENS = {
    PDF_SP: 'upload_pdf',
    PDF_SUL: 'upload_pdf_sul',
    PLANILHA_LOCAL: 'upload_local'
};

const sha256 = (buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

const chaveDoAnuncio = (item) => `${item.sku || ''}|${item.ml_id || ''}`;

/**
 * @param {object} deps
 * @param {object} deps.repo             criarRepositorioImportacoes(...)
 * @param {object} deps.portas           ver criarPortasDeProducao em importacoes.wiring.js
 * @param {object} [deps.logger]
 * @param {() => Date} [deps.agora]
 * @param {string} [deps.executorId]     identifica este processo
 * @param {number} [deps.toleranciaHeartbeatMs]
 */
const criarServicoImportacoes = ({
    repo,
    portas,
    logger,
    agora,
    executorId,
    toleranciaHeartbeatMs = TOLERANCIA_HEARTBEAT_MS
}) => {
    const log = logger || { info() {}, warn() {}, error() {}, debug() {} };
    const relogio = agora || (() => new Date());
    const executor = executorId || `${process.pid}@${process.env.RAILWAY_REPLICA_ID || 'local'}`;

    // Execucoes em andamento neste processo. Serve ao desligamento ordenado:
    // ao receber SIGTERM marcamos o que esta em voo como interrompido antes de
    // sair, em lugar de deixar o reconciliador descobrir dois minutos depois.
    const emAndamento = new Map();

    // ------------------------------------------------------------------ fase 1

    /**
     * Recebe o arquivo e conduz a analise. Nao grava estoque, nao chama o
     * Mercado Livre e nao exige token.
     *
     * @returns {Promise<{importacao: object} | {conflito: object}>}
     */
    const receberArquivo = async ({
        origem, buffer, arquivo_nome, arquivo_caminho = null,
        store_id = 1, usuario_id = null, usuario_nome = null
    }) => {
        if (!buffer || buffer.length === 0) {
            throw Object.assign(new Error('arquivo vazio'), { codigo: 'ARQUIVO_VAZIO' });
        }
        if (!Object.values(ORIGENS).includes(origem)) {
            throw Object.assign(new Error(`origem desconhecida: ${origem}`), { codigo: 'ORIGEM_INVALIDA' });
        }

        const hash = sha256(buffer);

        const criacao = await repo.criar({
            origem,
            store_id,
            arquivo_nome,
            arquivo_bytes: buffer.length,
            arquivo_sha256: hash,
            usuario_id,
            usuario_nome
        });

        if (criacao.conflito) {
            log.warn({
                importacao_id: criacao.conflito.id,
                estado: criacao.conflito.estado,
                sha256: hash
            }, 'reenvio do mesmo arquivo recusado: ja existe importacao viva com este conteudo');
            return criacao;
        }

        const importacao = criacao.importacao;

        try {
            const textoOuPlanilha = await portas.lerArquivo({ buffer, origem });
            const rodas = await portas.extrairRodas({ conteudo: textoOuPlanilha, origem });

            if (!Array.isArray(rodas) || rodas.length === 0) {
                throw Object.assign(
                    new Error('nenhuma linha de roda foi reconhecida no arquivo'),
                    { codigo: 'ARQUIVO_SEM_LINHAS' }
                );
            }

            // Conferencia: normaliza, cruza com o cadastro e diagnostica, sem
            // gravar nada e sem token do Mercado Livre.
            const diagnostico = await portas.conferir({ rodas, origem });

            // Expansao em pares (sku, ml_id), para o total do progresso ser real
            const plano = await portas.expandirAnuncios(diagnostico.planoML || []);

            const gravou = await repo.registrarAnalise(importacao.id, {
                resumo: diagnostico.resumo,
                detalhe_analise: {
                    semSKU: diagnostico.semSKU || [],
                    naoEncontradas: diagnostico.naoEncontradas || [],
                    comSKUNaoCobertasPeloPDF: diagnostico.comSKUNaoCobertasPeloPDF || [],
                    formatoNovoDetectado: diagnostico.formatoNovoDetectado ?? null
                },
                total_anuncios: plano.length,
                entrada_rodas: rodas,
                plano_anuncios: plano
            });

            if (!gravou) {
                // Alguem cancelou durante a analise
                log.warn({ importacao_id: importacao.id },
                    'analise concluida mas a importacao ja nao estava em analisando');
            }

            log.info({
                importacao_id: importacao.id,
                linhasNoArquivo: rodas.length,
                skusParaML: (diagnostico.planoML || []).length,
                anunciosPrevistos: plano.length
            }, 'analise concluida: aguardando confirmacao do operador');

            return { importacao: await repo.buscar(importacao.id) };
        } catch (erro) {
            await repo.finalizar(importacao.id, ESTADOS.FALHOU, {
                erro_mensagem: `falha na analise: ${erro.message}`
            });
            log.error({ err: erro, importacao_id: importacao.id }, 'falha na analise do arquivo');
            throw erro;
        }
    };

    // ------------------------------------------------------------------ fase 2

    /**
     * Confirmacao do operador. Toma o job por comparacao e troca e dispara a
     * execucao sem esperar por ela: quem chamou recebe 202 e passa a acompanhar
     * pelo estado.
     */
    const confirmar = async (id) => {
        const importacao = await repo.buscar(id);
        if (!importacao) return { erro: 'NAO_ENCONTRADA' };
        if (importacao.estado !== ESTADOS.AGUARDANDO_CONFIRMACAO) {
            return { erro: 'ESTADO_INVALIDO', estado: importacao.estado };
        }

        const tomou = await repo.confirmar(id, { executor });
        if (!tomou) {
            const atual = await repo.buscar(id);
            return { erro: 'ESTADO_INVALIDO', estado: atual ? atual.estado : null };
        }

        dispararExecucao(id);
        return { importacao: await repo.buscar(id) };
    };

    const retomar = async (id) => {
        const importacao = await repo.buscar(id);
        if (!importacao) return { erro: 'NAO_ENCONTRADA' };
        if (importacao.estado !== ESTADOS.INTERROMPIDA) {
            return { erro: 'ESTADO_INVALIDO', estado: importacao.estado };
        }

        const tomou = await repo.retomar(id, { executor });
        if (!tomou) {
            const atual = await repo.buscar(id);
            return { erro: 'ESTADO_INVALIDO', estado: atual ? atual.estado : null };
        }

        dispararExecucao(id);
        return { importacao: await repo.buscar(id) };
    };

    const cancelar = async (id) => {
        const pediu = await repo.pedirCancelamento(id);
        if (!pediu) {
            const atual = await repo.buscar(id);
            return { erro: 'ESTADO_INVALIDO', estado: atual ? atual.estado : null };
        }

        const importacao = await repo.buscar(id);

        // Se ainda nao comecou a executar, nao ha laco para reagir ao pedido:
        // encerra na hora.
        if (importacao.estado === ESTADOS.AGUARDANDO_CONFIRMACAO) {
            await repo.finalizar(id, ESTADOS.CANCELADA, {
                erro_mensagem: 'cancelada pelo operador antes da confirmacao'
            });
            await repo.liberarCargaUtil(id);
        }

        return { importacao: await repo.buscar(id) };
    };

    /**
     * Dispara a execucao em segundo plano. A promessa e guardada para o
     * desligamento ordenado poder esperar por ela; o erro e tratado dentro de
     * executar(), nunca escapa para um rejeicao nao capturada.
     */
    const dispararExecucao = (id) => {
        const promessa = executar(id)
            .catch((erro) => {
                log.error({ err: erro, importacao_id: id }, 'execucao terminou com erro nao tratado');
            })
            .finally(() => {
                emAndamento.delete(id);
            });
        emAndamento.set(id, promessa);
        return promessa;
    };

    /**
     * O laco. Grava o estoque, percorre os anuncios, registra um evento em cada
     * um e respeita o pedido de cancelamento.
     *
     * O erro de um anuncio nao derruba o lote: vira evento de resultado 'erro'
     * e o laco segue. Isto difere do caminho legado, cujo catch e por SKU e
     * abandona os anuncios restantes daquele SKU.
     */
    const executar = async (id) => {
        const inicio = relogio().getTime();

        try {
            const carga = await repo.lerCargaUtil(id);

            // O repositorio ja garante vetores; esta checagem e a segunda
            // barreira contra iterar uma string como se fosse lista de anuncios.
            if (carga && (!Array.isArray(carga.plano) || !Array.isArray(carga.rodas))) {
                throw new Error('carga util da importacao em formato inesperado');
            }

            if (!carga || carga.plano.length === 0) {
                // Nada a sincronizar: ainda assim o estoque precisa ser gravado
                if (carga && carga.rodas.length > 0) {
                    await portas.aplicarEstoque({ rodas: carga.rodas });
                }
                await repo.finalizar(id, ESTADOS.CONCLUIDA);
                await repo.liberarCargaUtil(id);
                log.info({ importacao_id: id }, 'importacao concluida sem anuncios a sincronizar');
                return;
            }

            const { jaFeitos, maiorSeq } = await repo.lerProgressoGravado(id);
            const retomada = jaFeitos.size > 0;

            // Na primeira passada o estoque e gravado. Numa retomada nao: ja
            // foi gravado antes da interrupcao, e o upsert por chave natural
            // seria idempotente, mas repetir 1.613 linhas sem necessidade e
            // desperdicio.
            if (!retomada) {
                await portas.aplicarEstoque({ rodas: carga.rodas });
                log.info({ importacao_id: id, linhas: carga.rodas.length },
                    'estoque consolidado gravado; iniciando sincronizacao dos anuncios');
            } else {
                log.info({ importacao_id: id, jaFeitos: jaFeitos.size },
                    'retomando importacao interrompida; anuncios ja registrados serao pulados');
            }

            const access_token = await portas.obterToken();
            let seq = maiorSeq;
            let cancelou = false;

            for (let indice = 0; indice < carga.plano.length; indice += 1) {
                const item = carga.plano[indice];

                if (jaFeitos.has(chaveDoAnuncio(item))) continue;

                // Cancelamento cooperativo: consultado entre anuncios, de modo
                // que o laco para em ponto consistente e nunca no meio de uma
                // chamada ao Mercado Livre.
                if (await repo.cancelamentoPedido(id)) {
                    cancelou = true;
                    break;
                }

                seq += 1;
                let evento;

                try {
                    const desfecho = await portas.sincronizarAnuncio({
                        sku: item.sku,
                        ml_id: item.ml_id,
                        access_token,
                        origem: ORIGENS.PDF_SP
                    });

                    evento = {
                        seq,
                        sku: item.sku,
                        ml_id: item.ml_id,
                        titulo: item.titulo,
                        resultado: desfecho.resultado,
                        status_http: desfecho.status_http,
                        quantidade_nova: desfecho.quantidade_nova,
                        motivo: desfecho.motivo,
                        duracao_ms: desfecho.duracao_ms
                    };
                } catch (erroDoAnuncio) {
                    // Um anuncio que falha nao derruba os outros 979.
                    evento = {
                        seq,
                        sku: item.sku,
                        ml_id: item.ml_id,
                        titulo: item.titulo,
                        resultado: RESULTADOS.ERRO,
                        status_http: erroDoAnuncio.statusHttp || null,
                        motivo: erroDoAnuncio.message,
                        duracao_ms: null
                    };
                    log.warn({
                        err: erroDoAnuncio,
                        importacao_id: id,
                        sku: item.sku,
                        ml_id: item.ml_id
                    }, 'anuncio falhou; a importacao segue para o proximo');
                }

                const gravou = await repo.gravarEvento(id, evento);
                if (!gravou) {
                    // Ordinal ja existia: outro executor detem este job. Sair e
                    // o certo, insistir duplicaria chamadas ao Mercado Livre.
                    log.error({ importacao_id: id, seq },
                        'abandonando a execucao: outro executor detem esta importacao');
                    return;
                }
            }

            if (cancelou) {
                await repo.finalizar(id, ESTADOS.CANCELADA, {
                    erro_mensagem: 'cancelada pelo operador durante a execucao'
                });
                await repo.liberarCargaUtil(id);
                log.warn({ importacao_id: id }, 'importacao cancelada pelo operador');
                return;
            }

            await repo.finalizar(id, ESTADOS.CONCLUIDA);
            await repo.liberarCargaUtil(id);

            const final = await repo.buscar(id);
            log.info({
                importacao_id: id,
                duracaoSegundos: Math.round((relogio().getTime() - inicio) / 1000),
                processados: final.processados,
                atualizados: final.atualizados,
                jaAtualizados: final.ja_atualizados,
                erros: final.erros,
                ignorados: final.ignorados
            }, 'importacao concluida');
        } catch (erro) {
            await repo.finalizar(id, ESTADOS.FALHOU, { erro_mensagem: erro.message });
            log.error({ err: erro, importacao_id: id }, 'importacao falhou');
        }
    };

    // ---------------------------------------------------------------- consultas

    const obter = async (id) => {
        const importacao = await repo.buscar(id);
        if (!importacao) return null;
        return { ...importacao, ...derivarProgresso(importacao) };
    };

    const listar = (opcoes) => repo.listar(opcoes);

    const eventos = (opcoes) => repo.listarEventos(opcoes);

    /**
     * Estimativa de termino a partir da vazao MEDIDA nesta execucao, nao de uma
     * constante. Com 980 anuncios e 500 ms de espera deliberada por anuncio, o
     * numero chutado erraria por minutos.
     */
    const derivarProgresso = (importacao) => {
        const total = importacao.total_anuncios;
        const feitos = importacao.processados;

        const percentual = total && total > 0
            ? Math.min(100, Math.round((feitos / total) * 1000) / 10)
            : null;

        let vazaoPorSegundo = null;
        let segundosRestantes = null;

        if (importacao.iniciada_em && feitos > 0) {
            const referencia = importacao.estado === ESTADOS.PROCESSANDO
                ? relogio().getTime()
                : new Date(importacao.concluida_em || importacao.heartbeat_em || relogio()).getTime();
            const decorridoS = (referencia - new Date(importacao.iniciada_em).getTime()) / 1000;

            if (decorridoS > 0) {
                vazaoPorSegundo = Math.round((feitos / decorridoS) * 100) / 100;
                if (total && total > feitos && vazaoPorSegundo > 0) {
                    segundosRestantes = Math.round((total - feitos) / vazaoPorSegundo);
                }
            }
        }

        return {
            percentual,
            vazao_por_segundo: vazaoPorSegundo,
            segundos_restantes: importacao.estado === ESTADOS.PROCESSANDO ? segundosRestantes : null,
            em_voo: importacao.estado === ESTADOS.PROCESSANDO || importacao.estado === ESTADOS.ANALISANDO,
            retomavel: importacao.estado === ESTADOS.INTERROMPIDA,
            soma_bate: importacao.processados ===
                (importacao.atualizados + importacao.ja_atualizados +
                 importacao.erros + importacao.ignorados)
        };
    };

    // ------------------------------------------------------- ciclo do processo

    /**
     * Chamado na subida. Marca como interrompida toda importacao em voo cujo
     * heartbeat envelheceu, o que inclui tudo que o deploy anterior matou.
     */
    const reconciliar = () => repo.reconciliar({ toleranciaMs: toleranciaHeartbeatMs });

    /**
     * Desligamento ordenado. Pede cancelamento ao que esta em voo neste
     * processo e espera um tempo curto; o que nao terminar fica para o
     * reconciliador da proxima subida, que o marcara interrompido.
     */
    const desligar = async ({ esperaMaximaMs = 5000 } = {}) => {
        if (emAndamento.size === 0) return;

        log.warn({ emAndamento: [...emAndamento.keys()] },
            'desligando: pedindo cancelamento das importacoes em voo');

        for (const id of emAndamento.keys()) {
            await repo.pedirCancelamento(id).catch(() => {});
        }

        await Promise.race([
            Promise.allSettled([...emAndamento.values()]),
            new Promise((resolve) => setTimeout(resolve, esperaMaximaMs))
        ]);
    };

    return {
        receberArquivo,
        confirmar,
        retomar,
        cancelar,
        obter,
        listar,
        eventos,
        reconciliar,
        desligar,
        derivarProgresso,
        // expostos para a suite
        _executar: executar,
        _dispararExecucao: dispararExecucao,
        _emAndamento: emAndamento
    };
};

module.exports = {
    criarServicoImportacoes,
    ORIGENS,
    TOLERANCIA_HEARTBEAT_MS,
    sha256,
    chaveDoAnuncio
};
