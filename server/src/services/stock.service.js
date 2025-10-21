// /server/src/services/stock.service.js
const { Estoque, sequelize } = require('../config/database');
const { Op } = require('sequelize');

// Lógica para transformar o texto do PDF em dados estruturados
function parseTxtToWheels(text) {
    const lines = text.trim().split('\n');
    const results = [];

    // O seu regex, inalterado
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
        } else {
            console.warn(`Linha ignorada (não corresponde ao padrão): "${line}"`);
        }
    }

    return results;
}


// ================= SALVAR ESTOQUE SAFE ==========================================
// Lógica para salvar os dados no banco de dados (exemplo)
//const saveStock = async (estoque) => {
//    try {
//        // 1. Limpar a tabela antes de inserir novos dados
//        console.log('Limpando a tabela de estoque...');
//        await Estoque.destroy({ where: {} });
//        console.log('Tabela estoque_rodas_distribuidora limpa com sucesso.');
//        
//        let rodasInseridas = 0;
//        let registrosParaInserir = [];
//
//        // 2. Iterar sobre o array de rodas e inserir cada uma
//        for (const roda of estoque) {
//            //const sqlInsert = `
//            //    INSERT INTO estoque_rodas_distribuidora (
//            //        modelo,
//            //        aro,
//            //        pcd,
//            //        offset,
//            //        acabamento,
//            //        qtde_sp,
//            //        qtde_sc
//            //    ) VALUES (?, ?, ?, ?, ?, ?, ?)
//            //`;
//            //const values = [
//            //    roda.MODELO,
//            //    roda.ARO,
//            //    roda.PCD,
//            //    roda.OFFSET,
//            //    roda.ACABAMENTO,
//            //    roda.QTDE_SP,
//            //    roda.QTDE_SC
//            //];
//            const novoRegistro = {
//                modelo: roda.MODELO,
//                aro: roda.ARO,
//                pcd: roda.PCD,
//                offset: roda.OFFSET,
//                acabamento: roda.ACABAMENTO,
//                qtde_sp: roda.QTDE_SP,
//                qtde_sc: roda.QTDE_SC
//            };
//            registrosParaInserir.push(novoRegistro);
//            rodasInseridas++;
//        }
//
//        if (registrosParaInserir.length > 0) {
//            await Estoque.bulkCreate(registrosParaInserir);
//        }
//        console.log(`Estoque de rodas atualizado com sucesso! ${rodasInseridas} rodas inseridas.`);
//
//    } catch (error) {
//        console.error('Erro ao atualizar o estoque:', error);
//        // Lança o erro para que o controller o capture
//        throw error;
//    }
//};



//============================== SALVAR ESTOQUE ATUALIZANDO AS QUANTIDADES MAS MANTENDO MODELOS E SKUs =====================================


//FUNÇÃO PARA LIDAR COM NOMES INCOMPLETOS (ISSO ACONTECE QUANDO O ESTOQUE ZERA)
const fixModelName = (modelName) => {
    // Garante que o nome seja uma string para o switch/case funcionar
    const name = String(modelName).trim().toLowerCase(); 

    switch (name) {
        case 'morga':
        case 'morg':
            return 'morgan'; // Retorna o nome completo e correto
        
        case 'orbita':
            return 'orbital';

        case 'newsu':
            return 'newsun';

        case 'porsc':
            return 'porsch';
        
        case 'samps':
            return 'sampso';

        case 'stroll':
            return 'strolle';

        case 'discov':
            return 'discove';
        
        case 'ballin':
            return 'ballina';

        case 'silver':
            return 'silvera';

        case 'summe':
            return 'summer';


        default:
            return name; // Retorna o nome original se não for um caso conhecido
    }
};


