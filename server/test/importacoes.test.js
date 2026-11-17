// /server/test/importacoes.test.js
//
// Suite da importacao acompanhada. Roda com `npm test` no diretorio server,
// sem Postgres e sem credencial do Mercado Livre.
//
// O que cada bloco prova esta dito no nome do teste. Os dois que mais importam
// sao os dois ultimos: o do processo morto no meio, que exige estado honesto, e
// o de regressao contra a execucao real de 24 de abril de 2026, que exige os
// mesmos 980 anuncios e os mesmos 24 rejeitados.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { montarBancada, enviar } = require('./apoio');
const { ESTADOS, RESULTADOS } = require('../src/config/models/importacoes');
const { sha256, chaveDoAnuncio } = require('../src/services/importacoes.service');

const planoDe = (n) => Array.from({ length: n }, (_, i) => ({
    sku: `SKU-${i + 1}`,
    ml_id: `MLB${1000 + i}`,
    titulo: `Roda ${i + 1}`
}));

// ---------------------------------------------------------------- fase 1

test('a conferencia nao grava estoque, nao chama o Mercado Livre e nao pede token', async (t) => {
    const b = await montarBancada({ plano: planoDe(3) });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);

    assert.equal(importacao.estado, ESTADOS.AGUARDANDO_CONFIRMACAO);
    assert.equal(b.registro.conferir, 1, 'a conferencia deve ter rodado');
    assert.equal(b.registro.aplicarEstoque, 0, 'nada pode ser gravado no estoque antes de confirmar');
    assert.equal(b.ml.chamadas.length, 0, 'nenhum anuncio pode ser tocado antes de confirmar');
    assert.equal(b.registro.obterToken, 0, 'a analise nao deve nem pedir o token do ML');
});

test('a analise grava o total de anuncios previsto e o diagnostico', async (t) => {
    const b = await montarBancada({ plano: planoDe(5) });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);

    assert.equal(importacao.total_anuncios, 5);
    assert.equal(importacao.resumo.totalRodasNoPDF, b.rodas.length);
    assert.equal(importacao.processados, 0);
    assert.ok(importacao.arquivo_sha256, 'o hash do conteudo deve ser gravado');
    assert.equal(importacao.arquivo_sha256, sha256(Buffer.from('relatorio-a')));
});

test('arquivo sem nenhuma linha reconhecida faz a importacao falhar na analise', async (t) => {
    const b = await montarBancada();
    t.after(() => b.fechar());
    b.portas.extrairRodas = async () => [];

    await assert.rejects(() => enviar(b), /nenhuma linha de roda/i);

    const [registro] = await b.repo.listar({});
    assert.equal(registro.estado, ESTADOS.FALHOU);
    assert.match(registro.erro_mensagem, /falha na analise/);
});

// ------------------------------------------------------------- idempotencia

test('reenviar o mesmo arquivo e recusado por hash, sem criar segunda importacao', async (t) => {
    const b = await montarBancada({ plano: planoDe(2) });
    t.after(() => b.fechar());

    const primeiro = await enviar(b, 'mesmo-conteudo');
    const segundo = await enviar(b, 'mesmo-conteudo');

    assert.ok(primeiro.importacao);
    assert.ok(segundo.conflito, 'o segundo envio deve devolver conflito');
    assert.equal(segundo.conflito.id, primeiro.importacao.id);

    const todas = await b.repo.listar({});
    assert.equal(todas.length, 1, 'nao pode existir uma segunda importacao do mesmo arquivo');
});

test('arquivo diferente passa, e reenvio apos cancelamento tambem', async (t) => {
    const b = await montarBancada({ plano: planoDe(2) });
    t.after(() => b.fechar());

    const a = await enviar(b, 'conteudo-a');
    const c = await enviar(b, 'conteudo-b');
    assert.ok(c.importacao, 'arquivo de conteudo diferente deve ser aceito');

    // cancelada deixa de bloquear o reenvio: reenviar e justamente a correcao
    await b.servico.cancelar(a.importacao.id);
    const reenvio = await enviar(b, 'conteudo-a');
    assert.ok(reenvio.importacao, 'depois de cancelar, o mesmo arquivo pode voltar');
});

// ----------------------------------------------------------------- fase 2

