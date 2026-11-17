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
const falhasRoutes = require('./routes/falhas.routes');
const { startSalesScheduler } = require('./scheduling/salesScheduler');
const { startAnunciosScheduler } = require('./scheduling/anunciosScheduler');
const importacoesRoutes = require('./routes/importacoes.routes');
const { obterServicoImportacoes } = require('./services/importacoes.wiring');

// 3. CONFIGURAR MIDDLEWARES
app.use(express.json()); 
// 4. LIGAR AS ROTAS
app.use('/api/vendas', vendasRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/anuncios', anunciosRoutes);
app.use('/api/login', authRoutes)
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/falhas-ml', falhasRoutes);
app.use('/api/importacoes', importacoesRoutes);

// 5. INICIAR APLICAÇÃO: CONEXÃO DB E SERVIDOR
let server;
let temporizadorReconciliacao = null;
let desligando = false;

const importacoes = obterServicoImportacoes();
const INTERVALO_RECONCILIACAO_MS = 60000;

const startServer = async () => {
    try {
        await syncDb();
        
        // Reconciliacao das importacoes antes de aceitar requisicao.
        //
        // O Railway manda SIGTERM a cada deploy e uma importacao leva de oito
        // minutos para cima: havera execucao morta no meio. Quem ficou em voo
        // com heartbeat velho passa a 'interrompida', estado honesto e
        // retomavel, em lugar de ficar eternamente como 'processando' e mentir
        // na tela do operador.
        try {
            const orfas = await importacoes.reconciliar();
            if (orfas.length > 0) {
                logger.warn({ importacoes: orfas },
                    'importacoes orfas do processo anterior marcadas como interrompidas');
            }
        } catch (erro) {
            logger.error({ err: erro }, 'falha na reconciliacao de importacoes na subida');
        }

        // Inicia o servidor Express
        server = app.listen(PORT, () => {
            logger.info({ port: PORT }, 'servidor iniciado');
            startSalesScheduler();
            startAnunciosScheduler();

            // O reconciliador tambem roda em intervalo, para o caso de a
            // execucao morrer sem o processo morrer (excecao em promessa
            // desgarrada, perda prolongada do banco).
            temporizadorReconciliacao = setInterval(() => {
                importacoes.reconciliar().catch((erro) => {
                    logger.error({ err: erro }, 'falha na reconciliacao periodica de importacoes');
                });
            }, INTERVALO_RECONCILIACAO_MS);
            temporizadorReconciliacao.unref();
        });

    } catch (error) {
        logger.error({ err: error }, 'falha ao iniciar a aplicacao');
        process.exit(1);
    }
};

startServer();

// GERENCIAMENTO DE DESLIGAMENTO
//
// Antes tratava apenas SIGINT. O Railway encerra com SIGTERM, que nao era
// tratado: uma importacao em voo morria sem deixar rastro e ficava registrada
// como 'processando' para sempre. Agora os dois sinais passam pelo mesmo
// caminho, que pede cancelamento ao que esta em voo, espera um pouco e sai.
// O que nao terminar sera marcado como interrompido pela reconciliacao da
// proxima subida.
const desligar = async (sinal) => {
    if (desligando) return;
    desligando = true;

    logger.info({ sinal }, 'sinal de encerramento recebido, desligando servidor');

    if (temporizadorReconciliacao) clearInterval(temporizadorReconciliacao);

    const encerrar = async () => {
        try {
            await importacoes.desligar({ esperaMaximaMs: 5000 });
        } catch (erro) {
            logger.error({ err: erro }, 'erro ao desligar as importacoes em voo');
        }

        try {
            await sequelize.close();
            logger.info('conexao com banco fechada, encerrando processo');
            process.exit(0);
        } catch (err) {
            logger.error({ err }, 'erro ao fechar conexao do Sequelize');
            process.exit(1);
        }
    };

    if (server) {
        server.close(() => {
            logger.info('servidor Express fechado');
            encerrar();
        });
        // Nao deixa o desligamento pendurado se alguma conexao nao fechar
        setTimeout(() => {
            logger.warn('tempo esgotado aguardando o fechamento das conexoes; encerrando');
            encerrar();
        }, 15000).unref();
    } else {
        encerrar();
    }
};

process.on('SIGINT', () => desligar('SIGINT'));
process.on('SIGTERM', () => desligar('SIGTERM'));