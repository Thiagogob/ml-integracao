const { Venda, Estoque, Anuncio} = require('../config/database');
const { Sequelize } = require('sequelize');
const syncControlService = require('./syncControl.service');
const meliService = require('./meli.service');
const { listarVendas } = require('../controllers/VendasController');

//const salvarVendas = async (vendas) => {
//    let vendasSalvas = 0;
//    try{
//        console.log("Iniciando o salvamento de vendas no banco de dados...");
//
//    for (const venda of vendas) {
//        
//
//                            
//            await Venda.create({
//                    data: venda.date_closed,
//                    id_venda: venda.id, 
//                    id_ml: venda.order_items[0].item.id,
//                    sku: venda.order_items[0].item.seller_sku,
//                    valor: venda.order_items[0].unit_price,
//                    comissao: venda.order_items[0].sale_fee,
//                    quantidade: venda.order_items[0].requested_quantity.value
//                });
//
//             vendasSalvas++;
//
//
//        
//    }
//    console.log(`Dados de ${vendasSalvas} vendas salvas no banco de dados.`);
//    } catch(error){
//         console.error('Erro ao salvar as vendas:', error);
//            throw error; // Lança o erro para que o controller o capture
//    }
//        
//};

const marcarComoColetada = async (idVenda) => {
    try {
            const [updatedRows] = await Venda.update({
                coletada: true
            }, {
                where: {
                    id_venda: idVenda
                }
            });

            if (updatedRows === 0) {
                throw new Error(`Venda com ID ${idVenda} não encontrada.`);
            }

            return { success: true, message: `Venda ${idVenda} marcada como coletada.` };
        } catch (error) {
            console.error(`[VendasService] Erro ao marcar venda ${idVenda} como coletada:`, error.message);
            throw new Error(`Falha ao atualizar status de coleta: ${error.message}`);
        }
}


