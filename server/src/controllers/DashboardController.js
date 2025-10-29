const dashboardService = require('../services/dashboard.service');

exports.getDashboardSummaryController = async (req, res) => {
try {
        // 1. Chama o serviço para buscar os dados
        const data = await dashboardService.getSummaryData();
        
        // 2. Retorna os dados em JSON para o frontend
        res.json(data);
    } catch (error) {
        // Se o serviço lançar um erro, retorna 500
        res.status(500).json({ message: error.message });
    }
}