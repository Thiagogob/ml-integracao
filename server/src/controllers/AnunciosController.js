const meliService = require('../services/meli.service');
const anuncioService = require('../services/anuncios.service');
const logger = require('../config/logger');
const stockService = require('../services/stock.service');
const { run, all } = require('../config/database');



exports.getAnunciosSkusController = async (req, res) => {
    let access_token;
    try{
        const resposta = await meliService.authTest();
        if(!resposta){
            logger.info('token invalido, gerando novo token');
            access_token = await meliService.getAuth();
        }
        else{
            access_token = resposta;
        }

        const anunciosId = await meliService.getIdsAnuncios(access_token)

        
        const anuncios = await meliService.getDetalhesAnuncios(anunciosId.results, access_token)
        

        anuncioService.salvarAnuncios(anuncios);


        res.status(200).send("Anúncios Capturados com sucesso!");
    }
    catch(error){
        logger.error({ err: error }, 'erro ao capturar anuncios');
        res.status(500).json({ error: "Erro ao capturar anúncios." })    
    }

}



//

exports.putAnunciosEstoqueController = async (req, res) => {
    let access_token;
    
        try{
            const resposta = await meliService.authTest();
            if(!resposta){
                logger.info('token invalido, gerando novo token')
                access_token = await meliService.getAuth();
            }
            else{
                access_token = resposta;
            }

            let arrayTeste = ['MLB2987852728', 'MLB3334015125', 'MLB3998364581']; // recebe anúncios que tem essas rodas como produto -> m11 15 bd / m17 15 / mk7 20 5x100 / m23 bf / m25 15 4x100
            
            
            //captura infos do anúncio
            for(const anuncio of arrayTeste){
                let missingSku = false;
            
                const detalhesAnuncio = await anuncioService.getAnuncio(anuncio);
                logger.info({ detalhesAnuncio }, 'detalhes do anuncio');

            //pega as infos da roda com o sku do anuncio
                const detalhesEstoque = await stockService.getRoda(detalhesAnuncio);

                if (detalhesEstoque.length === 0) {
                    logger.info({ anuncio }, 'anuncio sem nenhum SKU de roda no estoque: ignorando atualizacao');
                    continue;
                }

                for (const detalheEstoque of detalhesEstoque){

                    if(detalheEstoque.quantidade === null){

                        missingSku = true;

                    }

                }

                if(!missingSku){

                    const updatePayload = anuncioService.generateUpdatePayload(detalhesAnuncio, detalhesEstoque)

                    await meliService.updateEstoqueAnuncio(detalhesAnuncio, access_token, updatePayload)

                }
                
            }


            res.status(200).send("Estoque do anúncio atualizado com sucesso!");
        }
        catch(error){

            logger.error({ err: error }, 'erro ao atualizar estoque do anuncio');
            res.status(500).json({ error: "Erro ao atualizar estoque do anúncio" })

        }
}