// /server/src/services/stock.service.js
const { Estoque, EstoqueTemporario, sequelize } = require('../config/database');
const { Op } = require('sequelize');
const logger = require('../config/logger');

// Change this SKU to trace any model through the full update flow
const DEBUG_SKU = 'M17ARO174-1004-108HD';

// Maps each virtual combo SKU to the two physical component SKUs it bundles.
// Each sale of a combo removes quantidadeVendida/2 from each component.
const COMBO_SKU_MAP = {
    'M08ARO14675-114BD':  ['M08ARO1465-114BD',  'M08ARO1475-114BD'],
    'M08ARO14675-114FBD': ['M08ARO1465-114FBD', 'M08ARO1475-114FBD'],
};
let _debugTrace = [];
const dbg = (msg) => { _debugTrace.push(msg); logger.debug({ sku: DEBUG_SKU }, msg); };
const getDebugTrace = () => _debugTrace;
const clearDebugTrace = () => { _debugTrace = []; };






// Lógica para transformar o texto do PDF em dados estruturados
function parseTxtToWheels(text) {
    const lines = text.trim().split('\n');
    const results = [];

    // Suporta modelos de uma ou duas palavras (ex: ALFA ROMEO, FUCHS 911, POLO GTI)
    // e modelos com ponto (M50.). O lookahead (?![0-9]+[xX]) impede que o ARO (17X7)
    // seja capturado como segunda palavra do modelo.
    const pattern = /([A-Z][A-Z0-9\.\-]*(?:\s(?![0-9]+[xX])[A-Z0-9]+)?)\s+([\dXx,\.]+)\s+([\dXx\/-]+)\s+(-?\d{1,3})\s+(.*?)\s+(\d+)\s+(\d+)$/;

    // Caso específico MTB L200: a linha desse modelo vem SEM a coluna OFFSET no PDF
    // do fornecedor (em todos os formatos). Parseia sem offset e grava offset vazio.
    const patternMtbSemOffset = /^(MTB(?:\s(?![0-9]+[xX])[A-Z0-9]+)?)\s+([\dXx,\.]+)\s+([\dXx\/-]+)\s+(.*?)\s+(\d+)\s+(\d+)$/;

    for (const line of lines) {
        if (!line.trim()) continue;

        const match = line.match(pattern);

        if (match) {
            const [
                _,
                modelo,
                aro,
                pcd,
                offset,
                acabamento,
                qtde_sp,
                qtde_sc
            ] = match;

            results.push({
                MODELO: modelo.trim(),
                ARO: aro.trim(),
                PCD: pcd.trim(),
                OFFSET: offset.trim(),
                ACABAMENTO: acabamento.trim(),
                QTDE_SP: parseInt(qtde_sp),
                QTDE_SC: parseInt(qtde_sc)
            });
            continue;
        }

        const matchMtb = line.trim().match(patternMtbSemOffset);
        if (matchMtb) {
            const [_, modelo, aro, pcd, acabamento, qtde_sp, qtde_sc] = matchMtb;
            results.push({
                MODELO: modelo.trim(),
                ARO: aro.trim(),
                PCD: pcd.trim(),
                OFFSET: '',
                ACABAMENTO: acabamento.trim(),
                QTDE_SP: parseInt(qtde_sp),
                QTDE_SC: parseInt(qtde_sc)
            });
            logger.info({ line }, 'linha MTB parseada sem coluna offset');
            continue;
        }

        logger.warn({ line }, 'linha ignorada: nao corresponde ao padrao');
    }

    return results;
}



function parseTxtToWheelsSul(text) {
    const lines = text.trim().split('\n');
    const results = [];

    const pattern = /(\S+)\s+([\dXx,\.]+)\s+([\dXx\/-]+)\s+(-?\d{1,3})\s+(.*?)\s+(\d+)\s+(\d+)$/;

    for (const line of lines) {
        if (!line.trim()) continue;

        const match = line.match(pattern);
        
        if (match) {
            const [
                _, 
                modelo, 
                aro, 
                pcd, 
                offset, 
                acabamento, 
                qtde_pr_str, 
                qtde_sc_str  
            ] = match;

            results.push({
                modelo: modelo.trim(),
                aro: aro.trim(),
                pcd: pcd.trim(),
                offset: offset.trim(),
                acabamento: acabamento.trim(),
                qtde_pr: parseInt(qtde_pr_str, 10),
                qtde_sc: parseInt(qtde_sc_str, 10), 
                sku: null 
            });
        } else {
            logger.warn({ line }, 'linha ignorada: nao corresponde ao padrao');
        }
    }

    return results;
};


//============================== SALVAR ESTOQUE TEMPORÁRIO ATUALIZANDO AS QUANTIDADES E IGNORANDO SKU=========================================



const saveStockSul = async (estoque) => {

    // Lista das colunas que identificam a roda (chave composta)
    const uniqueFields = ['modelo', 'aro', 'pcd', 'offset', 'acabamento'];
    
    // O EstoqueTemporario tem qtde_pr e qtde_sc
    const qtdeFields = ['qtde_pr', 'qtde_sc'];

    const transaction = await sequelize.transaction();
    
    try {
        logger.info('iniciando sincronizacao de estoque temporario do Sul');

        // 1. LIMPEZA DA TABELA TEMPORÁRIA

        logger.info('limpando estoque temporario antes da nova insercao');
        await EstoqueTemporario.destroy({ where: {}, transaction: transaction });
        logger.info('estoque temporario limpo com sucesso');

        // 2. PREPARAÇÃO DOS DADOS: Cria a lista de objetos para o Upsert
        const registrosParaUpsert = estoque.map((roda, index) => {

            // --- LÓGICA DE NORMALIZAÇÃO ---
            const nomeModeloCorrigido = fixModelName(roda.modelo); 
            const acabamentoCorrigido = fixAcabamento(roda.acabamento);
            let aroCorrigido = String(roda.aro || '');
            
            if (aroCorrigido.endsWith(',')) {
                 aroCorrigido = `${aroCorrigido}5`;
            }
            
            // Normaliza cada campo da chave composta
            const modelo = normalizeString(nomeModeloCorrigido);
            const aro = normalizeString(aroCorrigido); 
            const pcd = normalizeString(roda.pcd); 
            const offset = normalizeString(roda.offset);
            const acabamento = normalizeString(acabamentoCorrigido);

            const unique_key = `${modelo}|${aro}|${pcd}|${offset}|${acabamento}`;

            // --- FIM DA LÓGICA DE NORMALIZAÇÃO ---


            return {
                modelo: modelo,
                aro: aro,
                pcd: pcd,
                offset: offset,
                acabamento: acabamento,
                
                sku: null, 
                
                
                qtde_pr: roda.qtde_pr, 
                qtde_sc: roda.qtde_sc, 
                
                unique_key: unique_key
            };
        });
        
        // 3. UPSERT EM LOTE 

        await EstoqueTemporario.bulkCreate(registrosParaUpsert, {
            updateOnDuplicate: [
                ...uniqueFields,
                ...qtdeFields
            ],
            transaction: transaction,
            // Não precisamos de 'returning: true' se for apenas para análise
        });
        
        await transaction.commit();
        
        logger.info({ total: registrosParaUpsert.length }, 'sincronizacao temporaria Sul concluida, pronto para matching de SKU');

    } catch (error) {
        await transaction.rollback(); 
        logger.error({ err: error }, 'erro fatal ao sincronizar estoque temporario Sul');
        throw error;
    }
};







//============================== SALVAR ESTOQUE ATUALIZANDO AS QUANTIDADES MAS MANTENDO MODELOS E SKUs =====================================


//FUNÇÃO PARA LIDAR COM NOMES INCOMPLETOS (ISSO ACONTECE QUANDO O ESTOQUE ZERA)
const fixModelName = (modelName) => {
    // Garante que o nome seja uma string para o switch/case funcionar
    const name = String(modelName).trim().toLowerCase(); 

    switch (name) {
        case 'morga':
        case 'morg':
            return 'morgan';

        case 'orbita':
            return 'orbital';

        case 'newsu':
        case 'newsunline':
            return 'newsun';

        case 'porsc':
        case 'porsche 914':
            return 'porsch';

        case 'samps':
        case 'sampson':
            return 'sampso';

        case 'stroll':
        case 'stroller':
            return 'strolle';

        case 'discov':
        case 'discovery':
            return 'discove';

        case 'ballin':
            return 'ballina';

        case 'silver':
        case 'silverad':
        case 'silverado':
            return 'silvera';

        case 'summe':
            return 'summer';

        case 'brw15':
        case 'brw1570':
            return 'brw157';

        case 'brw1810':
            return 'brw18';

        case 'brw1860':
            return 'brw186';

        case 'brw2220':
            return 'brw222';

        case 'alfa romeo':
            return 'alfa';

        case 'centaur':
        case 'centauro':
            return 'centau';

        case 'fuchs 911':
            return 'fuchs';

        case 'mercedes rs03':
            return 'merced';

        case 'mtb l200':
            return 'mtb';

        case 'polo gti':
            return 'polo';

        case 'tarantula':
            return 'tarant';

        default:
            return name;
    }
};


//FUNÇÃO PARA LIDAR COM ACABAMENTOS INCOMPLETOS (ISSO ACONTECE QUANDO O ESTOQUE ZERA)
const fixAcabamento = (acabamento) => {
    // Garante que o nome seja uma string para o switch/case funcionar
    const name = String(acabamento).trim().toLowerCase(); 

    switch (name) {
        
        case 'gbbd (grafite brilho':
            return 'gbbd (grafite brilho borda'; 

        default:
            return name; 
    }
};



