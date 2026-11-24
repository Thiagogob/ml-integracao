const { Venda, Estoque, Anuncio, sequelize } = require('../config/database');
const logger = require('../config/logger');
const { Sequelize } = require('sequelize');
const syncControlService = require('./syncControl.service');
const meliService = require('./meli.service');
const { listarVendas } = require('../controllers/VendasController');
const { Op, fn, col, literal, QueryTypes } = require('sequelize');
const STORE_ID = parseInt(process.env.STORE_ID, 10);


// idVendaItem é o id (PK) da linha em vendas_ml: um pedido com vários itens tem várias linhas,
// e cada item é coletado separadamente
const marcarComoColetada = async (idVendaItem) => {
    try {
            const [updatedRows] = await Venda.update({
                coletada: true
            }, {
                where: {
                    id: idVendaItem,
                    store_id: STORE_ID
                }
            });

            if (updatedRows === 0) {
                throw new Error(`Venda com ID ${idVendaItem} não encontrada.`);
            }

            return { success: true, message: `Venda ${idVendaItem} marcada como coletada.` };
        } catch (error) {
            logger.error({ err: error, idVendaItem }, 'erro ao marcar venda como coletada');
            throw new Error(`Falha ao atualizar status de coleta: ${error.message}`);
        }
}




const getTop5RodasVendidas = async () => {
    const quinzeDiasAtras = new Date();
        quinzeDiasAtras.setDate(quinzeDiasAtras.getDate() - 15);
        
        try {
            const topVendas = await Venda.findAll({
                attributes: [
                    // Agrega e soma a quantidade vendida
                    ['sku', 'sku'],
                    [fn('SUM', col('quantidade')), 'total_vendido']
                ],

                include: [{
                    model: Estoque,
                    as: 'estoque_associado', // Use o alias definido no database.js
                    attributes: [],          // Não precisamos das colunas do Estoque
                    required: true           // FORÇA INNER JOIN: Filtra SÓ SKUs que estão no Estoque
                }],

                where: {
                    store_id: STORE_ID,
                    status: 'paid',
                    data: {
                        [Op.gte]: quinzeDiasAtras.toISOString()
                    }
                },
                group: ['Venda.sku', 'estoque_associado.id'],
                order: [[literal('total_vendido'), 'DESC']], // Ordena pela maior quantidade
                limit: 5, // Limita aos 5 primeiros
                raw: true, // Retorna objetos JSON simples para fácil mapeamento
            });
            
            // Mapeamento opcional para garantir que 'total_vendido' seja um número inteiro
            return topVendas.map(item => ({
                sku: item.sku,
                total_vendido: parseInt(item.total_vendido, 10) // Converte para número
            }));

        } catch (error) {
            logger.error({ err: error }, 'erro ao buscar top 5 vendas');
            throw new Error('Falha ao calcular o Top 5 de vendas.');
        }
}


const getRodasAtencao = async () => {
    const quinzeDiasAtras = new Date();
        quinzeDiasAtras.setDate(quinzeDiasAtras.getDate() - 15);
        
        try {
            
const indiceAtencaoLiteral = literal(`
    COALESCE(
        CAST(SUM("Venda"."quantidade") AS NUMERIC) 
        / NULLIF(("estoque_associado"."qtde_sp" + "estoque_associado"."qtde_sc" + "estoque_associado"."qtde_pr"), 0), 
        0
    )
`);
            
            const topAtencao = await Venda.findAll({
                attributes: [
                    ['sku', 'sku'],
                    [fn('SUM', col('quantidade')), 'total_pedidos_15dias'], // Contagem de pedidos (venda.quantidade)
                    [col('estoque_associado.qtde_sp'), 'qtde_sp_atual'],
                    [col('estoque_associado.qtde_sc'), 'qtde_sc_atual'],
                    [col('estoque_associado.qtde_pr'), 'qtde_pr_atual'],
                    [indiceAtencaoLiteral, 'indice_atencao'] // O resultado da divisão
                ],
                
                // Filtro 1: Apenas Rodas (INNER JOIN com Estoque)
                include: [{
                    model: Estoque,
                    as: 'estoque_associado', 
                    attributes: [],          
                    required: true           
                }],
                
                where: {
                    store_id: STORE_ID,
                    status: 'paid',
                    data: {
                        [Op.gte]: quinzeDiasAtras.toISOString()
                    }
                },
                
                // Agrupamos por SKU e pelas quantidades de Estoque (que são estáticas para o SKU)
                group: [
                    'Venda.sku', 
                    'estoque_associado.id',
                    'estoque_associado.qtde_sp',
                    'estoque_associado.qtde_sc',
                    'estoque_associado.qtde_pr',
                    'Venda.sku'
                ],
                
                order: [
                    // 1. Primário: Ordenar pelo Índice de Risco (Maior -> Menor)
                    [literal('indice_atencao'), 'DESC'], 
                    
                    // 2. Secundário: Ordenar pelo Total de Pedidos (Maior -> Menor)
                    [literal('total_pedidos_15dias'), 'DESC'] 
                ], 
                limit: 15, 
                raw: true, 
            });
            
            // Mapeamento para garantir que o índice seja um float e limitar casas decimais
            return topAtencao.map(item => ({
                sku: item.sku,
                total_pedidos_15dias: parseInt(item.total_pedidos_15dias, 10),
                qtde_estoque_total: (item.qtde_sp_atual || 0) + (item.qtde_sc_atual || 0) + (item.qtde_pr_atual || 0),
                indice_atencao: parseFloat(item.indice_atencao).toFixed(2) // 2 casas decimais
            }));

        } catch (error) {
            logger.error({ err: error }, 'erro ao buscar rodas de atencao');
            throw new Error('Falha ao calcular o Índice de Risco de Estoque.');
        }
    }





