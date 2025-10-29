const express = require('express');
const path = require('path');

// 1. CARREGAR VARIÁVEIS DE AMBIENTE
// Deve ser o primeiro a ser carregado para que as variáveis (como PORT) estejam disponíveis
// O caminho ajustado para subir um nível (..) até /server/.env
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001; // Usa a porta do .env ou 3001 como fallback

// 2. IMPORTAR CONEXÃO E ROTAS
// Importa o módulo syncDb para iniciar a conexão com o PostgreSQL
const { syncDb, sequelize } = require('./config/database'); 
const vendasRoutes = require('./routes/vendas.routes');
const stockRoutes = require('./routes/stock.routes');
const anunciosRoutes = require('./routes/anuncios.routes');
const authRoutes = require('./routes/auth.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const { startSalesScheduler } = require('./scheduling/salesScheduler');

// 3. CONFIGURAR MIDDLEWARES
app.use(express.json()); // Habilita o uso de JSON no corpo das requisições

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
        // Inicia a conexão e sincronização das tabelas do PostgreSQL
        await syncDb();
        
        // Inicia o servidor Express
        server = app.listen(PORT, () => {
            console.log(`Servidor rodando em http://localhost:${PORT}`);
            startSalesScheduler();
        });

    } catch (error) {
        console.error('Falha ao iniciar a aplicação:', error.message);
        process.exit(1);
    }
};

startServer();

// GERENCIAMENTO DE DESLIGAMENTO 
process.on('SIGINT', () => {
    console.log('\nRecebido sinal de interrupção. Encerrando o servidor...');
    
    // Fecha o servidor Express primeiro
    server.close(async () => {
        console.log('Servidor Express fechado.');
        
        // Fecha a conexão do Sequelize (que representa a conexão PostgreSQL)
        await sequelize.close()
            .then(() => {
                console.log('Conexão com o banco de dados fechada. Processo encerrado.');
                process.exit(0);
            })
            .catch((err) => {
                console.error('Erro ao fechar a conexão do Sequelize:', err.message);
                process.exit(1);
            });
    });
});