test('o caminho completo conclui, grava um evento por anuncio e os contadores fecham', async (t) => {
    const b = await montarBancada({ plano: planoDe(7) });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);
    await b.servico.confirmar(importacao.id);
    await Promise.allSettled([...b.servico._emAndamento.values()]);

    const final = await b.servico.obter(importacao.id);

    assert.equal(final.estado, ESTADOS.CONCLUIDA);
    assert.equal(b.registro.aplicarEstoque, 1, 'o estoque e gravado uma vez, depois de confirmar');
    assert.equal(b.registro.obterToken, 1);
    assert.equal(final.processados, 7);
    assert.equal(final.atualizados, 7);
    assert.equal(final.percentual, 100);
    assert.equal(final.soma_bate, true);

    const eventos = await b.repo.listarEventos({ importacao_id: importacao.id, limite: 500 });
    assert.equal(eventos.length, 7);
    assert.deepEqual(eventos.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7]);
    assert.equal(eventos[0].titulo, 'Roda 1');
    assert.equal(eventos[0].quantidade_nova, 4);

    const quebras = await b.repo.verificarInvariantes({});
    assert.deepEqual(quebras, [], 'nenhuma importacao pode violar o invariante de contadores');
});

test('confirmar duas vezes nao executa duas vezes', async (t) => {
    const b = await montarBancada({ plano: planoDe(4) });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);
    const [um, dois] = await Promise.all([
        b.servico.confirmar(importacao.id),
        b.servico.confirmar(importacao.id)
    ]);
    await Promise.allSettled([...b.servico._emAndamento.values()]);

    const vencedores = [um, dois].filter((r) => r.importacao).length;
    assert.equal(vencedores, 1, 'so uma das confirmacoes pode vencer');
    assert.equal(b.ml.chamadas.length, 4, 'cada anuncio deve ser tocado uma unica vez');
});

test('confirmar algo que nao esta aguardando confirmacao devolve estado invalido', async (t) => {
    const b = await montarBancada({ plano: planoDe(2) });
    t.after(() => b.fechar());

    const desfecho = await b.servico.confirmar(999);
    assert.equal(desfecho.erro, 'NAO_ENCONTRADA');
});

// ------------------------------------------------- classificacao do desfecho

test('classifica 200, 400 de validacao, 409, ignorado e erro, e o erro nao derruba o lote', async (t) => {
    const plano = planoDe(5);
    const b = await montarBancada({
        plano,
        responderML: (item) => {
            if (item.ml_id === 'MLB1001') {
                return { resultado: RESULTADOS.JA_ATUALIZADO, status_http: 400, motivo: 'Image validation bypassed.' };
            }
            if (item.ml_id === 'MLB1002') {
                return { resultado: RESULTADOS.JA_ATUALIZADO, status_http: 409, motivo: 'conflito' };
            }
            if (item.ml_id === 'MLB1003') {
                // queda de rede: o dublê lanca, como o fetch real lancaria
                return Object.assign(new Error('fetch failed'), { statusHttp: null });
            }
            if (item.ml_id === 'MLB1004') {
                return { resultado: RESULTADOS.IGNORADO, motivo: 'anuncio sem nenhum SKU de roda no estoque' };
            }
            return { resultado: RESULTADOS.ATUALIZADO, status_http: 200, quantidade_nova: 8 };
        }
    });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);
    await b.servico.confirmar(importacao.id);
    await Promise.allSettled([...b.servico._emAndamento.values()]);

    const final = await b.servico.obter(importacao.id);

    assert.equal(final.estado, ESTADOS.CONCLUIDA, 'um anuncio com erro nao pode derrubar a importacao');
    assert.equal(final.processados, 5);
    assert.equal(final.atualizados, 1);
    assert.equal(final.ja_atualizados, 2);
    assert.equal(final.erros, 1);
    assert.equal(final.ignorados, 1);
    assert.equal(final.soma_bate, true);
    assert.equal(b.ml.chamadas.length, 5, 'o laco deve ter seguido ate o fim');

    const comErro = await b.repo.listarEventos({
        importacao_id: importacao.id, resultado: RESULTADOS.ERRO, limite: 10
    });
    assert.equal(comErro.length, 1);
    assert.match(comErro[0].motivo, /fetch failed/);
});