//NORMALIZANDO STRING NO BANCO DE DADOS
const normalizeString = (str) => {
    if (str === null || str === undefined) return '';
    return String(str).trim().toLowerCase();
};

// Código da cor: trecho antes do '(' sem espaços (ex: 'bd (preto diamantado)' -> 'bd',
// 'gd(grafite d.)fl*' -> 'gd'). Usado para impedir que uma roda herde SKU de outra cor.
const colorCode = (acabamento) => {
    const a = normalizeString(acabamento);
    const idx = a.indexOf('(');
    return (idx === -1 ? a : a.slice(0, idx)).replace(/\s+/g, '');
};



//const saveStock = async (estoque) => {
//
//    // Lista das colunas que identificam a roda (chave composta)
//    const uniqueFields = ['modelo', 'aro', 'pcd', 'offset', 'acabamento'];
//    
//    // Inicia uma transação para garantir que a operação seja atômica
//    const transaction = await sequelize.transaction();
//    
//    try {
//        console.log("Iniciando a sincronização inteligente de estoque...");
//
//        // 1. PREPARAÇÃO DOS DADOS: Cria a lista de objetos para o Upsert
//        const registrosParaUpsert = estoque.map((roda, index) => {
//
//            // --- CORREÇÃO DE MODELOS INCOMPLETOS --
//
//            const nomeModeloCorrigido = fixModelName(roda.MODELO);
//
//            // --- FIM DA CORREÇÃO DE MODELOS INCOMPLETOS --
//
//
//
//            // -- CORREÇÃO ACABAMENTO INCOMPLETO --
//
//                const acabamentoCorrigido = fixAcabamento(roda.ACABAMENTO);
//
//            // -- FIM DA CORREÇÃO ACABAMENTO INCOMPLETO --
//            
//
//
//
//            let aroCorrigido = String(roda.ARO || '');
//            
//
//
//            // --- CORREÇÃO DO CAMPO ARO (Padronização) ---
//
//            // 1. Regra de Negócio: Se o aro termina em vírgula (ex: '20x7,'), assume-se que é ',5' e corrige.
//            if (aroCorrigido.endsWith(',')) {
//                
//                 aroCorrigido = `${aroCorrigido}5`; // '20x7,' vira '20x7,5'
//
//            }
//            // --- FIM DA CORREÇÃO DO CAMPO ARO ---
//            
//
//
//            // Normaliza cada campo da chave composta
//            const modelo = normalizeString(nomeModeloCorrigido);
//
//            // CORREÇÃO ESSENCIAL: Usa o aroCorrigido e normaliza para a chave
//            const aro = normalizeString(aroCorrigido); 
//
//            const pcd = normalizeString(roda.PCD);
//
//            const offset = normalizeString(roda.OFFSET);
//
//            const acabamento = normalizeString(acabamentoCorrigido);
//
//            const unique_key = `${modelo}|${aro}|${pcd}|${offset}|${acabamento}`;
//
//            //if (index < 5) {
//            //    console.log(`[DEBUG ENTRADA ${index}] Key Aro (Corrigido): ${aro} | Key Completa: ${unique_key}`);
//            //}
//
//            return {
//                modelo: modelo,
//
//                aro: aro,
//
//                pcd: pcd,
//
//                offset: offset,
//
//                acabamento: acabamento,
//
//                sku: normalizeString(roda.SKU),
//
//                qtde_sp: roda.QTDE_SP,
//
//                qtde_sc: roda.QTDE_SC,
//
//                // Chave única normalizada para ser usada na comparação
//                unique_key: unique_key
//            };
//        });
//        
//        // 2. PRÉ-VERIFICAÇÃO: Identifica quais rodas já existem no DB.
//        const chavesParaVerificar = registrosParaUpsert.map(r => r.unique_key);
//        
//        // Monta a condição OR para buscar todas as chaves de entrada no DB
//        const orConditions = chavesParaVerificar.map(key => {
//
//            const [modelo, aro, pcd, offset, acabamento] = key.split('|');
//
//            return {
//                [Op.and]: { 
//                    // Normaliza os dados do DB (TRIM e LOWER) para comparação
//                    modelo: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('modelo'))), modelo),
//
//                    aro: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('aro'))), aro),
//
//                    pcd: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('pcd'))), pcd),
//
//                    offset: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('offset'))), offset),
//
//                    acabamento: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('acabamento'))), acabamento),
//
//                }
//            };
//        });
//
//        // Consulta o DB para encontrar todas as rodas existentes
//        const rodasExistentes = await Estoque.findAll({
//
//            attributes: uniqueFields,
//
//            where: {
//                [Op.or]: orConditions 
//            },
//
//            transaction: transaction,
//
//            raw: true
//
//        });
//
//
//        
//        // Converte as rodas existentes em um Set de chaves únicas normalizadas
//        const chavesExistentesSet = new Set(
//
//            rodasExistentes.map((r, index) => {
//
//                const dbKey = `${normalizeString(r.modelo)}|${normalizeString(r.aro)}|${normalizeString(r.pcd)}|${normalizeString(r.offset)}|${normalizeString(r.acabamento)}`;
//                
//                // DEBUG 3: Loga as primeiras chaves do DB para comparação
//                //if (index < 5) {
//                //    console.log(`[DEBUG SAÍDA ${index}] Key DB: ${dbKey}`);
//                //}
//
//                return dbKey;
//            })
//        );
//        
//        // 3. IDENTIFICAÇÃO DOS NOVOS MODELOS
//        let novosModelos = 0;
//        
//        registrosParaUpsert.filter(registro => {
//
//            const key = registro.unique_key;
//
//            if (!chavesExistentesSet.has(key)) {
//
//                // Mantém o formato de log solicitado
//                console.log(`\n[MODELO NOVO DETECTADO] Inserindo: ${registro.modelo} ${registro.aro} ${registro.pcd} ${registro.offset} ${registro.acabamento}`);
//                novosModelos++;
//                return true;
//
//            }
//
//            return false;
//        });
//        
//        // 4. ZERAR O ESTOQUE ANTIGO
//        console.log('Zerando o estoque antes da atualização...');
//
//        await Estoque.update(
//
//            { qtde_sp: 0, qtde_sc: 0 },
//
//            { where: {}, transaction: transaction }
//
//        );
//
//        console.log('Estoque zerado com sucesso.');
//
//        // 5. UPSERT EM LOTE
//        await Estoque.bulkCreate(registrosParaUpsert, {
//
//            updateOnDuplicate: [
//                ...uniqueFields,
//
//                'qtde_sp',
//
//                'qtde_sc'
//            ],
//            transaction: transaction,
//            //order: [['modelo', 'ASC']],
//            returning: true 
//        });
//        
//        await transaction.commit();
//        
//        rodasProcessadas = registrosParaUpsert.length;
//
//        const modelosAtualizados = rodasProcessadas - novosModelos;
//
//        console.log(`\n--- SINCRONIZAÇÃO CONCLUÍDA ---`);
//        console.log(`Modelos no arquivo: ${rodasProcessadas}`);
//        console.log(`Novos modelos adicionados: ${novosModelos}`);
//        console.log(`Modelos atualizados: ${modelosAtualizados}`); 
//        console.log(`Estoque sincronizado por chave composta!`);
//
//    } catch (error) {
//        await transaction.rollback(); 
//        console.error('Erro fatal ao sincronizar o estoque:', error);
//        throw error;
//    }
//};


// =====================================================================


