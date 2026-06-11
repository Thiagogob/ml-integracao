const meliService = require('../services/meli.service');
const vendasService = require('../services/vendas.service');
const logger = require('../config/logger');

exports.getVendasController = async (req, res) => {
  try {
    const resposta = await meliService.authTest();
    let resultado;

    if (resposta) {
      logger.info('token valido');
      resultado = await meliService.getVendas(resposta);

    } else {
      logger.info('token invalido, gerando novo token');
      const access_token = await meliService.getAuth();
      resultado = await meliService.getVendas(access_token);
    }
    
    //essa parte pode ter ficado confusa de ler, mas é para pegar a array de vendas
    await vendasService.salvarVendas(resultado.results);
    res.status(200).send("Vendas sincronizadas com sucesso!");
  } catch (error) {
    logger.error({ err: error }, 'erro ao sincronizar vendas');
    res.status(500).json({ error: "Erro ao sincronizar vendas." });
  }
};

exports.listarVendas = async (req, res) => {
  try {
            const vendas = await vendasService.listarTodasAsVendas();
            

            return res.status(200).json(vendas);

        } catch (error) {
            logger.error({ err: error }, 'erro ao listar vendas');
            

            return res.status(500).json({ 
                error: 'Falha interna do servidor', 
                details: error.message 
            });
        }

};

exports.marcarComoColetada = async (req, res) => {
        const idVenda = req.params.idVenda; // Captura o ID da rota
        
        if (!idVenda) {
            return res.status(400).json({ error: 'ID da Venda é obrigatório.' });
        }

        try {
            const result = await vendasService.marcarComoColetada(idVenda);
            return res.status(200).json(result);
        } catch (error) {
            logger.error({ err: error }, 'erro ao marcar venda como coletada');
            return res.status(500).json({ error: 'Falha ao atualizar status de coleta.', details: error.message });
        }
        
}