const listarTodasAsVendas = async () => {
        try {
            // Buscando todas as vendas, ordenadas pela data mais recente.
            // Aqui é onde você pode adicionar paginação, filtros e includes (se necessário).
            const vendas = await Venda.findAll({
            
            where: {
                    store_id: STORE_ID,
                    coletada: false,
                    status: 'paid',
                },
            attributes: [
                'id', // PK para debug/chave única no React
                ['id_venda', 'id_venda'],
                ['data', 'data'], 
                ['id_ml', 'id_ml'],
                ['sku', 'sku'],
                ['valor', 'valor'],
                ['comissao', 'comissao'],
                ['quantidade', 'quantidade'],
                ['disponibilidade', 'disponibilidade'],
                [
                    Sequelize.literal(`(
                        SELECT "Anuncio"."isUnitario" 
                        FROM "anuncios" AS "Anuncio" 
                        WHERE "Anuncio"."ml_id" = "Venda"."id_ml" -- LIGAÇÃO PELA ID ML
                        LIMIT 1
                    )`),
                    'isUnitario' // Alias para ser acessado no mapeamento
                ],
            ],

                include: [
                    {
                    model: Estoque, 
                    as: 'estoque_associado', // DEVE SER O MESMO NOME 'as' definido no database.js!
                    attributes: ['qtde_sp', 'qtde_sc'], // Opcional: Não precisamos das colunas do Estoque no resultado final
                    required: true, // ESTE é o filtro: Força o INNER JOIN
                    }
                ],
                order: [['data', 'DESC']], // Vendas mais recentes primeiro
                limit: 50, // Adicione um limite por padrão para evitar consultas gigantes
            });

            return vendas.map(venda => {
                const vendaData = venda.toJSON(); // Converte a instância Sequelize para objeto JS plano
                
                const isUnitario = vendaData.isUnitario;

                let quantidadeRealParaDespachar = 1;


                // Se for isUnitario, a quantidade é a própria quantidadePedido
                if (isUnitario === false) { 
                // Se NÃO é unitário, deve ser jogo/kit. 
                // Usamos 4 como fallback se a coluna do anúncio estiver vazia.
                
                quantidadeRealParaDespachar = 4;
                }

                return {
                    id: vendaData.id, // identifica o item (um pedido pode ter vários)
                    id_venda: vendaData.id_venda,
                    data_venda: vendaData.data_venda,
                    id_ml: vendaData.id_ml,
                    sku: vendaData.sku,
                    valor: vendaData.valor,
                    comissao: vendaData.comissao,
                    quantidade: quantidadeRealParaDespachar,
                    
                    // Adiciona os dados do estoque no nível superior
                    qtde_sp: vendaData.estoque_associado.qtde_sp,
                    qtde_sc: vendaData.estoque_associado.qtde_sc,


                    disponibilidade: vendaData.disponibilidade,
                    // Poderíamos adicionar um campo de status temporário aqui se quiséssemos
                    // status_despache: 'pendente' 
                };
            }); // Retorna um array de instâncias Venda (que o Express converte para JSON)

        } catch (error) {
            logger.error({ err: error }, 'erro ao listar vendas');
            // Propaga o erro para que o Controller possa lidar com a resposta HTTP
            throw new Error('Falha na consulta ao banco de dados.'); 
        }
}