//const saveStock = async (estoque, access_token, processCriticalUpdates) => {
//    const uniqueFields = ['modelo', 'aro', 'pcd', 'offset', 'acabamento'];
//    const transaction = await sequelize.transaction();
//    
//    try {
//        console.log("Iniciando a sincronização inteligente de estoque...");
//
//        // 1. PREPARAÇÃO DOS DADOS
//        const registrosParaUpsert = estoque.map((roda) => {
//            const nomeModeloCorrigido = fixModelName(roda.MODELO);
//            const acabamentoCorrigido = fixAcabamento(roda.ACABAMENTO);
//            let aroCorrigido = String(roda.ARO || '');
//
//            if (aroCorrigido.endsWith(',')) {
//                 aroCorrigido = `${aroCorrigido}5`;
//            }
//            
//            // GARANTIA NUMÉRICA: Se não for número, vira 0
//            const qtde_sp = Number(roda.QTDE_SP) || 0;
//            const qtde_sc = Number(roda.QTDE_SC) || 0;
//            const qtde_pr = Number(roda.QTDE_PR) || 0;
//
//            const modelo = normalizeString(nomeModeloCorrigido);
//            const aro = normalizeString(aroCorrigido); 
//            const pcd = normalizeString(roda.PCD);
//            const offset = normalizeString(roda.OFFSET);
//            const acabamento = normalizeString(acabamentoCorrigido);
//            const unique_key = `${modelo}|${aro}|${pcd}|${offset}|${acabamento}`;
//
//            return {
//                modelo,
//                aro,
//                pcd,
//                offset,
//                acabamento,
//                sku: normalizeString(roda.SKU),
//                qtde_sp,
//                qtde_sc,
//                qtde_pr,
//                unique_key
//            };
//        });
//
//        // --- DEDUPLICAÇÃO COM TRATAMENTO DE NaN ---
//        const mapaDeduplicado = new Map();
//        
//        registrosParaUpsert.forEach(registro => {
//            if (mapaDeduplicado.has(registro.unique_key)) {
//                const existente = mapaDeduplicado.get(registro.unique_key);
//                // Soma garantindo que valores nulos/NaN não quebrem o cálculo
//                existente.qtde_sp = (existente.qtde_sp || 0) + (registro.qtde_sp || 0);
//                existente.qtde_sc = (existente.qtde_sc || 0) + (registro.qtde_sc || 0);
//                existente.qtde_pr = (existente.qtde_pr || 0) + (registro.qtde_pr || 0);
//            } else {
//                mapaDeduplicado.set(registro.unique_key, { ...registro });
//            }
//        });
//        
//        const registrosLimpos = Array.from(mapaDeduplicado.values());
//
//        // 2. PRÉ-VERIFICAÇÃO
//        // IMPORTANTE: Use os registrosLimpos aqui para não enviar chaves duplicadas na query
//        const chavesParaVerificar = registrosLimpos.map(r => r.unique_key);
//        
//        const orConditions = chavesParaVerificar.map(key => {
//            const [modelo, aro, pcd, offset, acabamento] = key.split('|');
//            return {
//                [Op.and]: { 
//                    modelo: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('modelo'))), modelo),
//                    aro: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('aro'))), aro),
//                    pcd: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('pcd'))), pcd),
//                    offset: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('offset'))), offset),
//                    acabamento: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('acabamento'))), acabamento),
//                }
//            };
//        });
//
//        const rodasExistentes = await Estoque.findAll({
//            attributes: [...uniqueFields, 'qtde_sp', 'qtde_sc', 'qtde_pr', 'sku'],
//            where: { [Op.or]: orConditions },
//            transaction: transaction,
//            raw: true
//        });
//
//        const estoqueAntigoMap = new Map();
//        rodasExistentes.forEach(r => {
//            const dbKey = `${normalizeString(r.modelo)}|${normalizeString(r.aro)}|${normalizeString(r.pcd)}|${normalizeString(r.offset)}|${normalizeString(r.acabamento)}`;
//            // Garante que o que vem do banco também seja tratado como número
//            estoqueAntigoMap.set(dbKey, { 
//                qtde_sp: Number(r.qtde_sp) || 0, 
//                qtde_sc: Number(r.qtde_sc) || 0, 
//                qtde_pr: Number(r.qtde_pr) || 0, 
//                sku: r.sku 
//            });
//        });
//
//        const mudancasCriticas = [];
//        let novosModelos = 0;
//        
//        registrosLimpos.forEach(registro => {
//            const key = registro.unique_key;
//            const estoqueAntigo = estoqueAntigoMap.get(key);
//
//            if (!estoqueAntigo) {
//                novosModelos++;
//                mudancasCriticas.push({ 
//                    sku: registro.sku, 
//                    qtde_antiga: 0, 
//                    qtde_nova: registro.qtde_sp + registro.qtde_sc + registro.qtde_pr,
//                    tipo: 'REPOSIÇÃO'
//                });
//            } else {
//                const qtdeAntiga = estoqueAntigo.qtde_sp + estoqueAntigo.qtde_sc + estoqueAntigo.qtde_pr;
//                const qtdeNova = registro.qtde_sp + registro.qtde_sc + registro.qtde_pr;
//
//                if (qtdeAntiga !== qtdeNova) {
//                    mudancasCriticas.push({
//                        sku: estoqueAntigo.sku,
//                        qtde_antiga: qtdeAntiga,
//                        qtde_nova: qtdeNova,
//                        tipo: qtdeNova > qtdeAntiga ? 'REPOSIÇÃO' : 'BAIXA'
//                    });
//                }
//            }
//        });
//
//        // 5. UPSERT EM LOTE
//        await Estoque.bulkCreate(registrosLimpos, {
//            updateOnDuplicate: ['qtde_sp', 'qtde_sc', 'qtde_pr'],
//            transaction: transaction,
//            returning: true 
//        });
//
//        await transaction.commit();
//
//        try {
//            await processCriticalUpdates(mudancasCriticas, access_token);
//        } catch (apiError) {
//            console.error('[ERRO DE API] Falha ao processar atualizações críticas no ML:', apiError.message);
//        }
//
//        console.log(`\n--- SINCRONIZAÇÃO CONCLUÍDA ---`);
//        console.log(`Modelos únicos: ${registrosLimpos.length}`);
//
//    } catch (error) {
//        if (transaction) await transaction.rollback(); 
//        console.error('Erro fatal ao sincronizar o estoque:', error);
//        throw error;
//    }
//};
//
//






// // =====================================================================