test('um 429 que esgotou as retentativas entra como erro, com o status registrado', async (t) => {
    const b = await montarBancada({
        plano: planoDe(2),
        responderML: (item) => item.ml_id === 'MLB1000'
            ? Object.assign(new Error('Falha na atualização do estoque (Status 429).'), { statusHttp: 429 })
            : { resultado: RESULTADOS.ATUALIZADO, status_http: 200 }
    });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);
    await b.servico.confirmar(importacao.id);
    await Promise.allSettled([...b.servico._emAndamento.values()]);

    const eventos = await b.repo.listarEventos({ importacao_id: importacao.id, limite: 10 });
    const doErro = eventos.find((e) => e.resultado === RESULTADOS.ERRO);

    assert.ok(doErro, 'o 429 esgotado deve virar evento de erro');
    assert.equal(doErro.status_http, 429);
    const final = await b.servico.obter(importacao.id);
    assert.equal(final.estado, ESTADOS.CONCLUIDA);
    assert.equal(final.atualizados, 1);
});

// ------------------------------------------------------------- cancelamento

test('o cancelamento no meio para o laco em ponto consistente', async (t) => {
    const plano = planoDe(10);
    let bancada;
    const b = await montarBancada({
        plano,
        responderML: async (item, chamada) => {
            // pede cancelamento depois do terceiro anuncio
            if (chamada === 3) await bancada.repo.pedirCancelamento(bancada.idAtual);
            return { resultado: RESULTADOS.ATUALIZADO, status_http: 200 };
        }
    });
    bancada = b;
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);
    b.idAtual = importacao.id;

    await b.servico.confirmar(importacao.id);
    await Promise.allSettled([...b.servico._emAndamento.values()]);

    const final = await b.servico.obter(importacao.id);

    assert.equal(final.estado, ESTADOS.CANCELADA);
    assert.equal(final.processados, 3, 'os tres ja tocados ficam registrados');
    assert.equal(b.ml.chamadas.length, 3, 'nenhum anuncio depois do pedido pode ser tocado');
    assert.equal(final.soma_bate, true);
    assert.match(final.erro_mensagem, /cancelada pelo operador durante a execucao/);
});

test('cancelar antes de confirmar encerra na hora, sem tocar em nada', async (t) => {
    const b = await montarBancada({ plano: planoDe(5) });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);
    const desfecho = await b.servico.cancelar(importacao.id);

    assert.equal(desfecho.importacao.estado, ESTADOS.CANCELADA);
    assert.equal(b.registro.aplicarEstoque, 0);
    assert.equal(b.ml.chamadas.length, 0);
    // carga util liberada: nao se retoma de cancelada
    const carga = await b.repo.lerCargaUtil(importacao.id);
    assert.deepEqual(carga.plano, []);
});

// -------------------------------------------- processo morto no meio da fila

test('processo morto no meio deixa a importacao interrompida, nunca concluida', async (t) => {
    const b = await montarBancada({ plano: planoDe(10) });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);

    // mata o executor ao chegar no quarto anuncio, pelo mesmo caminho que um
    // SIGKILL produz: o laco abandona sem finalizar e o heartbeat congela
    b.matarExecutorNoEvento(4);

    await b.servico.confirmar(importacao.id);
    await Promise.allSettled([...b.servico._emAndamento.values()]);

    const antes = await b.servico.obter(importacao.id);
    assert.equal(antes.estado, ESTADOS.PROCESSANDO,
        'morta no meio, ela fica em voo, que e a mentira que a reconciliacao conserta');
    assert.equal(antes.processados, 3);

    // o heartbeat envelhece alem da tolerancia
    b.relogio.avancarMs(5 * 60 * 1000);
    const orfas = await b.servico.reconciliar();

    assert.deepEqual(orfas, [importacao.id]);

    const depois = await b.servico.obter(importacao.id);
    assert.equal(depois.estado, ESTADOS.INTERROMPIDA, 'o estado tem de ser honesto');
    assert.equal(depois.retomavel, true);
    assert.equal(depois.processados, 3, 'o que foi feito continua registrado');
    assert.equal(depois.soma_bate, true);
    assert.match(depois.erro_mensagem, /parou de responder/);

    // e a carga util sobreviveu, senao a retomada seria impossivel
    const carga = await b.repo.lerCargaUtil(importacao.id);
    assert.equal(carga.plano.length, 10);
});

test('a reconciliacao nao mexe em quem esta batendo heartbeat', async (t) => {
    const b = await montarBancada({ plano: planoDe(3), toleranciaHeartbeatMs: 120000 });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);
    await b.repo.confirmar(importacao.id, { executor: 'outro' });
    b.relogio.avancarMs(30 * 1000); // menos que a tolerancia

    const orfas = await b.servico.reconciliar();
    assert.deepEqual(orfas, [], 'quem esta vivo nao pode ser marcado como interrompido');

    const atual = await b.repo.buscar(importacao.id);
    assert.equal(atual.estado, ESTADOS.PROCESSANDO);
});