const preencherDisponibilidade = async (idVenda, sku, quantidadeNecessaria, itemSeq = 0) => {

        let novoStatus = 'pendencia'; // Assume pendência como default
        
        try {
            // 1. Acesso ao Estoque da Roda
            const estoque = await Estoque.findOne({
                attributes: ['qtde_sp', 'qtde_sc', 'qtde_pr'],
                where: { sku: sku }
            });

            if (!estoque) {
                // Se o SKU não for encontrado no estoque (algo errado), mantém "pendência"
                logger.warn({ sku }, 'SKU nao encontrado no estoque, marcando como pendencia');
                novoStatus = 'pendencia';
            } else {
                const qtdeSP = estoque.qtde_sp;
                const qtdeSC = estoque.qtde_sc;
                const qtdePR = estoque.qtde_pr;

                const qtdeTotal = qtdeSP + qtdeSC + qtdePR;
                
                // 2. Lógica de Verificação de Estoque
                
                if (qtdeSP >= quantidadeNecessaria) {
                    // 1. Pronta Entrega (em SP)
                    novoStatus = 'campinas'; // Usamos o ENUM 'pronta entrega' definido no DB
                
                } else if (qtdeTotal >= quantidadeNecessaria) {
                    // 2. Complementar ou Totalmente do Sul
                    novoStatus = 'sul';
                
                } else {
                    // 3. Estoque Insuficiente (total)
                    novoStatus = 'pendencia';
                }
            }
            
            // 3. Atualiza o Status no Banco de Dados
            await Venda.update({
                disponibilidade: novoStatus
            }, {
                where: { id_venda: String(idVenda), item_seq: itemSeq }
            });

        } catch (error) {
            logger.error({ err: error, idVenda }, 'erro ao preencher disponibilidade');
            // Loga o erro, mas permite que o Scheduler continue
        }
}




const salvarVendas = async (vendas) => {
    try{
        logger.info('iniciando salvamento de vendas');
        let registrosParaInserir = [];
    // Uma linha por item: antes só o order_items[0] era gravado, e os demais itens de um
    // carrinho com várias rodas sumiam da coleta e das métricas
    for (const venda of vendas) {
        venda.order_items.forEach((item, itemSeq) => {
            registrosParaInserir.push({
                    data: venda.date_closed,
                    id_venda: String(venda.id),
                    item_seq: itemSeq,
                    id_ml: item.item.id,
                    sku: item.item.seller_sku,
                    valor: item.unit_price,
                    comissao: item.sale_fee,
                    quantidade: item.requested_quantity.value,
                    store_id: STORE_ID
                });
        });
    }

    if (registrosParaInserir.length > 0) {
            
            // O PostgreSQL tentará inserir todos. Se houver violação de unicidade (id_venda, item_seq), 
            // ele simplesmente ignora a linha e continua.
            const novosRegistros = await Venda.bulkCreate(registrosParaInserir, {
                ignoreDuplicates: true,
                returning: false // Não precisamos que ele retorne os objetos criados
            });
            
            const vendasSalvas = novosRegistros.length;

            logger.info({ vendasSalvas }, 'novas vendas salvas');
            
        } else {
            logger.info('nenhuma venda nova para processar');
        }
    } catch(error){
         logger.error({ err: error }, 'erro ao salvar vendas');
            throw error; // Lança o erro para que o controller o capture
    }
        
};

const getVendasFromDatabase = async () => {

try {
        const vendas = await Venda.findAll({

            raw: true

         });

        return vendas;

    } catch (error) {

        logger.error({ err: error }, 'erro ao buscar vendas do banco');

        throw error

    }
}


/**
 * Função principal do scheduler: Busca novas vendas, filtra e salva.
 * @param {string} accessToken Token de acesso do ML.
 * @returns {Promise<Array<string>>} Array de SKUs únicos vendidos a serem processados.
 */
const syncVendas = async (accessToken) => {

    // 1. BUSCA AS VENDAS PAGAS ATUALIZADAS NA JANELA RECENTE (via meliService)
    const resultados = (await meliService.getVendas(accessToken)).results;

    // A paginação por offset pode devolver o mesmo pedido em duas páginas se a lista mudar
    // durante a busca; sem deduplicar, a venda daria baixa duas vezes
    const vendasRecentes = [...new Map(resultados.map(venda => [String(venda.id), venda])).values()];

    if (vendasRecentes.length === 0) {
        return [];
    }

    // 2. FILTRAGEM: novas são as que ainda não estão no banco. Não usamos mais o checkpoint
    // de data para isso: pedidos que aparecem na API com atraso (ou pagos dias depois de
    // criados) ficavam com data anterior ao checkpoint e eram descartados para sempre.
    const idsRecentes = vendasRecentes.map(venda => String(venda.id));
    const jaSalvas = await Venda.findAll({
        attributes: ['id_venda'],
        where: { id_venda: { [Op.in]: idsRecentes } },
        raw: true
    });
    const idsJaSalvos = new Set(jaSalvas.map(venda => venda.id_venda));

    const vendasNovas = vendasRecentes.filter(venda => !idsJaSalvos.has(String(venda.id)));

    if (vendasNovas.length === 0) {
        return [];
    }

    // 3. SALVAMENTO NO DB
    await salvarVendas(vendasNovas);

    // O checkpoint não filtra mais nada; fica só como registro da última venda processada
    const vendaMaisRecente = vendasNovas.reduce((latest, current) => {
        const latestDate = new Date(latest.date_closed);
        const currentDate = new Date(current.date_closed);
        return currentDate > latestDate ? current : latest;
    }, vendasNovas[0]);

    await syncControlService.updateCheckpoint(vendaMaisRecente.date_closed);

    const skusEAnunciosVendidos = vendasNovas.flatMap(venda => 
        venda.order_items.map((item, itemSeq) => ({

            item_seq: itemSeq,

            sku: item.item.seller_sku,

            ml_id: item.item.id,

            quantidade: item.requested_quantity.value,

            id_venda: venda.id,

        }))
    );

    return skusEAnunciosVendidos;
};


