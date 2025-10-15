// /server/src/seed.js

const path = require('path');

// Ajusta o caminho para que ele volte uma pasta (..) e encontre o 'src'
// O caminho agora será: /server/src/config/database
const { run, db } = require(path.join(__dirname, 'src', 'config', 'database'));

// ========================= FUNÇÃO PARA INSERIR OS PRIMEIROS TOKENS MANUALMENTE =================================

// Importante: substitua pelos seus tokens de verdade
// Você pode obtê-los através do processo de autenticação do Mercado Livre.

//const inserirTokens = async () => {
//    const sql = `
//        INSERT INTO tokens_ml (id, access_token, refresh_token) 
//        VALUES (1, ?, ?)
//        ON CONFLICT(id) DO UPDATE SET
//            access_token = excluded.access_token,
//            refresh_token = excluded.refresh_token;
//    `;
//    const params = [access_token_inicial, refresh_token_inicial];
//
//    try {
//        await run(sql, params);
//        console.log('Tokens inseridos ou atualizados com sucesso no banco de dados.');
//    } catch (err) {
//        console.error('Erro ao inserir tokens:', err.message);
//    } finally {
//        // Encerra a conexão com o banco de dados quando o script terminar
//        db.close((err) => {
//            if (err) {
//                console.error('Erro ao fechar o banco de dados:', err.message);
//            } else {
//                console.log('Conexão com o banco de dados fechada.');
//            }
//        });
//    }
//};
//
//// Executa a função
//inserirTokens();

// /server/seed.js

// Sua função inserirTokens() ...
// ========================================== FUNÇÃO PARA ADICIONAR A COLUNA DE SKU =========================================================
// Nova função para adicionar a coluna 'sku'
const adicionarColunaSku = async () => {
    const sql = `
        DELETE FROM anuncios
    `;

    //ALTER TABLE estoque_rodas_distribuidora ADD COLUMN sku TEXT;

    try {
        await run(sql);
        console.log("tabela deletada");
        //console.log("Coluna 'sku' adicionada à tabela 'estoque_rodas_distribuidora'.");
    } catch (err) {
        // A mensagem de erro "duplicate column name" é esperada se a coluna já existir.
        if (err.message.includes("duplicate column name")) {
            console.warn("A coluna 'sku' já existe na tabela de estoque. Nenhuma alteração foi feita.");
        } else {
            console.error('Erro ao adicionar a coluna sku:', err.message);
            throw err;
        }
    } finally {
        // Opcional: feche a conexão aqui se esta for a única operação do script
        db.close((err) => {
            if (err) {
                console.error('Erro ao fechar o banco de dados:', err.message);
            } else {
                console.log('Conexão com o banco de dados fechada.');
            }
        });
    }
};

// Exemplo de como usar a função
adicionarColunaSku();