const saveStock = async (estoque, access_token, processCriticalUpdates) => {
    const uniqueFields = ['modelo', 'aro', 'pcd', 'offset', 'acabamento'];
    const transaction = await sequelize.transaction();
    
    try {
        clearDebugTrace();
        logger.info('iniciando sincronizacao inteligente de estoque (PDF SP)');

        // 1. PREPARAÇÃO E NORMALIZAÇÃO DOS DADOS
        const registrosParaUpsert = estoque.map((roda) => {
            const nomeModeloCorrigido = fixModelName(roda.MODELO);
            const acabamentoCorrigido = fixAcabamento(roda.ACABAMENTO);
            let aroCorrigido = String(roda.ARO || '');

            if (aroCorrigido.endsWith(',')) {
                 aroCorrigido = `${aroCorrigido}5`;
            }
            
            const qtde_sp = Number(roda.QTDE_SP) || 0;
            const qtde_sc = Number(roda.QTDE_SC) || 0;
            const qtde_pr = Number(roda.QTDE_PR) || 0;

            const modelo = normalizeString(nomeModeloCorrigido);
            const aro = normalizeString(aroCorrigido); 
            const pcd = normalizeString(roda.PCD);
            const offset = normalizeString(roda.OFFSET);
            const acabamento = normalizeString(acabamentoCorrigido);
            const unique_key = `${modelo}|${aro}|${pcd}|${offset}|${acabamento}`;

            return {
                modelo, aro, pcd, offset, acabamento,
                sku: "", // O PDF não contém SKU, deixamos vazio para não sobrescrever o SKU do banco
                qtde_sp, qtde_sc, qtde_pr,
                unique_key
            };
        });

        // 2. DEDUPLICAÇÃO DE REGISTROS
        const mapaDeduplicado = new Map();
        registrosParaUpsert.forEach(registro => {
            if (mapaDeduplicado.has(registro.unique_key)) {
                const existente = mapaDeduplicado.get(registro.unique_key);
                existente.qtde_sp += registro.qtde_sp;
                existente.qtde_sc += registro.qtde_sc;
                existente.qtde_pr += registro.qtde_pr;
            } else {
                mapaDeduplicado.set(registro.unique_key, { ...registro });
            }
        });
        
        const registrosLimpos = Array.from(mapaDeduplicado.values());

        // DEBUG: trace target model through PDF parsing
        const debugNoPDF = registrosLimpos.filter(r => r.unique_key.startsWith('m17|17x7|4x100'));
        if (debugNoPDF.length > 0) {
            debugNoPDF.forEach(r => dbg(`[1-PDF] key="${r.unique_key}" qtde_sp=${r.qtde_sp} qtde_sc=${r.qtde_sc} qtde_pr=${r.qtde_pr}`));
        } else {
            dbg('[1-PDF] modelo NÃO encontrado no PDF após parsing e deduplicação');
        }

        // 2B. CORREÇÃO DE ACABAMENTOS TRUNCADOS
        // O novo PDF tem colunas mais estreitas: "BD (PRETO DIAMANTADO)" vira "BD (PRETO".
        // Para cada registro com parêntese aberto mas não fechado, busca o valor real no banco
        // usando LIKE constrangido por (modelo, aro, pcd, offset), que é sempre unívoco.
        const truncados = registrosLimpos.filter(r => r.acabamento.includes('(') && !r.acabamento.includes(')'));

        // DETECÇÃO DE FORMATO DO PDF: no formato antigo (colunas largas) só uma pequena
        // fração dos acabamentos chega truncada (~2-3%); no formato novo (colunas estreitas,
        // usado entre abr-jun/2026) mais da metade chega truncada. Se o fornecedor voltar ao
        // formato novo, este aviso aparece — a correção abaixo continua funcionando nos dois
        // formatos, mas o relatório da sincronização merece revisão manual.
        const formatoNovoDetectado = registrosLimpos.length > 0 && (truncados.length / registrosLimpos.length) > 0.2;
        if (formatoNovoDetectado) {
            logger.warn({ truncados: truncados.length, total: registrosLimpos.length }, 'ATENCAO: PDF parece estar no formato NOVO (colunas estreitas) - revisar relatorio da sincronizacao');
        }

        for (const registro of truncados) {
            const exato = await Estoque.findOne({
                attributes: ['acabamento', 'sku'],
                where: {
                    modelo: registro.modelo,
                    aro: registro.aro,
                    pcd: registro.pcd,
                    offset: registro.offset,
                    acabamento: registro.acabamento
                },
                transaction,
                raw: true
            });

            // Só pula o LIKE se o match exato tiver SKU definido — significa que
            // alguém digitou o SKU nessa linha truncada intencionalmente e ela deve ser usada.
            // Se o match exato não tem SKU (linha truncada de upload ruim), tentamos o LIKE
            // para encontrar a linha completa que pode ter o SKU correto.
            const exatoTemSku = exato && exato.sku && exato.sku !== '';
            if (!exatoTemSku) {
                // Tenta o prefixo original primeiro (ex: 'lbf(lip black' → 'lbf(lip black%').
                // Se não encontrar, tenta com espaço antes de '(' (ex: 'bd(preto' → 'bd (preto%'),
                // cobrindo casos onde o DB armazena com espaço mas o PDF omitiu.
                const prefixOriginal = registro.acabamento;
                const prefixComEspaco = registro.acabamento.replace(/(\S)\(/, '$1 (');
                const prefixes = prefixOriginal === prefixComEspaco
                    ? [prefixOriginal]
                    : [prefixOriginal, prefixComEspaco];

                let porPrefixo = null;
                for (const prefix of prefixes) {
                    porPrefixo = await Estoque.findOne({
                        attributes: ['acabamento'],
                        where: {
                            modelo: registro.modelo,
                            aro: registro.aro,
                            pcd: registro.pcd,
                            offset: registro.offset,
                            acabamento: { [Op.like]: `${prefix}%` }
                        },
                        order: [[sequelize.literal('LENGTH(acabamento)'), 'DESC']],
                        transaction,
                        raw: true
                    });
                    if (porPrefixo) break;
                }

                if (porPrefixo) {
                    const acabamentoCompleto = normalizeString(porPrefixo.acabamento);
                    registro.acabamento = acabamentoCompleto;
                    registro.unique_key = `${registro.modelo}|${registro.aro}|${registro.pcd}|${registro.offset}|${acabamentoCompleto}`;
                }
            }
        }

        // Re-deduplica caso correções tenham gerado chaves coincidentes
        if (truncados.length > 0) {
            const mapaFinal = new Map();
            registrosLimpos.forEach(r => {
                if (mapaFinal.has(r.unique_key)) {
                    const ex = mapaFinal.get(r.unique_key);
                    ex.qtde_sp += r.qtde_sp;
                    ex.qtde_sc += r.qtde_sc;
                    ex.qtde_pr += r.qtde_pr;
                } else {
                    mapaFinal.set(r.unique_key, { ...r });
                }
            });
            registrosLimpos.length = 0;
            mapaFinal.forEach(r => registrosLimpos.push(r));
        }

        // 3. BUSCA DE SKUs EXISTENTES NO BANCO
        const chavesParaVerificar = registrosLimpos.map(r => r.unique_key);
        const orConditions = chavesParaVerificar.map(key => {
            const [modelo, aro, pcd, offset, acabamento] = key.split('|');
            return {
                [Op.and]: { 
                    modelo: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('modelo'))), modelo),
                    aro: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('aro'))), aro),
                    pcd: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('pcd'))), pcd),
                    offset: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('offset'))), offset),
                    acabamento: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('acabamento'))), acabamento),
                }
            };
        });

        const rodasNoBanco = await Estoque.findAll({
            attributes: ['modelo', 'aro', 'pcd', 'offset', 'acabamento', 'sku'],
            where: { [Op.or]: orConditions },
            transaction: transaction,
            raw: true
        });

        const estoqueDbMap = new Map();
        rodasNoBanco.forEach(r => {
            const dbKey = `${normalizeString(r.modelo)}|${normalizeString(r.aro)}|${normalizeString(r.pcd)}|${normalizeString(r.offset)}|${normalizeString(r.acabamento)}`;
            estoqueDbMap.set(dbKey, r.sku);
        });

        // 3B. DIAGNÓSTICO DE SKUs
        const comSku = [];
        const semSkuVazio = [];  // chave existe no banco mas sku='' → esperado
        const naoEncontrado = []; // chave não existe no banco → roda nova
        registrosLimpos.forEach(r => {
            const sku = estoqueDbMap.get(r.unique_key);
            if (sku && sku !== "") {
                comSku.push({ key: r.unique_key, sku });
            } else if (sku === '') {
                semSkuVazio.push(r.unique_key);
            } else {
                naoEncontrado.push(r.unique_key);
            }
        });

        // DEBUG: trace target SKU after first-pass matching
        const debugComSku = comSku.find(e => e.sku === DEBUG_SKU);
        const debugSemSku = semSkuVazio.find(k => k.includes('m17|17x7|4x100'));
        const debugNaoEncontrado = naoEncontrado.find(k => k.includes('m17|17x7|4x100'));
        if (debugComSku)       dbg(`[3-MATCH 1ºpasse] SKU encontrado → key="${debugComSku.key}"`);
        else if (debugSemSku)  dbg(`[3-MATCH 1ºpasse] chave existe no banco mas sku='' → key="${debugSemSku}"`);
        else if (debugNaoEncontrado) dbg(`[3-MATCH 1ºpasse] chave NÃO encontrada no banco → key="${debugNaoEncontrado}"`);
        else                   dbg('[3-MATCH 1ºpasse] modelo não apareceu em nenhuma lista (não estava no PDF)');

        // SEGUNDO PASSE: para entradas do PDF sem correspondência exata no banco,
        // tenta match por prefixo de acabamento. Captura truncamentos que a seção 2B
        // não detectou (ex.: acabamento cortado antes do '(', sem parêntese aberto).
        const keysParaRetry = [...naoEncontrado];
        for (const key of keysParaRetry) {
            const registro = registrosLimpos.find(r => r.unique_key === key);
            if (!registro) continue;

            // Tenta o prefixo original primeiro; se não encontrar, tenta com espaço antes de '('.
            const prefixOriginalFallback = registro.acabamento;
            const prefixComEspacoFallback = registro.acabamento.replace(/(\S)\(/, '$1 (');
            const prefixesFallback = prefixOriginalFallback === prefixComEspacoFallback
                ? [prefixOriginalFallback]
                : [prefixOriginalFallback, prefixComEspacoFallback];

            let matchPorPrefixo = null;
            for (const prefix of prefixesFallback) {
                matchPorPrefixo = await Estoque.findOne({
                    attributes: ['acabamento', 'sku'],
                    where: {
                        modelo: registro.modelo,
                        aro: registro.aro,
                        pcd: registro.pcd,
                        offset: registro.offset,
                        acabamento: { [Op.like]: `${prefix}%` },
                        [Op.and]: sequelize.literal(`LENGTH(acabamento) > ${registro.acabamento.length}`)
                    },
                    order: [[sequelize.literal('LENGTH(acabamento)'), 'DESC']],
                    transaction,
                    raw: true
                });
                if (matchPorPrefixo) break;
            }

            if (matchPorPrefixo) {
                const acabamentoCompleto = normalizeString(matchPorPrefixo.acabamento);
                registro.acabamento = acabamentoCompleto;
                registro.unique_key = `${registro.modelo}|${registro.aro}|${registro.pcd}|${registro.offset}|${acabamentoCompleto}`;
                estoqueDbMap.set(registro.unique_key, matchPorPrefixo.sku);

                naoEncontrado.splice(naoEncontrado.indexOf(key), 1);
                const sku = matchPorPrefixo.sku;
                if (sku && sku !== '') {
                    comSku.push({ key: registro.unique_key, sku });
                } else {
                    semSkuVazio.push(registro.unique_key);
                }
                logger.info({ modelo: registro.modelo, de: key.split('|')[4], para: acabamentoCompleto }, 'acabamento corrigido por prefixo');
            } else {
                // Sem match por prefixo: vai ser inserido como nova linha.
                // Antes de inserir com sku='', verifica se existe uma linha com mesmo
                // modelo/aro/pcd/offset E MESMA COR que tenha SKU definido.
                // Se sim, herda o SKU para não perder a associação manual.
                // A cor é obrigatória: sem essa trava uma roda GRAFITE podia herdar o
                // SKU da PRETO e empurrar quantidade errada para o anúncio errado.
                const rodasComSkuOrfao = await Estoque.findAll({
                    attributes: ['acabamento', 'sku'],
                    where: {
                        modelo: registro.modelo,
                        aro: registro.aro,
                        pcd: registro.pcd,
                        offset: registro.offset,
                        sku: { [Op.and]: [{ [Op.ne]: '' }, { [Op.not]: null }] }
                    },
                    transaction,
                    raw: true
                });

                const mesmaCor = rodasComSkuOrfao.filter(r => colorCode(r.acabamento) === colorCode(registro.acabamento));
                if (mesmaCor.length > 0) {
                    registro.sku = mesmaCor[0].sku;
                    logger.warn({ modelo: registro.modelo, acabamento: registro.acabamento, skuHerdado: mesmaCor[0].sku, acabamentoOrigem: mesmaCor[0].acabamento }, 'SKU herdado de linha orfa (mesma cor)');
                } else if (rodasComSkuOrfao.length > 0) {
                    logger.warn({ modelo: registro.modelo, acabamento: registro.acabamento, candidatos: rodasComSkuOrfao.map(r => `${r.acabamento} [${r.sku}]`) }, 'linha orfa com SKU existe mas de cor diferente: inserindo sem SKU');
                }
            }
        }

        // DEBUG: trace target SKU after second-pass matching
        const debugComSku2 = comSku.find(e => e.sku === DEBUG_SKU);
        if (debugComSku2) {
            const reg = registrosLimpos.find(r => r.unique_key === debugComSku2.key);
            dbg(`[3-MATCH 2ºpasse] SKU confirmado → key="${debugComSku2.key}" qtde_sp=${reg?.qtde_sp} qtde_sc=${reg?.qtde_sc} qtde_pr=${reg?.qtde_pr}`);
        } else {
            const stillMissing = naoEncontrado.find(k => k.includes('m17|17x7|4x100'));
            if (stillMissing) dbg(`[3-MATCH 2ºpasse] ainda sem match após 2º passe → key="${stillMissing}"`);
            else dbg('[3-MATCH 2ºpasse] SKU não chegou ao 2º passe (não estava no PDF ou sem chave correspondente)');
        }

        // Rodas com SKU no banco que o PDF não cobriu (chave ausente ou divergente)
        const todasComSkuNoBanco = await Estoque.findAll({
            attributes: ['modelo', 'aro', 'pcd', 'offset', 'acabamento', 'sku'],
            where: { sku: { [Op.and]: [{ [Op.ne]: '' }, { [Op.not]: null }] } },
            transaction,
            raw: true
        });

        const chavesDoPDF = new Set(registrosLimpos.map(r => r.unique_key));
        const naoAtualizadas = todasComSkuNoBanco.filter(r => {
            const key = `${normalizeString(r.modelo)}|${normalizeString(r.aro)}|${normalizeString(r.pcd)}|${normalizeString(r.offset)}|${normalizeString(r.acabamento)}`;
            return !chavesDoPDF.has(key);
        });

        // DEBUG: did target SKU end up in naoAtualizadas (skipped by ML update)?
        const debugNaoAtualizada = naoAtualizadas.find(r => r.sku === DEBUG_SKU);
        if (debugNaoAtualizada) {
            const key = `${normalizeString(debugNaoAtualizada.modelo)}|${normalizeString(debugNaoAtualizada.aro)}|${normalizeString(debugNaoAtualizada.pcd)}|${normalizeString(debugNaoAtualizada.offset)}|${normalizeString(debugNaoAtualizada.acabamento)}`;
            dbg(`[4-COBERTURA] *** SKU ficou em comSKUNaoCobertasPeloPDF → anúncio NÃO será atualizado *** key_banco="${key}"`);
        } else if (comSku.find(e => e.sku === DEBUG_SKU)) {
            dbg(`[4-COBERTURA] SKU está em comSku → será incluído na sincronização ML`);
        } else {
            dbg('[4-COBERTURA] SKU não apareceu em nenhum grupo final');
        }

        logger.info({
            rodasNoPDF: registrosLimpos.length,
            atualizadasComSKU: comSku.length,
            semSKUNoBanco: semSkuVazio.length,
            naoEncontradasNoBanco: naoEncontrado.length,
            totalComSKUNoBanco: todasComSkuNoBanco.length,
            comSKUNaoCobertasPeloPDF: naoAtualizadas.length,
        }, 'diagnostico de SKUs');
        if (naoAtualizadas.length > 0) {
            logger.warn({
                rodas: naoAtualizadas.map(r => ({
                    sku: r.sku,
                    key: `${normalizeString(r.modelo)}|${normalizeString(r.aro)}|${normalizeString(r.pcd)}|${normalizeString(r.offset)}|${normalizeString(r.acabamento)}`
                }))
            }, 'rodas com SKU no banco nao cobertas pelo PDF');
        }

        // 4. PREPARAÇÃO DA LISTA DE ATUALIZAÇÃO EM MASSA (Nova Lógica)
        const listaParaSincronizarML = comSku.map(({ sku }) => ({ sku }));

        // If a component SKU changed, also push its combo SKU so the paired listing gets updated.
        const skusNaLista = new Set(listaParaSincronizarML.map(s => s.sku));
        for (const [comboSku, componentSkus] of Object.entries(COMBO_SKU_MAP)) {
            if (componentSkus.some(s => skusNaLista.has(s))) {
                listaParaSincronizarML.push({ sku: comboSku });
                logger.info({ comboSku }, 'componente atualizado: adicionando SKU combo a lista ML');
            }
        }

        // 5. ATUALIZAÇÃO DO BANCO DE DADOS
        // Importante: Não incluímos 'sku' no updateOnDuplicate para preservar os SKUs já cadastrados
        await Estoque.bulkCreate(registrosLimpos, {
            updateOnDuplicate: ['qtde_sp', 'qtde_sc', 'qtde_pr'],
            transaction: transaction
        });

        await transaction.commit();

        // 6. DISPARO DA ATUALIZAÇÃO EM MASSA PARA O MERCADO LIVRE
        let relatorioML = { atualizados: [], jaAtualizados: [], erros: [] };
        if (listaParaSincronizarML.length > 0) {
            try {
                logger.info({ skus: listaParaSincronizarML.length }, 'ML: iniciando sincronizacao em massa');
                relatorioML = await processCriticalUpdates(listaParaSincronizarML, access_token);
            } catch (apiError) {
                logger.error({ err: apiError }, 'falha na atualizacao em massa do ML');
            }
        }

        logger.info({ modelosProcessados: registrosLimpos.length, anunciosEnviados: listaParaSincronizarML.length }, 'sincronizacao de estoque concluida');

        return {
            timestamp: new Date().toISOString(),
            formatoNovoDetectado,
            resumo: {
                totalRodasNoPDF: registrosLimpos.length,
                atualizadasComSKU: comSku.length,
                semSKUNoBanco: semSkuVazio.length,
                novasNaoEncontradas: naoEncontrado.length,
                comSKUNaoCobertasPeloPDF: naoAtualizadas.length,
            },
            semSKU: semSkuVazio,
            naoEncontradas: naoEncontrado,
            comSKUNaoCobertasPeloPDF: naoAtualizadas.map(r => {
                const dbModelo = normalizeString(r.modelo);
                const candidatos = registrosLimpos
                    .filter(p => p.modelo === dbModelo)
                    .map(p => p.unique_key);
                return {
                    chave: `${dbModelo}|${normalizeString(r.aro)}|${normalizeString(r.pcd)}|${normalizeString(r.offset)}|${normalizeString(r.acabamento)}`,
                    sku: r.sku,
                    candidatosNoPDF: candidatos
                };
            }),
            resultadosML: relatorioML,
            debugTrace: { sku: DEBUG_SKU, eventos: getDebugTrace() }
        };

    } catch (error) {
        if (transaction) await transaction.rollback();
        logger.error({ err: error }, 'erro fatal ao sincronizar estoque');
        throw error;
    }
};

