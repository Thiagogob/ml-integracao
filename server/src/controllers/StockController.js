const fs = require('fs');
const path = require('path');
const logger = require('../config/logger');
const pdfService = require('../services/pdf.service');
const stockService = require('../services/stock.service');
const meliService = require('../services/meli.service');
const xlsx = require('xlsx');

const LOGS_DIR = path.join(__dirname, '../../logs');
if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });


exports.uploadStockController = async (req, res) => {
    // A propriedade `req.file` é adicionada pelo middleware multer
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    try {

        let access_token;
            
                
        const resposta = await meliService.authTest();
        if(!resposta){
            logger.info('token invalido, gerando novo token');
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
        const diagnostico = await stockService.saveStock(rodas, access_token, meliService.processCriticalUpdates);

        // 4. Persiste o relatório em disco para inspeção
        if (diagnostico) {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const logPath = path.join(LOGS_DIR, `sync-${timestamp}.json`);
            fs.writeFileSync(logPath, JSON.stringify(diagnostico, null, 2), 'utf8');
            logger.info({ logPath }, 'relatorio de sincronizacao salvo');
        }

        // 5. Envia a resposta final para o cliente
        return res.json({ message: "Estoque processado e salvo com sucesso!"});

    } catch (err) {
        logger.error({ err }, 'erro no controller de stock');
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
        logger.error({ err }, 'erro no controller de stock');
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
        logger.error({ err }, 'erro no controller de stock');
        return res.status(500).json({ error: 'Falha ao carregar detalhes das rodas para gerar pedido.' });
    }
};

exports.uploadLocalStockController = async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo enviado.' });
    }

    try {
        // 1. Lê o arquivo da memória ou do path (dependendo do seu multer)
        const workbook = xlsx.readFile(req.file.path);
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        
        // 2. Converte para JSON
        const data = xlsx.utils.sheet_to_json(sheet);

        // 3. Processa e salva no banco
        await stockService.saveLocalStock(data);

        return res.json({ message: "Estoque local processado e integrado com sucesso!" });

    } catch (err) {
        logger.error({ err }, 'erro ao processar planilha local');
        return res.status(500).json({ error: 'Falha ao processar o arquivo Excel.' });
    }
};