//FUNÇÃO PARA LIDAR COM ACABAMENTOS INCOMPLETOS (ISSO ACONTECE QUANDO O ESTOQUE ZERA)
const fixAcabamento = (acabamento) => {
    // Garante que o nome seja uma string para o switch/case funcionar
    const name = String(acabamento).trim().toLowerCase(); 

    switch (name) {
        
        case 'gbbd (grafite brilho':
            return 'gbbd (grafite brilho borda'; // Retorna o nome completo e correto
        

        default:
            return name; // Retorna o nome original se não for um caso conhecido
    }
};



//NORMALIZANDO STRING NO BANCO DE DADOS
const normalizeString = (str) => {
    if (str === null || str === undefined) return '';
    return String(str).trim().toLowerCase();
};



const saveStock = async (estoque) => {

    // Lista das colunas que identificam a roda (chave composta)
    const uniqueFields = ['modelo', 'aro', 'pcd', 'offset', 'acabamento'];
    
    // Inicia uma transação para garantir que a operação seja atômica
    const transaction = await sequelize.transaction();
    
    try {
        console.log("Iniciando a sincronização inteligente de estoque...");

        // 1. PREPARAÇÃO DOS DADOS: Cria a lista de objetos para o Upsert
        const registrosParaUpsert = estoque.map((roda, index) => {

            // --- CORREÇÃO DE MODELOS INCOMPLETOS --

            const nomeModeloCorrigido = fixModelName(roda.MODELO);

            // --- FIM DA CORREÇÃO DE MODELOS INCOMPLETOS --





            // -- CORREÇÃO ACABAMENTO INCOMPLETO --

                const acabamentoCorrigido = fixAcabamento(roda.ACABAMENTO);

            // -- FIM DA CORREÇÃO ACABAMENTO INCOMPLETO --
            



            let aroCorrigido = String(roda.ARO || '');
            





            // --- CORREÇÃO DO CAMPO ARO (Padronização) ---

            // 1. Regra de Negócio: Se o aro termina em vírgula (ex: '20x7,'), assume-se que é ',5' e corrige.
            if (aroCorrigido.endsWith(',')) {
                
                 aroCorrigido = `${aroCorrigido}5`; // '20x7,' vira '20x7,5'

            }
            // --- FIM DA CORREÇÃO DO CAMPO ARO ---
            


            // Normaliza cada campo da chave composta
            const modelo = normalizeString(nomeModeloCorrigido);

            // CORREÇÃO ESSENCIAL: Usa o aroCorrigido e normaliza para a chave
            const aro = normalizeString(aroCorrigido); 

            const pcd = normalizeString(roda.PCD);

            const offset = normalizeString(roda.OFFSET);

            const acabamento = normalizeString(acabamentoCorrigido);

            const unique_key = `${modelo}|${aro}|${pcd}|${offset}|${acabamento}`;

            //if (index < 5) {
            //    console.log(`[DEBUG ENTRADA ${index}] Key Aro (Corrigido): ${aro} | Key Completa: ${unique_key}`);
            //}

            return {
                modelo: modelo,

                aro: aro,

                pcd: pcd,

                offset: offset,

                acabamento: acabamento,

                sku: normalizeString(roda.SKU),

                qtde_sp: roda.QTDE_SP,

                qtde_sc: roda.QTDE_SC,

                // Chave única normalizada para ser usada na comparação
                unique_key: unique_key
            };
        });
        
        // 2. PRÉ-VERIFICAÇÃO: Identifica quais rodas já existem no DB.
        const chavesParaVerificar = registrosParaUpsert.map(r => r.unique_key);
        
        // Monta a condição OR para buscar todas as chaves de entrada no DB
        const orConditions = chavesParaVerificar.map(key => {

            const [modelo, aro, pcd, offset, acabamento] = key.split('|');

            return {
                [Op.and]: { 
                    // Normaliza os dados do DB (TRIM e LOWER) para comparação
                    modelo: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('modelo'))), modelo),

                    aro: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('aro'))), aro),

                    pcd: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('pcd'))), pcd),

                    offset: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('offset'))), offset),

                    acabamento: sequelize.where(sequelize.fn('LOWER', sequelize.fn('TRIM', sequelize.col('acabamento'))), acabamento),

                }
            };
        });

        // Consulta o DB para encontrar todas as rodas existentes
        const rodasExistentes = await Estoque.findAll({

            attributes: uniqueFields,

            where: {
                [Op.or]: orConditions 
            },

            transaction: transaction,

            raw: true

        });

        //console.log(`\n[DEBUG 2] Total de rodas retornadas pelo DB: ${rodasExistentes.length}`);

        
        // Converte as rodas existentes em um Set de chaves únicas normalizadas
        const chavesExistentesSet = new Set(

            rodasExistentes.map((r, index) => {

                const dbKey = `${normalizeString(r.modelo)}|${normalizeString(r.aro)}|${normalizeString(r.pcd)}|${normalizeString(r.offset)}|${normalizeString(r.acabamento)}`;
                
                // DEBUG 3: Loga as primeiras chaves do DB para comparação
                //if (index < 5) {
                //    console.log(`[DEBUG SAÍDA ${index}] Key DB: ${dbKey}`);
                //}

                return dbKey;
            })
        );
        
        // 3. IDENTIFICAÇÃO DOS NOVOS MODELOS
        let novosModelos = 0;
        
        registrosParaUpsert.filter(registro => {

            const key = registro.unique_key;

            if (!chavesExistentesSet.has(key)) {

                // Mantém o formato de log solicitado
                //console.log(`\n[MODELO NOVO DETECTADO] Inserindo: ${registro.modelo} ${registro.aro} ${registro.pcd} ${registro.offset} ${registro.acabamento}`);
                novosModelos++;
                return true;

            }

            return false;
        });
        
        // 4. ZERAR O ESTOQUE ANTIGO
        console.log('Zerando o estoque antes da atualização...');

        await Estoque.update(

            { qtde_sp: 0, qtde_sc: 0 },

            { where: {}, transaction: transaction }

        );

        console.log('Estoque zerado com sucesso.');

        // 5. UPSERT EM LOTE
        await Estoque.bulkCreate(registrosParaUpsert, {

            updateOnDuplicate: [
                ...uniqueFields,

                'qtde_sp',

                'qtde_sc'
            ],
            transaction: transaction,
            //order: [['modelo', 'ASC']],
            returning: true 
        });
        
        await transaction.commit();
        
        rodasProcessadas = registrosParaUpsert.length;

        const modelosAtualizados = rodasProcessadas - novosModelos;

        console.log(`\n--- SINCRONIZAÇÃO CONCLUÍDA ---`);
        console.log(`Modelos no arquivo: ${rodasProcessadas}`);
        console.log(`Novos modelos adicionados: ${novosModelos}`);
        console.log(`Modelos atualizados: ${modelosAtualizados}`); 
        console.log(`Estoque sincronizado por chave composta!`);

    } catch (error) {
        await transaction.rollback(); 
        console.error('Erro fatal ao sincronizar o estoque:', error);
        throw error;
    }
};


