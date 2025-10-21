const { Venda } = require('../config/database');
const syncControlService = require('./syncControl.service');
const meliService = require('./meli.service');

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

    if (vendasNovas.length === 0) {
        return [];
    }

    await salvarVendas(vendasNovas);



    

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

            ml_id: item.item.id

        }))
    );

    return skusEAnunciosVendidos;
};


module.exports = {
  salvarVendas,
  getVendasFromDatabase,
  syncVendas
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