// =====================================================================




const normalizeModelCodes = async () => {

    MODEL_MAP = {
        'g140': 'sampso',
        'g1810': 'ballina',
        'g1010': 'ak2010',
        'g18': 'silvera',
        'g37': 'te37',
    };

    
    
    const transaction = await sequelize.transaction();
        let totalUpdates = 0;

        try {
            logger.info('Normalize: iniciando transferencia de estoque entre codigos de modelos');

            const modelCodes = Object.keys(MODEL_MAP); 

            // 1. Itera sobre cada código de modelo de ORIGEM (Ex: 'g140')
            for (const sourceModel of modelCodes) {
                const targetModel = MODEL_MAP[sourceModel];
                
                // 2. ENCONTRAR OS REGISTROS DE ORIGEM COMPLETOS (Ex: todas as linhas 'g140')
                const sourceEntries = await EstoqueTemporario.findAll({
                    where: { 
                        modelo: sourceModel,
                        [Op.or]: [{ qtde_pr: { [Op.gt]: 0 } }, { qtde_sc: { [Op.gt]: 0 } }]
                    },
                    transaction,
                    raw: true,
                });

                if (sourceEntries.length === 0) {
                    continue;
                }

                // 3. PROCESSAMENTO E TRANSFERÊNCIA DE CADA LINHA DE ORIGEM
                for (const entry of sourceEntries) {


                    let acabamentoParaBusca = entry.acabamento;
                    let furacaoCorrigida = entry.pcd;
                    let offsetCorrigido = entry.offset;

                    if (sourceModel === 'g1810' && acabamentoParaBusca === 'hd (prata diamantada)') {
                        // Aplica o valor que o modelo de destino (ballina) possui
                        acabamentoParaBusca = 'sd (prata diamantada)';
                        furacaoCorrigida = '4x99';
                        logger.info({ sourceModel, targetModel }, "Normalize: corrigindo acabamento 'hd' para 'sd'");
                    }

                    if (sourceModel === 'g37') {
                        offsetCorrigido = '38';
                        logger.info({ sourceModel, targetModel }, 'Normalize: corrigindo offset para 38');
                    }

                    if (sourceModel === 'g37' && acabamentoParaBusca === 'bf (black fosco)' && (furacaoCorrigida === '4x108' || furacaoCorrigida === '5x100')) {
                        
                        acabamentoParaBusca = 'bf (black fosco.)';
                        logger.info({ sourceModel, targetModel }, 'Normalize: corrigindo acabamento bf (black fosco.)');
                    }

                    if (sourceModel === 'g37' && acabamentoParaBusca === 'ouro (ouro velho)') {
                        acabamentoParaBusca = 'ovf (ouro velho fosco)'
                        logger.info({ sourceModel, targetModel }, 'Normalize: corrigindo acabamento ouro (ouro velho)');
                    }

                    // Condição de busca: LOCALIZA O MODELO DE DESTINO (Ex: 'sampso')
                    // QUE POSSUI EXATAMENTE OS MESMOS ATRIBUTOS DA CHAVE COMPOSTA.
                    const targetWhere = {
                        modelo: targetModel, // O Modelo que deve receber ('sampso')
                        aro: entry.aro,
                        pcd: furacaoCorrigida,
                        offset: offsetCorrigido,
                        acabamento: acabamentoParaBusca
                    };

                    // 4. ATUALIZAÇÃO DO REGISTRO DE DESTINO
                    // Este update moverá o qtde_pr e qtde_sc do modelo 'g140' para o 'sampso'
                    const [updatedCount] = await EstoqueTemporario.update(
                        {
                            qtde_pr: entry.qtde_pr, 
                            qtde_sc: entry.qtde_sc,
                            // O SKU permanece NULL
                        },
                        { where: targetWhere, transaction }
                    );

                    if (updatedCount > 0) {
                        totalUpdates += updatedCount;
                        
                        // 5. ZERAR A QUANTIDADE DE ORIGEM APÓS A TRANSFERÊNCIA BEM-SUCEDIDA
                        await EstoqueTemporario.update(
                            { qtde_pr: 0, qtde_sc: 0 },
                            { where: { id: entry.id }, transaction }
                        );
                    }
                }
            }

            await transaction.commit();
            logger.info({ totalUpdates }, 'Normalize: transferencia interna concluida');
            return { success: true, updates: totalUpdates };

        } catch (error) {
            await transaction.rollback();
            logger.error({ err: error }, 'Normalize: erro fatal na normalizacao interna de modelos');
            throw error;
        }
}