// ----------------------------------------------------------------- retomada

test('a retomada pula o que ja tem evento e completa o restante', async (t) => {
    const b = await montarBancada({ plano: planoDe(10) });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);

    // primeira passada: morre no quarto anuncio
    const reviverExecutor = b.matarExecutorNoEvento(4);
    await b.servico.confirmar(importacao.id);
    await Promise.allSettled([...b.servico._emAndamento.values()]);

    b.relogio.avancarMs(5 * 60 * 1000);
    await b.servico.reconciliar();

    const interrompida = await b.servico.obter(importacao.id);
    assert.equal(interrompida.estado, ESTADOS.INTERROMPIDA);
    assert.equal(interrompida.processados, 3);

    // o executor volta a funcionar e esquecemos as chamadas da primeira passada
    reviverExecutor();
    const chamadasAntes = b.ml.chamadas.length;
    assert.equal(chamadasAntes, 4, 'na primeira passada quatro anuncios foram tocados');
    b.ml.chamadas.length = 0;

    const desfecho = await b.servico.retomar(importacao.id);
    assert.ok(desfecho.importacao, 'uma interrompida deve poder ser retomada');
    await Promise.allSettled([...b.servico._emAndamento.values()]);

    const final = await b.servico.obter(importacao.id);

    assert.equal(final.estado, ESTADOS.CONCLUIDA);
    assert.equal(final.processados, 10, 'o total tem de fechar depois da retomada');
    assert.equal(final.soma_bate, true);
    assert.equal(b.registro.aplicarEstoque, 1, 'o estoque nao deve ser regravado na retomada');

    // o quarto anuncio foi tocado na primeira passada mas NAO gravado, logo
    // precisa ser tocado de novo: sete restantes
    assert.equal(b.ml.chamadas.length, 7, 'so os que faltavam podem ser tocados de novo');

    const eventos = await b.repo.listarEventos({ importacao_id: importacao.id, limite: 500 });
    assert.equal(eventos.length, 10);
    const chaves = eventos.map((e) => chaveDoAnuncio(e));
    assert.equal(new Set(chaves).size, 10, 'nenhum anuncio pode ter dois eventos');
    assert.deepEqual(eventos.map((e) => e.seq), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('retomar o que nao esta interrompido e recusado', async (t) => {
    const b = await montarBancada({ plano: planoDe(2) });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);
    const desfecho = await b.servico.retomar(importacao.id);

    assert.equal(desfecho.erro, 'ESTADO_INVALIDO');
    assert.equal(desfecho.estado, ESTADOS.AGUARDANDO_CONFIRMACAO);
});

// -------------------------------------------------------- dois executores

test('ordinal de evento repetido faz o segundo executor abandonar, sem duplicar chamada', async (t) => {
    const b = await montarBancada({ plano: planoDe(5) });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);
    await b.repo.confirmar(importacao.id, { executor: 'executor-de-teste' });

    // outro executor ja gravou o ordinal 1
    const primeiro = await b.repo.gravarEvento(importacao.id, {
        seq: 1, sku: 'SKU-1', ml_id: 'MLB1000', resultado: RESULTADOS.ATUALIZADO
    });
    assert.equal(primeiro, true);

    const repetido = await b.repo.gravarEvento(importacao.id, {
        seq: 1, sku: 'SKU-OUTRO', ml_id: 'MLB-OUTRO', resultado: RESULTADOS.ATUALIZADO
    });
    assert.equal(repetido, false, 'o ordinal repetido deve ser recusado, nao lancar');

    const atual = await b.repo.buscar(importacao.id);
    assert.equal(atual.processados, 1, 'a tentativa recusada nao pode mexer no contador');
    assert.equal(atual.atualizados, 1);
});

// -------------------------------------------------- progresso e estimativa

test('a estimativa de termino vem da vazao medida, nao de constante', async (t) => {
    const b = await montarBancada({ plano: planoDe(100) });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);
    await b.repo.confirmar(importacao.id, { executor: 'x' });

    // 20 anuncios em 10 segundos: 2 por segundo, faltam 80, logo 40 segundos
    await b.Importacao.update(
        { processados: 20, atualizados: 20 },
        { where: { id: importacao.id } }
    );
    b.relogio.avancarMs(10000);

    const estado = await b.servico.obter(importacao.id);

    assert.equal(estado.percentual, 20);
    assert.equal(estado.vazao_por_segundo, 2);
    assert.equal(estado.segundos_restantes, 40);
});

