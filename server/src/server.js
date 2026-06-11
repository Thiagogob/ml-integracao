const express = require('express');
const path = require('path');
const logger = require('./config/logger');

// 1. CARREGAR VARIÁVEIS DE AMBIENTE

require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001; // Usa a porta do .env ou 3001 como fallback

// 2. IMPORTAR CONEXÃO E ROTAS
const { syncDb, sequelize } = require('./config/database'); 
const vendasRoutes = require('./routes/vendas.routes');
const stockRoutes = require('./routes/stock.routes');
const anunciosRoutes = require('./routes/anuncios.routes');
const authRoutes = require('./routes/auth.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const { startSalesScheduler } = require('./scheduling/salesScheduler');

// 3. CONFIGURAR MIDDLEWARES
app.use(express.json()); 
// 4. LIGAR AS ROTAS
app.use('/api/vendas', vendasRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/anuncios', anunciosRoutes);
app.use('/api/login', authRoutes)
app.use('/api/dashboard', dashboardRoutes);

// 5. INICIAR APLICAÇÃO: CONEXÃO DB E SERVIDOR
let server;

const startServer = async () => {
    try {
        await syncDb();
        
        // Inicia o servidor Express
        server = app.listen(PORT, () => {
            logger.info({ port: PORT }, 'servidor iniciado');
            startSalesScheduler();
        });

    } catch (error) {
        logger.error({ err: error }, 'falha ao iniciar a aplicacao');
        process.exit(1);
    }
};

startServer();

// GERENCIAMENTO DE DESLIGAMENTO 
process.on('SIGINT', () => {
    logger.info('SIGINT recebido, encerrando servidor');

    server.close(async () => {
        logger.info('servidor Express fechado');

        await sequelize.close()
            .then(() => {
                logger.info('conexao com banco fechada, encerrando processo');
                process.exit(0);
            })
            .catch((err) => {
                logger.error({ err }, 'erro ao fechar conexao do Sequelize');
                process.exit(1);
            });
    });
});