// /server/src/index.js

// 1. Importa o Express e a instância da sua aplicação
//const express = require('express');
//const app = express();
//const { syncDb } = require('./config/database');
//require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });
//const PORT = process.env.PORT;
//// Inicia a conexão com o banco de dados e depois o servidor Express
//syncDb().then(() => {
//    app.listen(PORT, () => {
//        console.log(`Servidor rodando em http://localhost:${PORT}`);
//    });
//});
//
//// 2. Importa as rotas
//const vendasRoutes = require('./routes/vendas.routes');
//const stockRoutes = require('./routes/stock.routes');
//const anunciosRoutes = require('./routes/anuncios.routes');
//
//// 3. Conecta ao banco de dados, importando o módulo
//// A importação já executa a lógica de conexão e criação das tabelas
//const { db } = require('./config/database');
//
//// 4. Configura os middlewares
//app.use(express.json()); // Habilita o uso de JSON no corpo das requisições
//
//// 5. Liga as rotas aos seus respectivos endpoints
//app.use('/api/vendas', vendasRoutes);
//app.use('/api/stock', stockRoutes);
//app.use('/api/anuncios', anunciosRoutes);
//
//// 6. Inicia o servidor
//
//const server = app.listen(PORT, () => {
//    console.log(`Servidor rodando em http://localhost:${PORT}`);
//});
//
//// 7. Gerencia o desligamento do servidor
//process.on('SIGINT', () => {
//    console.log('Recebido sinal de interrupção. Encerrando o servidor...');
//    server.close(() => {
//        db.close((err) => {
//            if (err) {
//                console.error('Erro ao fechar o banco de dados:', err.message);
//                process.exit(1);
//            }
//            console.log('Conexão com o banco de dados fechada. Processo encerrado.');
//            process.exit(0);
//        });
//    });
//});

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

// 3. CONFIGURAR MIDDLEWARES
app.use(express.json()); // Habilita o uso de JSON no corpo das requisições

// 4. LIGAR AS ROTAS
app.use('/api/vendas', vendasRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/anuncios', anunciosRoutes);

// 5. INICIAR APLICAÇÃO: CONEXÃO DB E SERVIDOR
let server;

const startServer = async () => {
    try {
        // Inicia a conexão e sincronização das tabelas do PostgreSQL
        await syncDb();
        
        // Inicia o servidor Express (Apenas uma vez)
        server = app.listen(PORT, () => {
            console.log(`Servidor rodando em http://localhost:${PORT}`);
        });

    } catch (error) {
        console.error('Falha ao iniciar a aplicação:', error.message);
        process.exit(1);
    }
};

startServer();

// 6. GERENCIAMENTO DE DESLIGAMENTO (CTRL+C)
// Fecha a conexão do servidor Express e do Sequelize de forma limpa
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