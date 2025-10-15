const meliService = require('../services/meli.service');

exports.getVendasController = async (req, res) => {
  try {
    const resposta = await meliService.authTest();
    let resultado;

    if (resposta) {
      console.log("Token válido!");
      resultado = await meliService.getVendas(resposta);
    } else {
      console.log("Token inválido!");
      const access_token = await meliService.getAuth();
      resultado = await meliService.getVendas(access_token);
    }
    
    //essa parte pode ter ficado confusa de ler, mas é para pegar a array de vendas
    await meliService.salvarVendas(resultado.results);
    res.status(200).send("Vendas sincronizadas com sucesso!");
  } catch (error) {
    console.error("Erro ao sincronizar vendas:", error);
    res.status(500).json({ error: "Erro ao sincronizar vendas." });
  }
};