// =====================================================================



//
//
//
//
//const getRoda = async (detalhesAnuncio) => {
//    let quantidadeTotal;
//    try{
//        logger.info('capturando detalhes de estoque')
//        let skuRodas = [];
//        let quantidadesDisponiveis = [];
//
//        for(const detalheAnuncio of detalhesAnuncio){
//        
//            skuRodas.push(detalheAnuncio.sku)
//        
//        }
//        
//
//        for(const skuRoda of skuRodas){
//
//            let roda = await Estoque.findOne({
//               where: {
//                   sku: skuRoda
//               },
//                raw: true
//            })
//
//            if(roda){
//                quantidadeTotal = roda.qtde_sp 
//                //+ roda.qtde_sc + roda.qtde_pr;
//
//                
//            } else {
//                quantidadeTotal = null
//                logger.warn({ sku: skuRoda }, 'SKU sem correspondencia no estoque da distribuidora');
//                return [];
//            }
//            
//
//            quantidadesDisponiveis.push({
//                sku: skuRoda, // É bom salvar o SKU para referência
//                quantidade: quantidadeTotal
//            });
//        }
//
//
//        return quantidadesDisponiveis;
//    }catch(error){
//        logger.error({ err: error }, 'erro ao coletar quantidades disponiveis');
//        throw error; // Lança o erro para o controller
//    }
//}



// =====================================================================

// /server/src/services/stock.service.js

const getRoda = async (detalhesAnuncio) => {
    
    // ==========================================================
    // 🎯 CONFIGURAÇÃO DE ESTOQUE ATUAL
    // Deve ser o mesmo valor usado em subtrairRodasDoEstoque para consistência.
    // Altere para 'true' para somar SC e PR, ou 'false' para usar APENAS SP.
    const useFullStock = false; 
    // ==========================================================

    let quantidadeTotal;
    try{
        logger.info('capturando detalhes de estoque')
        let skuRodas = [];
        let quantidadesDisponiveis = [];

        for(const detalheAnuncio of detalhesAnuncio){
        
            skuRodas.push(detalheAnuncio.sku)
        
        }
        

        for(const skuRoda of skuRodas){

            // Special case: virtual combo SKU that bundles two rim-width variants.
            // Available sets = floor(min(stock_aro6, stock_aro7) / 2).
            // We return 2*min so that generateUpdatePayload's floor(bruta/4) = floor(min/2).
            if (COMBO_SKU_MAP[skuRoda]) {
                const [sku1, sku2] = COMBO_SKU_MAP[skuRoda];
                const [r1, r2] = await Promise.all([
                    Estoque.findOne({ where: { sku: sku1 }, raw: true }),
                    Estoque.findOne({ where: { sku: sku2 }, raw: true }),
                ]);
                const q1 = r1 ? (useFullStock ? r1.qtde_sp + r1.qtde_sc + r1.qtde_pr + r1.qtde_loca : r1.qtde_sp + r1.qtde_local) : 0;
                const q2 = r2 ? (useFullStock ? r2.qtde_sp + r2.qtde_sc + r2.qtde_pr + r2.qtde_loca : r2.qtde_sp + r2.qtde_local) : 0;
                const minQ = Math.min(q1, q2);
                logger.info({ comboSku: skuRoda, sku1, q1, sku2, q2, minQ, quantidade: 2 * minQ }, 'getRoda combo: calculando quantidade minima');
                quantidadesDisponiveis.push({ sku: skuRoda, quantidade: 2 * minQ });
                continue;
            }

            let roda = await Estoque.findOne({
               where: {
                   sku: skuRoda
               },
                raw: true
            })

            if(roda){

                // --- CÁLCULO DE QUANTIDADE TOTAL CONDICIONAL ---
                if (useFullStock) {
                    // Soma SP + SC + PR
                    quantidadeTotal = roda.qtde_sp + roda.qtde_sc + roda.qtde_pr + roda.qtde_loca;
                } else {
                    // Apenas SP (Configuração atual do cliente)
                    quantidadeTotal = roda.qtde_sp + roda.qtde_local;
                }
                // --- FIM DO CÁLCULO ---

                if (skuRoda === DEBUG_SKU) {
                    dbg(`[5-GETROD] qtde_sp=${roda.qtde_sp} qtde_sc=${roda.qtde_sc} qtde_pr=${roda.qtde_pr} qtde_local=${roda.qtde_local} → quantidadeTotal=${quantidadeTotal} (useFullStock=${useFullStock})`);
                }
            } else {
                // SKU not found in stock (e.g. discontinued variation) — set to 0 and
                // keep processing the remaining variations instead of aborting the listing
                logger.warn({ sku: skuRoda }, 'SKU sem correspondencia no estoque: zerando variacao e continuando');
                quantidadesDisponiveis.push({ sku: skuRoda, quantidade: 0 });
                continue;
            }


            quantidadesDisponiveis.push({
                sku: skuRoda, // É bom salvar o SKU para referência
                quantidade: quantidadeTotal
            });
        }


        return quantidadesDisponiveis;
    }catch(error){
        logger.error({ err: error }, 'erro ao coletar quantidades disponiveis');
        throw error; // Lança o erro para o controller
    }
}

// ==============================================================================================================================

const mergeStockPrFromTemporary = async () => {
    // Lista das colunas que identificam a roda (chave composta)
    const uniqueFields = ['modelo', 'aro', 'pcd', 'offset', 'acabamento'];

    // 1. Buscamos TODOS os dados (modelo, qtde_pr) do estoque temporário que são válidos.
    const registrosTemporarios = await EstoqueTemporario.findAll({
        attributes: [...uniqueFields, 'qtde_pr'],
        // Filtramos apenas aqueles que têm quantidades positivas para evitar loops desnecessários
        //where: { qtde_pr: { [Op.gt]: 0 } }, 
        raw: true
    });

    if (registrosTemporarios.length === 0) {
        logger.info('Merge: nenhuma quantidade positiva para qtde_pr no estoque temporario');
        return { message: "Nenhuma atualização de estoque PR realizada." };
    }

    const transaction = await sequelize.transaction();

    try {
        logger.info({ registros: registrosTemporarios.length }, 'Merge: registros encontrados para matching');

        let updatesRealizados = 0;

        // 2. Iteramos sobre cada registro temporário
        for (const tempRoda of registrosTemporarios) {
            
            // 3. Normalizamos os campos para encontrar a correspondência (Match)
            const modelo = normalizeString(tempRoda.modelo);
            const aro = normalizeString(tempRoda.aro); 
            const pcd = normalizeString(tempRoda.pcd);
            const offset = normalizeString(tempRoda.offset);
            const acabamento = normalizeString(tempRoda.acabamento);

 

    
            // 4. Montamos a condição de busca (WHERE) para a tabela Estoque principal
            // Usamos os campos normalizados para o matching
            const matchCondition = {
                [Op.and]: { 
                    modelo: modelo,
                    aro: aro,
                    pcd: pcd,
                    offset: offset,
                    acabamento: acabamento,
                }
            };

            const registroPrincipal = await Estoque.findOne({
                attributes: ['id', 'qtde_pr'], // BUSCAR APENAS A PK
                where: matchCondition,
                transaction: transaction,
                raw: true
            });

            if (!registroPrincipal) {
                //if (isTarget) {
                //    console.warn(`3. ❌ FALHA: Registro principal NÃO ENCONTRADO com esta chave. A falha NÃO é no UPDATE, mas no WHERE.`);
                //}
                continue;
                
            }


            const qtdeAnterior = registroPrincipal.qtde_pr; // Valor de referência
            const novoValor = tempRoda.qtde_pr;

            // 5. Executamos o UPDATE no Estoque principal (apenas para a linha que corresponde)
            const [updatedRows] = await Estoque.update(
                { qtde_pr: novoValor }, 
                { 
                    where: { id: registroPrincipal.id },
                    transaction: transaction
                }
            );


            if (updatedRows > 0) {
                updatesRealizados += updatedRows;

            }else {
                logger.warn({ modelo: tempRoda.modelo, aro: tempRoda.aro }, 'Merge: linha nao atualizada no estoque principal');
            }
        
        }

        logger.info('Merge: limpando valores NULL em qtde_pr');
        
        const [nullToZeroCount] = await Estoque.update(
            { qtde_pr: 0 },
            { 
                where: { qtde_pr: { [Op.is]: null } }, // Onde qtde_pr é NULL
                transaction: transaction
            }
        );
        
        logger.info({ nullToZeroCount }, 'Merge: linhas alteradas de NULL para 0');

        await transaction.commit();

        logger.info({ updatesRealizados }, 'Merge: atualizacao de qtde_pr concluida');

        return { 
            success: true, 
            message: `Merge de qtde_pr concluído. ${updatesRealizados} rodas atualizadas.`
        };

    
    } catch (error) {
        await transaction.rollback();
        logger.error({ err: error }, 'Merge: erro fatal no merge de estoque PR');
        throw error;
    }
}