test('a busca incremental de eventos devolve apenas o que chegou depois', async (t) => {
    const b = await montarBancada({ plano: planoDe(6) });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b);
    await b.servico.confirmar(importacao.id);
    await Promise.allSettled([...b.servico._emAndamento.values()]);

    const primeiros = await b.repo.listarEventos({ importacao_id: importacao.id, desde_seq: 0, limite: 4 });
    assert.deepEqual(primeiros.map((e) => e.seq), [1, 2, 3, 4]);

    const resto = await b.repo.listarEventos({ importacao_id: importacao.id, desde_seq: 4, limite: 100 });
    assert.deepEqual(resto.map((e) => e.seq), [5, 6]);
});

// --------------------------------------------- regressao contra execucao real

test('reproduz a execucao real de 24/04/2026: 980 anuncios, 956 atualizados, 24 rejeitados', async (t) => {
    // Gabarito externo: execucao real gravada pelo proprio sistema em
    // 24/04/2026, reduzida ao resumo e aos pares (sku, ml_id) tocados. O
    // relatorio inteiro vive em server/logs, que o .gitignore exclui; a
    // fixtura e versionada para este teste rodar em qualquer maquina.
    const caminho = path.join(__dirname, 'fixturas', 'execucao-real-2026-04-24.json');
    assert.ok(fs.existsSync(caminho), `fixtura de regressao ausente em ${caminho}`);

    const relatorio = JSON.parse(fs.readFileSync(caminho, 'utf8'));
    const atualizadosReais = relatorio.resultadosML.atualizados;
    const rejeitadosReais = relatorio.resultadosML.jaAtualizados;

    // o plano e exatamente o que a execucao real tocou, na mesma ordem
    const plano = [...atualizadosReais, ...rejeitadosReais]
        .map((p) => ({ sku: p.sku, ml_id: p.ml_id, titulo: null }));

    const chavesRejeitadas = new Set(rejeitadosReais.map((p) => `${p.sku}|${p.ml_id}`));

    const b = await montarBancada({
        plano,
        rodas: Array.from({ length: relatorio.resumo.totalRodasNoPDF }, (_, i) => ({ MODELO: `m${i}` })),
        responderML: (item) => chavesRejeitadas.has(`${item.sku}|${item.ml_id}`)
            ? { resultado: RESULTADOS.JA_ATUALIZADO, status_http: 400, motivo: 'Image validation bypassed.' }
            : { resultado: RESULTADOS.ATUALIZADO, status_http: 200, quantidade_nova: 4 }
    });
    t.after(() => b.fechar());

    const { importacao } = await enviar(b, 'relatorio-real-24-04');
    assert.equal(importacao.total_anuncios, plano.length);

    await b.servico.confirmar(importacao.id);
    await Promise.allSettled([...b.servico._emAndamento.values()]);

    const final = await b.servico.obter(importacao.id);

    // numeros tirados do proprio relatorio, nao escritos a mao
    assert.equal(final.estado, ESTADOS.CONCLUIDA);
    assert.equal(final.processados, plano.length, 'todo anuncio da execucao real tem de ter evento');
    assert.equal(final.atualizados, atualizadosReais.length);
    assert.equal(final.ja_atualizados, rejeitadosReais.length);
    assert.equal(final.erros, 0);
    assert.equal(final.soma_bate, true);
    assert.equal(final.percentual, 100);

    // e os 24 rejeitados sao nomeaveis um a um, que e o ponto da tela:
    // nos quatro relatorios de abril sao sempre os mesmos, e ninguem via
    const rejeitados = await b.repo.listarEventos({
        importacao_id: importacao.id, resultado: RESULTADOS.JA_ATUALIZADO, limite: 500
    });
    assert.equal(rejeitados.length, rejeitadosReais.length);
    assert.deepEqual(
        new Set(rejeitados.map((e) => `${e.sku}|${e.ml_id}`)),
        chavesRejeitadas
    );
    assert.ok(rejeitados.every((e) => e.status_http === 400));

    const quebras = await b.repo.verificarInvariantes({});
    assert.deepEqual(quebras, []);
});
