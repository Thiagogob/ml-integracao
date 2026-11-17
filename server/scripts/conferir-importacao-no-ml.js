#!/usr/bin/env node
//
// Confere uma importacao contra o PROPRIO Mercado Livre.
//
// POR QUE ESTE SCRIPT EXISTE
//
// A suite de testes prova que a maquina de estados e a contabilidade estao
// corretas, mas prova isso contra um dublê. Nenhum teste local pode dizer se a
// quantidade chegou de fato no anuncio: a unica autoridade sobre isso e a API
// do Mercado Livre. Este script e o oraculo independente. Ele nao confia na
// nossa escrituracao: le o anuncio no ML e compara com a tabela de estoque.
//
// SOMENTE LEITURA. Nao envia nada ao Mercado Livre e nao altera nada no banco.
//
// USO
//   node scripts/conferir-importacao-no-ml.js <id-da-importacao> [amostra]
//
//   amostra: quantos anuncios sortear entre os marcados como atualizados.
//            Padrao 25. Use 0 para conferir todos (atencao ao limite de taxa).
//
// SAIDA
//   Uma linha por anuncio divergente e um resumo no fim. Codigo de saida 1 se
//   houver divergencia, 0 se tudo conferir, para poder entrar em verificacao
//   automatica.

require('dotenv').config();

const logger = require('../src/config/logger');
const { sequelize, Importacao, ImportacaoEvento, Anuncio, Estoque } = require('../src/config/database');
const meliService = require('../src/services/meli.service');
const anunciosService = require('../src/services/anuncios.service');

const STORE_ID = parseInt(process.env.STORE_ID, 10) || 1;
// O mesmo respiro que a sincronizacao usa, por cortesia com o limite de taxa
const PAUSA_MS = 350;

const pausar = (ms) => new Promise((r) => setTimeout(r, ms));

const sortear = (lista, quantos) => {
    if (!quantos || quantos >= lista.length) return [...lista];
    const copia = [...lista];
    const escolhidos = [];
    while (escolhidos.length < quantos && copia.length > 0) {
        escolhidos.push(copia.splice(Math.floor(Math.random() * copia.length), 1)[0]);
    }
    return escolhidos;
};

/**
 * Le o anuncio no Mercado Livre e devolve a quantidade disponivel por variacao,
 * mais a do item simples quando nao houver variacao.
 */
const lerAnuncioNoML = async (ml_id, access_token) => {
    const resposta = await fetch(`https://api.mercadolibre.com/items/${ml_id}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${access_token}` }
    });

    if (resposta.status !== 200) {
        const corpo = await resposta.text();
        return { erro: `HTTP ${resposta.status}`, corpo: corpo.slice(0, 300) };
    }

    const item = await resposta.json();

    if (Array.isArray(item.variations) && item.variations.length > 0) {
        return {
            tipo: 'variacoes',
            porVariacao: item.variations.map((v) => ({
                variation_id: String(v.id),
                available_quantity: v.available_quantity
            })),
            total: item.variations.reduce((s, v) => s + (v.available_quantity || 0), 0)
        };
    }

    return {
        tipo: 'simples',
        total: item.available_quantity,
        status: item.status
    };
};

/**
 * A quantidade que ESPERAMOS no anuncio, recalculada do estoque pelo mesmo
 * caminho da sincronizacao. Nao e lida de nenhum cache nosso: e recomputada,
 * para que uma gravacao errada no caminho nao passe em branco.
 */
const quantidadeEsperada = async (ml_id) => {
    const detalhes = await anunciosService.getAnuncio(ml_id);
    if (detalhes.length === 0) return { erro: 'anuncio ausente da tabela anuncios' };

    const stockService = require('../src/services/stock.service');
    const estoque = await stockService.getRoda(detalhes);
    if (estoque.length === 0) return { erro: 'nenhum SKU de roda no estoque para este anuncio' };

    const payload = anunciosService.generateUpdatePayload(detalhes, estoque);
    return { total: meliService.quantidadeDoPayload(payload), payload };
};