// ==============================================================================================================================

//const subtrairRodasDoEstoque = async (sku, quantidadeABaixar) => {
//
//    
//    // Usamos uma transação para garantir que a baixa seja atômica
//    const transaction = await sequelize.transaction();
//    
//    try {
//        console.log(`[BAIXA ESTOQUE] Iniciando baixa de ${quantidadeABaixar} unidades para SKU: ${sku}`);
//
//        // 1. Busca os registros para verificar o estoque atual
//        const rodas = await Estoque.findAll({
//            where: { sku: sku },
//            transaction: transaction,
//            raw: true
//        });
//
//        if (rodas.length === 0) {
//            console.warn(`[BAIXA ESTOQUE] SKU '${sku}' não encontrado na tabela de estoque. Nenhuma baixa realizada.`);
//            await transaction.rollback();
//            return;
//        }
//
//        // Assumimos que o SKU só tem uma entrada no DB, mas usamos o for para iterar sobre o array
//        for (const roda of rodas) {
//            
//            const estoqueAtualTotal = roda.qtde_sp 
//            //+ roda.qtde_sc + roda.qtde_pr;
//            
//            if (estoqueAtualTotal < quantidadeABaixar) {
//                 console.warn(`[BAIXA ESTOQUE] Estoque insuficiente (${estoqueAtualTotal} unid.) para a baixa de ${quantidadeABaixar} unid. para SKU: ${sku}.`);
//                 // Não lançamos erro, mas pulamos a baixa
//
//                 await transaction.rollback(); // 
//                 return;
//                  
//            }
//            
//            // Variáveis que guardarão as novas quantidades
//
//            let restanteABaixar = quantidadeABaixar;
//
//            let novaQtdeSP = roda.qtde_sp;
//            let novaQtdeSC = roda.qtde_sc;
//            let novaQtdePR = roda.qtde_pr;
//
//            let logBaixa = [];
//            
//            // --- LÓGICA DE PRIORIZAÇÃO DA BAIXA ---
//            
//            // 1. BAIXA EM SÃO PAULO (SP)
//            if (restanteABaixar > 0) {
//                const baixadaSP = Math.min(restanteABaixar, roda.qtde_sp);
//                novaQtdeSP = roda.qtde_sp - baixadaSP;
//                restanteABaixar -= baixadaSP;
//                if (baixadaSP > 0) logBaixa.push(`${baixadaSP} unid. de SP`);
//            }
//            
//            // 2. BAIXA EM SANTA CATARINA (SC)
//            if (restanteABaixar > 0) {
//                const baixadaSC = Math.min(restanteABaixar, roda.qtde_sc);
//                novaQtdeSC = roda.qtde_sc - baixadaSC;
//                restanteABaixar -= baixadaSC;
//                if (baixadaSC > 0) logBaixa.push(`${baixadaSC} unid. de SC`);
//            }
//
//            // 3. BAIXA NO PARANÁ (PR)
//            if (restanteABaixar > 0) {
//                const baixadaPR = Math.min(restanteABaixar, roda.qtde_pr);
//                novaQtdePR = roda.qtde_pr - baixadaPR;
//                restanteABaixar -= baixadaPR;
//                if (baixadaPR > 0) logBaixa.push(`${baixadaPR} unid. de PR`);
//            }
//
//            // --- Verificação Final ---
//            if (restanteABaixar > 0) {
//                // Esta condição NÃO deve ser atingida devido à checagem inicial de estoque total
//                console.error("[BAIXA ESTOQUE] ERRO LÓGICO: Falha ao subtrair todas as unidades!");
//                await transaction.rollback();
//                return;
//            }
//
//            logger.info({ sku, quantidade: quantidadeABaixar, composicao: logBaixa.join(' + ') }, 'baixa de estoque executada');
//            
//            // --- Execução da Atualização ---
//            await Estoque.update(
//                { 
//                    qtde_sp: novaQtdeSP,
//                    qtde_sc: novaQtdeSC,
//                    qtde_pr: novaQtdePR
//                },
//                { 
//                    where: { id: roda.id }, 
//                    transaction: transaction 
//                }
//            );
//        }
//        
//        await transaction.commit(); // Confirma a transação
//        
//        console.log(`[BAIXA ESTOQUE] Baixa concluída para SKU: ${sku}. 4 unidades subtraídas com sucesso para SKU: ${sku}`);
//
//    } catch (error) {
//        await transaction.rollback(); // Desfaz a transação em caso de erro
//        console.error(`Erro fatal durante a baixa de estoque do SKU ${sku}:`, error);
//        throw error;
//    }
//};

// ==============================================================================================================================

const subtrairRodasDoEstoque = async (sku, quantidadeABaixar) => {
    
    // ==========================================================
    //  CONFIGURAÇÃO DE ESTOQUE ATUAL
    // Altere para 'true' para incluir SC e PR na baixa, ou 'false' para usar APENAS SP.
    const useFullStock = false; 
    // ==========================================================


    // Usamos uma transação para garantir que a baixa seja atômica
    const transaction = await sequelize.transaction();
    
    try {
        logger.info({ sku, quantidade: quantidadeABaixar }, 'baixa de estoque iniciada');

        // 1. Busca os registros para verificar o estoque atual
        const rodas = await Estoque.findAll({
            where: { sku: sku },
            transaction: transaction,
            raw: true
        });

        if (rodas.length === 0) {
            logger.warn({ sku }, 'baixa de estoque: SKU nao encontrado, nenhuma baixa realizada');
            await transaction.rollback();
            return;
        }

        // Assumimos que o SKU só tem uma entrada no DB, mas usamos o for para iterar sobre o array
        for (const roda of rodas) {
            
            let estoqueAtualTotal;
            
            // --- VERIFICAÇÃO DE ESTOQUE TOTAL ---
            if (useFullStock) {
                // Opção 1: Estoque completo (SP + SC + PR)
                estoqueAtualTotal = roda.qtde_sp + roda.qtde_sc + roda.qtde_pr;
            } else {
                // Opção 2: Apenas estoque de SP (Atual preferência do cliente)
                estoqueAtualTotal = roda.qtde_sp;
            }
            
            if (estoqueAtualTotal < quantidadeABaixar) {
                 logger.warn({ sku, estoqueAtual: estoqueAtualTotal, quantidadeABaixar }, 'baixa de estoque: estoque insuficiente');
                 await transaction.rollback();
                 return;
            }
            
            // Variáveis que guardarão as novas quantidades
            let restanteABaixar = quantidadeABaixar;
            let novaQtdeSP = roda.qtde_sp;
            let novaQtdeSC = roda.qtde_sc;
            let novaQtdePR = roda.qtde_pr;
            let logBaixa = [];
            
            
            // --- LÓGICA DE PRIORIZAÇÃO DA BAIXA (Condicional) ---
            
            // 1. BAIXA EM SÃO PAULO (SP) - SEMPRE PRIORITÁRIO
            if (restanteABaixar > 0) {
                const baixadaSP = Math.min(restanteABaixar, roda.qtde_sp);
                novaQtdeSP = roda.qtde_sp - baixadaSP;
                restanteABaixar -= baixadaSP;
                if (baixadaSP > 0) logBaixa.push(`${baixadaSP} unid. de SP`);
            }
            
            if (useFullStock) {
                // 2. BAIXA EM SANTA CATARINA (SC)
                if (restanteABaixar > 0) {
                    const baixadaSC = Math.min(restanteABaixar, roda.qtde_sc);
                    novaQtdeSC = roda.qtde_sc - baixadaSC;
                    restanteABaixar -= baixadaSC;
                    if (baixadaSC > 0) logBaixa.push(`${baixadaSC} unid. de SC`);
                }

                // 3. BAIXA NO PARANÁ (PR)
                if (restanteABaixar > 0) {
                    const baixadaPR = Math.min(restanteABaixar, roda.qtde_pr);
                    novaQtdePR = roda.qtde_pr - baixadaPR;
                    restanteABaixar -= baixadaPR;
                    if (baixadaPR > 0) logBaixa.push(`${baixadaPR} unid. de PR`);
                }
            }
            // --- FIM DA LÓGICA DE PRIORIZAÇÃO ---

            // --- Verificação Final ---
            if (restanteABaixar > 0) {
                logger.error({ sku, restanteABaixar }, 'baixa de estoque: ERRO LOGICO ao subtrair todas as unidades');
                await transaction.rollback();
                return;
            }

            logger.info({ sku, quantidade: quantidadeABaixar, composicao: logBaixa.join(' + ') }, 'baixa de estoque executada');
            
            // --- Execução da Atualização ---
            await Estoque.update(
                { 
                    qtde_sp: novaQtdeSP,
                    // *** QUANDO useFullStock É false, qtde_sc e qtde_pr são definidos com o valor antigo, mantendo-o intacto. ***
                    qtde_sc: novaQtdeSC, 
                    qtde_pr: novaQtdePR
                },
                { 
                    where: { id: roda.id }, 
                    transaction: transaction 
                }
            );
        }
        
        await transaction.commit(); // Confirma a transação
        
        logger.info({ sku, quantidadeABaixar }, 'baixa de estoque concluida');

    } catch (error) {
        await transaction.rollback();
        logger.error({ err: error, sku }, 'erro fatal na baixa de estoque');
        throw error;
    }
};