// =====================================================================


const getRoda = async (detalhesAnuncio) => {
    let quantidadeTotal;
    try{
        console.log("Capturando detalhes de estoque...")
        let skuRodas = [];
        let quantidadesDisponiveis = [];

        for(const detalheAnuncio of detalhesAnuncio){
        
            skuRodas.push(detalheAnuncio.sku)
        
        }
        

        for(const skuRoda of skuRodas){

            let roda = await Estoque.findOne({
               where: {
                   sku: skuRoda
               },
                raw: true
            })

            if(roda){
                quantidadeTotal = roda.qtde_sp + roda.qtde_sc;

                
            } else {
                quantidadeTotal = null
                console.warn(`[ESTOQUE] Não há sku correspondente no estoque da distribuidora para o SKU: ${skuRoda}`);
                return [];
            }
            

            quantidadesDisponiveis.push({
                sku: skuRoda, // É bom salvar o SKU para referência
                quantidade: quantidadeTotal
            });
        }


        return quantidadesDisponiveis;
    }catch(error){
        console.error("Erro ao coletar quantidades disponíveis", error);
        throw error; // Lança o erro para o controller
    }
}

// ========================================================

const subtrairJogoDeRoda = async (sku) => {
    // Definimos a quantidade a ser subtraída (1 jogo)
    const QUANTIDADE_A_SUBTRAIR = 4;
    
    // Usamos uma transação para garantir que a baixa seja atômica
    const transaction = await sequelize.transaction();
    
    try {
        console.log(`[BAIXA ESTOQUE] Iniciando baixa de 4 unidades para SKU: ${sku}`);

        // 1. Busca os registros para verificar o estoque atual
        const rodas = await Estoque.findAll({
            where: { sku: sku },
            transaction: transaction,
            raw: true
        });

        if (rodas.length === 0) {
            console.warn(`[BAIXA ESTOQUE] SKU '${sku}' não encontrado na tabela de estoque. Nenhuma baixa realizada.`);
            await transaction.rollback();
            return;
        }

        // Assumimos que o SKU só tem uma entrada no DB, mas usamos o for para iterar sobre o array
        for (const roda of rodas) {
            
            const estoqueAtualTotal = roda.qtde_sp + roda.qtde_sc;
            
            if (estoqueAtualTotal < QUANTIDADE_A_SUBTRAIR) {
                 console.warn(`[BAIXA ESTOQUE] Estoque insuficiente (${estoqueAtualTotal} unid.) para a baixa de ${QUANTIDADE_A_SUBTRAIR} unid. para SKU: ${sku}.`);
                 // Não lançamos erro, mas pulamos a baixa
                 continue; 
            }
            
            // Variáveis que guardarão as novas quantidades
            let novaQtdeSP = roda.qtde_sp;
            let novaQtdeSC = roda.qtde_sc;
            
            // --- LÓGICA DE PRIORIZAÇÃO DA BAIXA ---
            
            if (roda.qtde_sp >= QUANTIDADE_A_SUBTRAIR) {
                // REGRA 1: qtde_sp >= 4 -> Diminui 4 unidades de SP.
                console.log(`[BAIXA ESTOQUE] Baixando 4 unidades do estoque SP.`);
                novaQtdeSP = roda.qtde_sp - QUANTIDADE_A_SUBTRAIR;

            } else if (roda.qtde_sp > 0 && roda.qtde_sp < QUANTIDADE_A_SUBTRAIR) {
                // REGRA 2: qtde_sp entre 1 e 3 -> Baixa o que tiver em SP, e o restante de SC.
                const qtdeBaixadaSP = roda.qtde_sp;
                const qtdeFaltanteSC = QUANTIDADE_A_SUBTRAIR - qtdeBaixadaSP;
                
                // Baixa de SP
                novaQtdeSP = 0;
                
                // Baixa de SC (garantido que qtdeFaltanteSC é > 0 e <= 4)
                novaQtdeSC = roda.qtde_sc - qtdeFaltanteSC;
                
                console.log(`[BAIXA ESTOQUE] Usando ${qtdeBaixadaSP} unid. de SP e ${qtdeFaltanteSC} unid. de SC.`);

            } else if (roda.qtde_sp === 0) {
                // REGRA 3: qtde_sp = 0 -> Baixar as 4 rodas de SC.
                console.log(`[BAIXA ESTOQUE] Usando 4 unidades do estoque SC.`);
                novaQtdeSC = roda.qtde_sc - QUANTIDADE_A_SUBTRAIR;
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
        
        console.log(`[BAIXA ESTOQUE] Baixa concluída para SKU: ${sku}. 4 unidades subtraídas (se houvesse estoque).`);

    } catch (error) {
        await transaction.rollback(); // Desfaz a transação em caso de erro
        console.error(`Erro fatal durante a baixa de estoque do SKU ${sku}:`, error);
        throw error;
    }
};

// Exporta as funções para serem usadas no controller
module.exports = {
    parseTxtToWheels,
    saveStock,
    getRoda,
    subtrairJogoDeRoda
};