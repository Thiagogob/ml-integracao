const fs = require('fs');
const pdfService = require('../services/pdf.service');
const stockService = require('../services/stock.service');
const meliService = require('../services/meli.service');

exports.uploadStockController = async (req, res) => {
    // A propriedade `req.file` é adicionada pelo middleware multer
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    try {

        let access_token;
            
                
        const resposta = await meliService.authTest();
        if(!resposta){
            console.log("Token Inválido. Gerando um novo...")
            access_token = await meliService.getAuth();
        }
        else{
            access_token = resposta;
        }


        const fileBuffer = fs.readFileSync(req.file.path);
        
        // 1. Delega a tarefa de processar o PDF para o serviço
        const cleanText = await pdfService.parsePdf(fileBuffer);
        
        // 2. Delega a tarefa de transformar o texto em um objeto
        const rodas = stockService.parseTxtToWheels(cleanText);

        // 3. Salva os dados no banco de dados (também é uma tarefa do serviço)
        await stockService.saveStock(rodas, access_token, meliService.processCriticalUpdates);

        // 4. Envia a resposta final para o cliente
        return res.json({ message: "Estoque processado e salvo com sucesso!"});

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Falha ao processar o arquivo.' });
    }
};


exports.uploadStockSulController = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    try {
        const fileBuffer = fs.readFileSync(req.file.path);
        
        
        // 1. Delega a tarefa de processar o PDF (texto puro)
        const cleanText = await pdfService.parsePdf(fileBuffer);
        
        

        // 2. Delega a tarefa de transformar o texto em um objeto usando o NOVO PARSER
        const rodas = stockService.parseTxtToWheelsSul(cleanText);

        

        // 3. Salva os dados na tabela TEMPORÁRIA
        await stockService.saveStockSul(rodas);


        //4. Gera correspondencia entre os codigos que se diferem no sul e SP
        await stockService.normalizeModelCodes();

        

        await stockService.mergeStockPrFromTemporary();

        // 4. Envia a resposta final
        return res.json({ message: "Estoque do Sul processado e salvo na tabela temporária para análise!"});

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Falha ao processar o arquivo de estoque do Sul.' });
    }
};

exports.getRodasPedidosPage = async (req, res) => {
    const sku = req.params.sku;

    try {
        
        const rodaDetalhes = await stockService.getRodaDetailsBySku(sku);

        if (!rodaDetalhes) {
            // Caso o SKU não seja encontrado no Estoque
            return res.status(404).json({ error: `Detalhes da roda para SKU ${sku} não encontrados.` });
        }

        return res.json(rodaDetalhes);

        
    } catch (err){
        console.error(err);
        return res.status(500).json({ error: 'Falha ao carregar detalhes das rodas para gerar pedido.' });
    }
};