// ==============================================================================================================================

const subtrairRodasDeUmAnuncioDuasTalas = async (sku, quantidadeABaixar) => {

    let rodas = [];
    // Usamos uma transação para garantir que a baixa seja atômica
    const transaction = await sequelize.transaction();
    
    try {
        logger.info({ sku, quantidade: quantidadeABaixar / 2 }, 'baixa de estoque duas talas iniciada');

        // 1. Busca os registros para verificar o estoque atual
        if(sku === 'M08ARO14675-114BD'){

            rodas = rodas.concat(await Estoque.findAll({
                where: { sku: 'M08ARO1465-114BD' },
                transaction: transaction,
                raw: true
            }));

            rodas = rodas.concat(await Estoque.findAll({
                where: { sku: 'M08ARO1475-114BD' },
                transaction: transaction,
                raw: true
            }));

        } else if(sku === 'M08ARO14675-114FBD') {
                    

            rodas = rodas.concat(await Estoque.findAll({
                where: { sku: 'M08ARO1465-114FBD' },
                transaction: transaction,
                raw: true
            }));

            rodas = rodas.concat(await Estoque.findAll({
                where: { sku: 'M08ARO1475-114FBD' },
                transaction: transaction,
                raw: true
            }));
        }

        


        if (rodas.length !== 2) {
            logger.warn({ sku, rodasEncontradas: rodas.length }, 'baixa duas talas: SKU nao encontrado ou incompleto, nenhuma baixa realizada');
            await transaction.rollback();
            return;
        }

        //Iterando na array de rodas, pois temos dentro de um anúncio, vendemos um par de rodas do mesmo modelo mas com talas diferentes
        for (const roda of rodas) {
            
            const estoqueAtualTotal = roda.qtde_sp + roda.qtde_sc;
            
            if (estoqueAtualTotal < (quantidadeABaixar/2)) {
                 logger.warn({ sku, estoqueAtual: estoqueAtualTotal, quantidadeNecessaria: quantidadeABaixar / 2 }, 'baixa duas talas: estoque insuficiente');
                 await transaction.rollback(); // Cancela TUDO se o estoque for insuficiente em uma das talas
                 return;
            }
            
            // Variáveis que guardarão as novas quantidades
            let novaQtdeSP = roda.qtde_sp;
            let novaQtdeSC = roda.qtde_sc;
            
            // --- LÓGICA DE PRIORIZAÇÃO DA BAIXA ---
            
            if (roda.qtde_sp >= (quantidadeABaixar/2)) {

                logger.info({ sku, quantidade: quantidadeABaixar / 2, fonte: 'SP' }, 'baixa duas talas: baixando de SP');
                novaQtdeSP = roda.qtde_sp - quantidadeABaixar/2;

            } else if (roda.qtde_sp > 0 && roda.qtde_sp < (quantidadeABaixar/2)) {

                const qtdeBaixadaSP = roda.qtde_sp;
                const qtdeFaltanteSC = (quantidadeABaixar/2) - qtdeBaixadaSP;
                
                // Baixa de SP
                novaQtdeSP = 0;
                
                // Baixa de SC (garantido que qtdeFaltanteSC é > 0 e <= 4)
                novaQtdeSC = roda.qtde_sc - qtdeFaltanteSC;
                
                logger.info({ sku, qtdeSP: qtdeBaixadaSP, qtdeSC: qtdeFaltanteSC }, 'baixa duas talas: usando SP e SC');

            } else if (roda.qtde_sp === 0) {

                logger.info({ sku, quantidade: quantidadeABaixar / 2, fonte: 'SC' }, 'baixa duas talas: baixando de SC');

                novaQtdeSC = roda.qtde_sc - (quantidadeABaixar/2);
                
            }

            // Garante que a quantidade nunca seja negativa (Embora a checagem inicial ajude)
            novaQtdeSP = Math.max(0, novaQtdeSP);
            novaQtdeSC = Math.max(0, novaQtdeSC);
            
            // --- Execução da Atualização ---
            await Estoque.update(
                { 
                    qtde_sp: novaQtdeSP,
                    qtde_sc: novaQtdeSC
                },
                { 
                    where: { id: roda.id }, 
                    transaction: transaction 
                }
            );
        }
        
        await transaction.commit(); // Confirma a transação
        
        logger.info({ sku }, 'baixa duas talas concluida');

    } catch (error) {
        await transaction.rollback();
        logger.error({ err: error, sku }, 'erro fatal na baixa de estoque duas talas');
        throw error;
    }
};

// ==============================================================================================================================

// Called by the sales scheduler to confirm a combo-SKU sale maps to real stock entries.
// Returns a non-empty array when both component wheels exist in estoque_rodas_distribuidora.
const getRodaDeVendaDuasTalas = async (detalhesAnuncio) => {
    const comboSku = detalhesAnuncio[0]?.sku;
    const componentSkus = COMBO_SKU_MAP[comboSku];
    if (!componentSkus) {
        logger.warn({ sku: comboSku }, 'getRodaDeVendaDuasTalas: SKU combo nao mapeado');
        return [];
    }
    try {
        const [r1, r2] = await Promise.all([
            Estoque.findOne({ where: { sku: componentSkus[0] }, raw: true }),
            Estoque.findOne({ where: { sku: componentSkus[1] }, raw: true }),
        ]);
        if (!r1 || !r2) {
            logger.warn({ comboSku, sku1: componentSkus[0], sku2: componentSkus[1], found1: !!r1, found2: !!r2 }, 'getRodaDeVendaDuasTalas: componentes do combo nao encontrados no estoque');
            return [];
        }
        return [
            { sku: componentSkus[0], quantidade: r1.qtde_sp + r1.qtde_local },
            { sku: componentSkus[1], quantidade: r2.qtde_sp + r2.qtde_local },
        ];
    } catch (error) {
        logger.error({ err: error, comboSku }, 'erro em getRodaDeVendaDuasTalas');
        throw error;
    }
};

// ==============================================================================================================================

const getRodaDetailsBySku = async (sku) => {
    try {
        const roda = await Estoque.findOne({
            attributes: ['modelo', 'aro', 'pcd', 'offset', 'acabamento'],
            where: { sku: sku },
            raw: true
        });
        return roda;
    } catch (error) {
        logger.error({ err: error, sku }, 'erro ao buscar detalhes da roda');
        return null;
    }
}

// ==============================================================================================================================

const saveLocalStock = async (dadosPlanilha) => {
    const transaction = await sequelize.transaction();
    const skusNaoEncontrados = [];
    let skusAtualizados = 0;
    
    try {
        logger.info('iniciando atualizacao de estoque local');

        // 1. Zera o estoque local antigo para garantir fidelidade à nova planilha
        await Estoque.update({ qtde_local: 0 }, { where: {}, transaction });

        for (const item of dadosPlanilha) {
            // Normaliza o SKU para bater com o padrão do banco (trim e lowercase)
            const skuOriginal = item.SKU;
            const skuNormalizado = skuOriginal;
            const quantidade = parseInt(item.QUANTIDADE) || 0;

            if (skuNormalizado) {
                // Tenta atualizar a coluna qtde_local apenas se o SKU existir
                const [rowsAffected] = await Estoque.update(
                    { qtde_local: quantidade },
                    { 
                        where: { sku: skuNormalizado },
                        transaction 
                    }
                );

                if (rowsAffected > 0) {
                    skusAtualizados++;
                } else {
                    // Adiciona ao log de ignorados se não houver correspondência no banco
                    skusNaoEncontrados.push(skuOriginal);
                }
            }
        }

        await transaction.commit();

        logger.info({ skusAtualizados, skusIgnorados: skusNaoEncontrados.length }, 'estoque local atualizado');
        if (skusNaoEncontrados.length > 0) {
            logger.warn({ skus: skusNaoEncontrados }, 'SKUs da planilha nao encontrados no banco');
        }
        
    } catch (error) {
        if (transaction) await transaction.rollback();
        logger.error({ err: error }, 'erro fatal ao salvar estoque local');
        throw error;
    }
};

// Exporta as funções para serem usadas no controller
module.exports = {
    parseTxtToWheels,
    parseTxtToWheelsSul,
    saveStock,
    saveStockSul,
    getRoda,
    getRodaDeVendaDuasTalas,
    subtrairRodasDoEstoque,
    subtrairRodasDeUmAnuncioDuasTalas,
    normalizeModelCodes,
    mergeStockPrFromTemporary,
    getRodaDetailsBySku,
    saveLocalStock
};