const listarTodasAsVendas = async () => {
        try {
            // Buscando todas as vendas, ordenadas pela data mais recente.
            // Aqui é onde você pode adicionar paginação, filtros e includes (se necessário).
            const vendas = await Venda.findAll({
            
            where: {
                    coletada: false,
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
            console.error('[VendaService] Erro ao listar vendas:', error);
            // Propaga o erro para que o Controller possa lidar com a resposta HTTP
            throw new Error('Falha na consulta ao banco de dados.'); 
        }
}


const preencherDisponibilidade = async (idVenda, sku, quantidadeNecessaria) => {

        let novoStatus = 'pendencia'; // Assume pendência como default
        
        try {
            // 1. Acesso ao Estoque da Roda
            const estoque = await Estoque.findOne({
                attributes: ['qtde_sp', 'qtde_sc'],
                where: { sku: sku }
            });

            if (!estoque) {
                // Se o SKU não for encontrado no estoque (algo errado), mantém "pendência"
                console.warn(`[VendasService] SKU ${sku} não encontrado na tabela Estoque. Marcando como 'pendência'.`);
                novoStatus = 'pendencia';
            } else {
                const qtdeSP = estoque.qtde_sp;
                const qtdeSC = estoque.qtde_sc;
                const qtdeTotal = qtdeSP + qtdeSC;
                
                // 2. Lógica de Verificação de Estoque
                
                if (qtdeSP >= quantidadeNecessaria) {
                    // 1. Pronta Entrega (em SP)
                    novoStatus = 'campinas'; // Usamos o ENUM 'pronta entrega' definido no DB
                
                } else if (qtdeTotal >= quantidadeNecessaria) {
                    // 2. Complementar ou Totalmente do Sul
                    novoStatus = 'sul';
                
                } else {
                    // 3. Estoque Insuficiente (total)
                    novoStatus = 'pendência';
                }
            }
            
            // 3. Atualiza o Status no Banco de Dados
            await Venda.update({
                disponibilidade: novoStatus
            }, {
                where: { id_venda: idVenda }
            });

        } catch (error) {
            console.error(`[VendasService] Erro fatal ao preencher disponibilidade para Venda ${idVenda}:`, error.message);
            // Loga o erro, mas permite que o Scheduler continue
        }
}




const salvarVendas = async (vendas) => {
    try{
        console.log("Iniciando o salvamento de vendas no banco de dados...");
        let registrosParaInserir = [];
    for (const venda of vendas) {
        

                            
            registrosParaInserir.push({
                    data: venda.date_closed,
                    id_venda: venda.id, 
                    id_ml: venda.order_items[0].item.id,
                    sku: venda.order_items[0].item.seller_sku,
                    valor: venda.order_items[0].unit_price,
                    comissao: venda.order_items[0].sale_fee,
                    quantidade: venda.order_items[0].requested_quantity.value
                });



        
    }

    if (registrosParaInserir.length > 0) {
            
            // O PostgreSQL tentará inserir todos. Se houver violação de unicidade (id_venda), 
            // ele simplesmente ignora a linha e continua.
            const novosRegistros = await Venda.bulkCreate(registrosParaInserir, {
                ignoreDuplicates: true,
                returning: false // Não precisamos que ele retorne os objetos criados
            });
            
            const vendasSalvas = novosRegistros.length;

            console.log(`Dados de ${vendasSalvas} novas vendas salvas no banco de dados.`);
            
        } else {
            console.log("Nenhuma venda para processar.");
        }
    } catch(error){
         console.error('Erro ao salvar as vendas:', error);
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

        console.error(`Erro ao buscar vendas do anúncio ${id_anuncio}:`, error);

        throw error

    }
}


/**
 * Função principal do scheduler: Busca novas vendas, filtra e salva.
 * @param {string} accessToken Token de acesso do ML.
 * @returns {Promise<Array<string>>} Array de SKUs únicos vendidos a serem processados.
 */
const syncVendas = async (accessToken) => {
    
    // 1. OBTENÇÃO DO CHECKPOINT
    const lastSyncDateISO = await syncControlService.getCheckpoint();
    const lastSyncDate = lastSyncDateISO ? new Date(lastSyncDateISO) : null;

    // 2. BUSCA TODAS AS VENDAS DE HOJE (via meliService)
    const vendasDoDia = await meliService.getVendas(accessToken);
    
    let vendasNovas = vendasDoDia.results;

    if (lastSyncDate) {
        // 3. FILTRAGEM: Mantém apenas as vendas com data posterior ao checkpoint
        vendasNovas = vendasNovas.filter(venda => {
            const vendaClosedDate = new Date(venda.date_closed);
            // Compara a data de fechamento da venda com a data do último checkpoint
            return vendaClosedDate > lastSyncDate;
        });
    }

    //if (vendasNovas.length === 0) {
    //    return [];
    //}
    //
    //await salvarVendas(vendasNovas);



    

    if (vendasNovas.length === 0) {
        return [];
    }

    // 4. SALVAMENTO NO DB
    await salvarVendas(vendasNovas);

    const vendaMaisRecente = vendasNovas.reduce((latest, current) => {
        const latestDate = new Date(latest.date_closed);
        const currentDate = new Date(current.date_closed);
        return currentDate > latestDate ? current : latest;
    }, vendasNovas[0]);


    await syncControlService.updateCheckpoint(vendaMaisRecente.date_closed);

    const skusEAnunciosVendidos = vendasNovas.flatMap(venda => 
        venda.order_items.map(item => ({

            sku: item.item.seller_sku,

            ml_id: item.item.id,

            quantidade: item.requested_quantity.value,

            id_venda: venda.id,

        }))
    );

    return skusEAnunciosVendidos;
};


module.exports = {
  salvarVendas,
  getVendasFromDatabase,
  syncVendas,
  listarTodasAsVendas,
  preencherDisponibilidade,
  marcarComoColetada
};

//const { Venda } = require('../config/database'); 
//
//const salvarVendas = async (vendas) => {
//    try {
//        console.log("Iniciando o salvamento de vendas no banco de dados...");
//
//        let registrosParaInserir = [];
//
//        // 1. Prepara a lista de registros para inserção em lote
//        for (const venda of vendas) {
//            
//            // Assumimos que o SKU e outros detalhes estão no primeiro item do pedido
//            if (venda.order_items && venda.order_items.length > 0) {
//                const itemVendido = venda.order_items[0];
//
//                // Mapeia para o formato do Modelo Venda
//                registrosParaInserir.push({
//                    data: venda.date_closed,
//                    id_venda: venda.id, // ID do pedido (UNIQUE)
//                    id_ml: itemVendido.item.id, // ID do item/anúncio do ML
//                    sku: itemVendido.item.seller_sku,
//                    valor: itemVendido.unit_price,
//                    comissao: itemVendido.sale_fee,
//                    quantidade: itemVendido.requested_quantity.value
//                });
//            }
//        }
//        
//        // 2. Execução em Lote com `ignoreDuplicates`
//        if (registrosParaInserir.length > 0) {
//            
//            // O PostgreSQL tentará inserir todos. Se houver violação de unicidade (id_venda), 
//            // ele simplesmente ignora a linha e continua.
//            const novosRegistros = await Venda.bulkCreate(registrosParaInserir, {
//                ignoreDuplicates: true,
//                returning: false // Não precisamos que ele retorne os objetos criados
//            });
//            
//            const vendasSalvas = novosRegistros.length;
//            console.log(`Dados de ${vendasSalvas} novas vendas salvas no banco de dados.`);
//            
//        } else {
//            console.log("Nenhuma venda para processar.");
//        }
//
//    } catch (error) {
//        console.error('Erro fatal ao salvar as vendas:', error);
//        throw error; // Lança o erro para que o scheduler o capture
//    }
//};