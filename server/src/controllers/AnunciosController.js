const meliService = require('../services/meli.service');
const anuncioService = require('../services/anuncios.service');
const stockService = require('../services/stock.service');
const { run, all } = require('../config/database');


//
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



//

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

            let arrayTeste = ['MLB2987852728', 'MLB3334015125', 'MLB3998364581']; // recebe anúncios que tem essas rodas como produto -> m11 15 bd / m17 15 / mk7 20 5x100 / m23 bf / m25 15 4x100
            
            
            //captura infos do anúncio
            for(const anuncio of arrayTeste){
                let missingSku = false;
            
                const detalhesAnuncio = await anuncioService.getAnuncio(anuncio);
                console.log(detalhesAnuncio);

            //pega as infos da roda com o sku do anuncio
                const detalhesEstoque = await stockService.getRoda(detalhesAnuncio);

                console.log(detalhesEstoque);

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
            //console.log(detalhesEstoque);

            //const updatePayload = anuncioService.generateUpdatePayload(detalhesAnuncio, detalhesEstoque)

            //console.log(updatePayload);

            //await meliService.updateEstoqueAnuncio(detalhesAnuncio, access_token, updatePayload)

            res.status(200).send("Estoque do anúncio atualizado com sucesso!");
        }
        catch(error){

            console.error("Erro ao atualizar estoque do anúncio:", error);
            res.status(500).json({ error: "Erro ao atualizar estoque do anúncio" })

        }
}