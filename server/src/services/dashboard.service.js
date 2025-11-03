const { Anuncio, Estoque, SyncControl, sequelize } = require('../config/database');
const vendasService = require('../services/vendas.service');

/**
 * Busca dados de resumo e métricas chave para o dashboard.
 * @returns {Promise<Object>} Dados resumidos: { totalAnuncios, totalRodasEmEstoque, ultimaSincronizacao }
 */
const getSummaryData = async () => {
    try {
        // 1. Total de Anúncios (Contagem simples de SKUs/Variações)
        const rodasVendidasDia = await vendasService.countDailyRodasVendidas();

        // 2. Total de Estoque 
        const estoqueResult = await Estoque.findOne({
            attributes: [
                // Usa funções do Sequelize (PostgreSQL) para somar as colunas
                [sequelize.fn('SUM', sequelize.col('qtde_sp')), 'total_sp'],
                [sequelize.fn('SUM', sequelize.col('qtde_sc')), 'total_sc'],
                [sequelize.fn('SUM', sequelize.col('qtde_pr')), 'total_pr']

            ],
            raw: true
        });
        
        // Calcula a soma total (garantindo que seja um número)
        const totalRodas = (parseInt(estoqueResult?.total_sp) || 0) + (parseInt(estoqueResult?.total_sc) || 0) + (parseInt(estoqueResult?.total_pr) || 0);

        // 3. Última Sincronização de Vendas (Checkpoint)
        const syncRecord = await SyncControl.findByPk('last_sale_sync', { raw: true });
        
        // O valor será 'N/A' se não houver um checkpoint salvo
        const ultimaSincronizacao = syncRecord?.last_timestamp || 'N/A';

        const top5Vendas = await vendasService.getTop5RodasVendidas();

        const top5Atencao = await vendasService.getRodasAtencao();

        return {
            rodasVendidasDia: rodasVendidasDia,

            totalRodasEmEstoque: totalRodas,

            // Retorna o timestamp em formato ISO para o Frontend formatar
            ultimaSincronizacao: ultimaSincronizacao,

            top5Vendas: top5Vendas,

            top5Atencao: top5Atencao
        };

    } catch (error) {
        console.error("Erro no serviço de dashboard:", error);
        throw new Error('Falha ao buscar dados de resumo do DB.');
    }
};

module.exports = {getSummaryData}