const principal = async () => {
    const [idTexto, amostraTexto] = process.argv.slice(2);
    const importacaoId = parseInt(idTexto, 10);
    const amostra = amostraTexto === undefined ? 25 : parseInt(amostraTexto, 10);

    if (!Number.isInteger(importacaoId)) {
        console.error('uso: node scripts/conferir-importacao-no-ml.js <id-da-importacao> [amostra]');
        process.exit(2);
    }

    await sequelize.authenticate();

    const importacao = await Importacao.findByPk(importacaoId, { raw: true });
    if (!importacao) {
        console.error(`importacao ${importacaoId} nao encontrada`);
        process.exit(2);
    }

    console.log(`\nImportacao #${importacao.id}  ${importacao.arquivo_nome}`);
    console.log(`estado: ${importacao.estado}   processados: ${importacao.processados}`);
    console.log(`atualizados ${importacao.atualizados} | recusados pelo ML ${importacao.ja_atualizados}`
        + ` | erros ${importacao.erros} | ignorados ${importacao.ignorados}`);

    // Invariante de contabilidade, antes de falar com o ML
    const soma = importacao.atualizados + importacao.ja_atualizados
        + importacao.erros + importacao.ignorados;
    if (soma !== importacao.processados) {
        console.log(`\n  INVARIANTE VIOLADO: a soma das classificacoes (${soma})`
            + ` nao bate com processados (${importacao.processados})`);
    } else {
        console.log('  invariante de contadores: ok');
    }

    const atualizados = await ImportacaoEvento.findAll({
        where: { importacao_id: importacaoId, resultado: 'atualizado' },
        attributes: ['seq', 'sku', 'ml_id', 'quantidade_nova'],
        raw: true
    });

    if (atualizados.length === 0) {
        console.log('\nnenhum evento com resultado atualizado: nada a conferir no ML');
        await sequelize.close();
        process.exit(0);
    }

    const access_token = await meliService.authTest();
    if (!access_token) {
        console.error('\nnao foi possivel obter token valido do Mercado Livre');
        await sequelize.close();
        process.exit(2);
    }

    const escolhidos = sortear(atualizados, amostra);
    console.log(`\nconferindo ${escolhidos.length} de ${atualizados.length} anuncios atualizados`
        + ` diretamente na API do Mercado Livre\n`);

    let conferem = 0;
    const divergentes = [];
    const inconclusivos = [];

    for (const evento of escolhidos) {
        const noML = await lerAnuncioNoML(evento.ml_id, access_token);
        const esperado = await quantidadeEsperada(evento.ml_id);

        if (noML.erro) {
            inconclusivos.push({ ...evento, motivo: `leitura no ML: ${noML.erro}` });
        } else if (esperado.erro) {
            inconclusivos.push({ ...evento, motivo: `recalculo local: ${esperado.erro}` });
        } else if (noML.total === esperado.total) {
            conferem += 1;
        } else {
            divergentes.push({
                sku: evento.sku,
                ml_id: evento.ml_id,
                registrado_na_importacao: evento.quantidade_nova,
                esperado_agora: esperado.total,
                no_mercado_livre: noML.total,
                tipo: noML.tipo
            });
        }

        await pausar(PAUSA_MS);
    }

    console.log(`conferem:      ${conferem}`);
    console.log(`divergentes:   ${divergentes.length}`);
    console.log(`inconclusivos: ${inconclusivos.length}`);

    if (divergentes.length > 0) {
        console.log('\nDIVERGENCIAS');
        for (const d of divergentes) {
            console.log(`  ${d.sku}  ${d.ml_id}  esperado ${d.esperado_agora}`
                + `  no ML ${d.no_mercado_livre}  (registrado na importacao: ${d.registrado_na_importacao})`);
        }
        console.log('\nAtencao: divergencia pode ser legitima se houve venda entre a importacao'
            + ' e esta conferencia, porque a baixa por venda altera a quantidade depois.');
    }

    if (inconclusivos.length > 0) {
        console.log('\nINCONCLUSIVOS');
        for (const i of inconclusivos) {
            console.log(`  ${i.sku}  ${i.ml_id}  ${i.motivo}`);
        }
    }

    await sequelize.close();
    process.exit(divergentes.length > 0 ? 1 : 0);
};

principal().catch(async (erro) => {
    logger.error({ err: erro }, 'falha na conferencia da importacao no ML');
    console.error(erro);
    try { await sequelize.close(); } catch { /* nada */ }
    process.exit(2);
});