// Pedidos pagos que foram cancelados depois: marca as linhas como 'cancelled' para saírem
// do card, do top 5, da atenção e da coleta. O estoque NÃO é devolvido automaticamente.
const marcarPedidosCancelados = async (accessToken) => {
    const idsCancelados = await meliService.getIdsPedidosCancelados(accessToken);

    if (idsCancelados.length === 0) {
        return 0;
    }

    const [linhasAtualizadas] = await Venda.update({ status: 'cancelled' }, {
        where: {
            store_id: STORE_ID,
            status: 'paid',
            id_venda: { [Op.in]: idsCancelados }
        }
    });

    if (linhasAtualizadas > 0) {
        logger.warn({ linhasAtualizadas }, 'vendas canceladas apos pagamento marcadas como cancelled (estoque nao devolvido)');
    }

    return linhasAtualizadas;
};

// SKUs de jogo com duas talas: não existem como linha única no estoque (ver salesScheduler)
const SKUS_DUAS_TALAS = [
    'M08ARO14675-114BD',
    'M08ARO14675-114FBD',
    'M08ARO15785-114BD',
    'M08ARO15785-114FBD',
];

// Unidades de roda vendidas hoje (dia de São Paulo), com a mesma regra de baixa do observador:
// - só vendas cujo anúncio está na tabela anuncios (sem ele o observador não dá baixa);
// - anúncio unitário vale 'quantidade' rodas; jogo vale 'quantidade' x 4;
// - só SKUs de roda (existem no estoque ou são jogos de duas talas);
// - pedidos cancelados depois de pagos não contam.
const countDailyRodasVendidas = async() => {
    try {
        const [resultado] = await sequelize.query(`
            SELECT COALESCE(SUM(
                COALESCE(v.quantidade, 1) * CASE WHEN a."isUnitario" IS TRUE THEN 1 ELSE 4 END
            ), 0) AS total
            FROM vendas_ml v
            JOIN LATERAL (
                SELECT an."isUnitario" FROM anuncios an
                WHERE an.ml_id = v.id_ml AND an.store_id = v.store_id
                LIMIT 1
            ) a ON TRUE
            WHERE v.store_id = :storeId
              AND v.status = 'paid'
              -- 'data' é TEXT com o date_closed do ML (ex.: 2026-11-24T15:32:10.000-03:00).
              -- Pré-filtro por texto (usa o índice store_id + data): de ontem a amanhã.
              AND v.data >= to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date - 1, 'YYYY-MM-DD')
              AND v.data <  to_char((now() AT TIME ZONE 'America/Sao_Paulo')::date + 2, 'YYYY-MM-DD')
              -- Dia exato em São Paulo (o servidor roda em UTC). O CASE só converte texto com
              -- formato ISO: uma linha com data inválida não pode derrubar a consulta inteira.
              AND (CASE WHEN v.data ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
                        THEN (v.data::timestamptz AT TIME ZONE 'America/Sao_Paulo')::date
                   END) = (now() AT TIME ZONE 'America/Sao_Paulo')::date
              AND (
                  v.sku IN (:skusDuasTalas)
                  OR EXISTS (SELECT 1 FROM estoque_rodas_distribuidora e WHERE e.sku = v.sku)
              )
        `, {
            replacements: { storeId: STORE_ID, skusDuasTalas: SKUS_DUAS_TALAS },
            type: QueryTypes.SELECT
        });

        return parseInt(resultado.total, 10) || 0;

    } catch (error) {
        logger.error({ err: error }, 'erro fatal na contagem de rodas vendidas');
        return 0;
    }
}


module.exports = {
  salvarVendas,
  getVendasFromDatabase,
  syncVendas,
  listarTodasAsVendas,
  preencherDisponibilidade,
  marcarComoColetada,
  getTop5RodasVendidas,
  getRodasAtencao,
  countDailyRodasVendidas,
  marcarPedidosCancelados
};

