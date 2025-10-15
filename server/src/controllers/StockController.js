const fs = require('fs');
const pdfService = require('../services/pdf.service');
const stockService = require('../services/stock.service');

exports.uploadStockController = async (req, res) => {
    // A propriedade `req.file` é adicionada pelo middleware multer
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    try {
        const fileBuffer = fs.readFileSync(req.file.path);
        
        // 1. Delega a tarefa de processar o PDF para o serviço
        const cleanText = await pdfService.parsePdf(fileBuffer);
        
        // 2. Delega a tarefa de transformar o texto em um objeto
        const rodas = stockService.parseTxtToWheels(cleanText);

        // 3. Salva os dados no banco de dados (também é uma tarefa do serviço)
        await stockService.saveStock(rodas);

        // 4. Envia a resposta final para o cliente
        return res.json({ message: "Estoque processado e salvo com sucesso!"});

    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Falha ao processar o arquivo.' });
    }
};