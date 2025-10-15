const meliService = require('../services/meli.service');
const anuncioService = require('../services/anuncios.service');
const { run, all } = require('../config/database');

exports.getAnunciosSkusController = async (req, res) => {
    let access_token;
    try{
        const resposta = await meliService.authTest();
        if(!resposta){
            console.log("Token Inválido. Gerando um novo...")
            access_token = await meliService.getAuth();
        }
        else{
            access_token = resposta;
        }

        const anunciosId = await meliService.getIdsAnuncios(access_token)

        //console.log(anunciosId)

        const anuncios = await meliService.getDetalhesAnuncios(anunciosId.results, access_token)
        //salvarAnuncios(anuncios.results);

        //anuncios.forEach(anuncio => {
        //    console.log(anuncio);
        //});
        //console.log(anuncios[0].title);
        //console.dir(anuncios, { depth: null });
        anuncioService.salvarAnuncios(anuncios);


        res.status(200).send("Anúncios Capturados com sucesso!");
    }
    catch(error){
        console.error("Erro ao capturar anúncios:", error);
        res.status(500).json({ error: "Erro ao capturar anúncios." })    
    }

}

exports.putAnunciosEstoqueController = async (req, res) => {
    let access_token;
        try{
            const resposta = await meliService.authTest();
            if(!resposta){
                console.log("Token Inválido. Gerando um novo...")
                access_token = await meliService.getAuth();
            }
            else{
                access_token = resposta;
            }

            //captura infos do anúncio
            const detalhesAnuncio = await anuncioService.getAnuncio('MLB4571602978');

            //pega as infos da roda com o sku do anuncio
            const detalhesEstoque = await stockService.getRoda(detalhesAnuncio);

            await meliService.updateEstoqueItemUnico(detalhesAnuncio, detalhesEstoque);


        }
        catch(error){

            console.error("Erro ao atualizar estoque do anúncio:", error);
            res.status(500).json({ error: "Erro ao atualizar estoque do anúncio" })

        }
}