const { Anuncio, Estoque, SyncControl, sequelize } = require('../config/database');

/**
 * Busca dados de resumo e métricas chave para o dashboard.
 * @returns {Promise<Object>} Dados resumidos: { totalAnuncios, totalRodasEmEstoque, ultimaSincronizacao }
 */
const getSummaryData = async () => {
    try {
        // 1. Total de Anúncios (Contagem simples de SKUs/Variações)
        const totalAnuncios = await Anuncio.count({
            distinct: true,
            col: 'sku'
        });

        // 2. Total de Estoque (Soma das colunas qtde_sp e qtde_sc em uma única query)
        const estoqueResult = await Estoque.findOne({
            attributes: [
                // Usa funções do Sequelize (PostgreSQL) para somar as colunas
                [sequelize.fn('SUM', sequelize.col('qtde_sp')), 'total_sp'],
                [sequelize.fn('SUM', sequelize.col('qtde_sc')), 'total_sc']
            ],
            raw: true
        });
        
        // Calcula a soma total (garantindo que seja um número)
        const totalRodas = (parseInt(estoqueResult?.total_sp) || 0) + (parseInt(estoqueResult?.total_sc) || 0);

        // 3. Última Sincronização de Vendas (Checkpoint)
        const syncRecord = await SyncControl.findByPk('last_sale_sync', { raw: true });
        
        // O valor será 'N/A' se não houver um checkpoint salvo
        const ultimaSincronizacao = syncRecord?.last_timestamp || 'N/A';

        return {
            totalAnuncios: totalAnuncios,
            totalRodasEmEstoque: totalRodas,
            // Retorna o timestamp em formato ISO para o Frontend formatar
            ultimaSincronizacao: ultimaSincronizacao
        };

    } catch (error) {
        console.error("Erro no serviço de dashboard:", error);
        throw new Error('Falha ao buscar dados de resumo do DB.');
    }
};

module.exports = {getSummaryData}