// /server/src/config/database.js

const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
//require('dotenv').config({ path: path.resolve(__dirname, '..', '..', '.env') });


// Configura a conexão com o banco de dados PostgreSQL
const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASSWORD,
    {
        host: process.env.DB_HOST,
        dialect: 'postgres',
        logging: false // Desabilite logs de queries para não poluir o console
    }
);

// --- 1. Definição dos Modelos ---
// Modelo para a tabela 'vendas_ml'
const Venda = sequelize.define('Venda', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    data: { type: DataTypes.TEXT },
    id_ml: { type: DataTypes.TEXT },
    sku: { type: DataTypes.TEXT },
    valor: { type: DataTypes.REAL(10, 2) },
    comissao: { type: DataTypes.REAL(10, 2) },
}, {
    tableName: 'vendas_ml',
    timestamps: false
});

// Modelo para a tabela 'estoque_rodas_distribuidora'
const Estoque = sequelize.define('Estoque', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    modelo: { type: DataTypes.TEXT },
    aro: { type: DataTypes.TEXT },
    pcd: { type: DataTypes.TEXT },
    offset: { type: DataTypes.TEXT },
    acabamento: { type: DataTypes.TEXT },
    qtde_sp: { type: DataTypes.INTEGER },
    qtde_sc: { type: DataTypes.INTEGER },
    sku: { type: DataTypes.TEXT },
}, {
    tableName: 'estoque_rodas_distribuidora',
    timestamps: false,
    indexes: [
    {
        unique: true,
        // A ordem aqui define o índice, mas o mais importante é que todas as colunas estejam presentes
        fields: ['modelo', 'aro', 'pcd', 'offset', 'acabamento']
    }
    ]
});

// Modelo para a tabela 'tokens_ml'
const Token = sequelize.define('Token', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    access_token: { type: DataTypes.TEXT },
    refresh_token: { type: DataTypes.TEXT },
}, {
    tableName: 'tokens_ml',
    timestamps: false
});

// Modelo para a tabela 'anuncios'
const Anuncio = sequelize.define('Anuncio', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    ml_id: { type: DataTypes.TEXT },
    titulo: { type: DataTypes.TEXT },
    marca: { type: DataTypes.TEXT },
    sku_id: { type: DataTypes.TEXT },
    sku: { type: DataTypes.TEXT },
    quantidade: { type: DataTypes.INTEGER },
    isUnitario: { type: DataTypes.BOOLEAN },
    categoria: {type: DataTypes.TEXT},
}, {
    tableName: 'anuncios',
    timestamps: false
});


// --- 2. Sincronização do Banco de Dados ---
const syncDb = async () => {
    try {
        await sequelize.authenticate();
        console.log('Conexão com o banco de dados PostgreSQL foi estabelecida com sucesso.');
        
        await sequelize.sync({ alter: true }); // 'alter: true' atualiza as tabelas existentes
        console.log('Todas as tabelas foram sincronizadas!');
    } catch (error) {
        console.error('Não foi possível conectar ou sincronizar com o banco de dados:', error);
        process.exit(1);
    }
};

// A função de sincronização será chamada no seu index.js
module.exports = {
    sequelize,
    Venda,
    Estoque,
    Token,
    Anuncio,
    syncDb
};


//const sqlite3 = require('sqlite3').verbose();
//
//// Nome do arquivo do banco de dados
//
//
// //Função para iniciar a conexão com o banco de dados SQLite
// //Cria uma única instância da conexão que será usada em toda a aplicação
//const db = new sqlite3.Database('mercado_livre_estoque.db', (err) => {
//    if (err) {
//        // Se a conexão falhar, imprima o erro e encerre a aplicação
//        console.error('Erro ao abrir o banco de dados:', err.message);
//        process.exit(1); // Encerra o processo com erro
//    }
//    console.log('Conexão com o banco de dados SQLite foi estabelecida.');
//});
//
//
//// Funções para lidar com operações no banco de dados de forma assíncrona
//// Isso evita o uso de callbacks e deixa o código mais limpo
//function run(sql, params = []) {
//    return new Promise((resolve, reject) => {
//        db.run(sql, params, function(err) {
//            if (err) {
//                console.error('Erro ao executar a query:', err.message);
//                reject(err);
//            } else {
//                resolve({ id: this.lastID });
//            }
//        });
//    });
//}
//
//function all(sql, params = []) {
//    return new Promise((resolve, reject) => {
//        db.all(sql, params, (err, rows) => {
//            if (err) {
//                console.error('Erro ao buscar dados:', err.message);
//                reject(err);
//            } else {
//                resolve(rows);
//            }
//        });
//    });
//}
//
//
//
//// Criação das tabelas na inicialização do banco de dados
//// Isso garante que as tabelas existam antes que qualquer rota tente acessá-las
//db.serialize(() => {
//    db.run(`CREATE TABLE IF NOT EXISTS vendas_ml (
//        id INTEGER PRIMARY KEY AUTOINCREMENT,
//        data TEXT,
//        id_ml TEXT,
//        sku TEXT,
//        valor REAL(10,2),
//        comissao REAL(10,2)
//    )`);
//    console.log('Tabela "vendas_ml" verificada/criada.');
//    
//    // Você pode adicionar outras tabelas aqui, como a de "estoque"
//    db.run(`CREATE TABLE IF NOT EXISTS estoque_rodas_distribuidora (
//        id INTEGER PRIMARY KEY AUTOINCREMENT,
//        modelo VARCHAR(50),
//        aro VARCHAR(20),
//        pcd VARCHAR(20),
//        offset VARCHAR(10),
//        acabamento VARCHAR(100),
//        qtde_sp INT,
//        qtde_sc INT,
//        sku TEXT
//    )`);
//    console.log('Tabela "estoque_rodas_distribuidora" verificada/criada.');
//
//    db.run(`CREATE TABLE IF NOT EXISTS tokens_ml (
//        id INTEGER PRIMARY KEY AUTOINCREMENT,
//        access_token TEXT,
//        refresh_token TEXT
//    )`);
//    console.log('Tabela "tokens_ml" verificada/criada.');
//
//    db.run(`CREATE TABLE IF NOT EXISTS anuncios (
//            id INTEGER PRIMARY KEY AUTOINCREMENT,
//            ml_id TEXT NOT NULL,
//            titulo TEXT,
//            marca TEXT,
//            sku_id TEXT,
//            sku TEXT,
//            quantidade INTEGER,
//            isUnitario BOOLEAN
//    )`);
//    console.log('Tabela "anuncios" verificada/criada.');
//    
//});
//
//
////function fecharConexaoDb(db) {
////    return new Promise((resolve, reject) => {
////        if (!db) {
////            console.warn('Tentativa de fechar uma conexão nula.');
////            return resolve(); // Resolve sem erro se a conexão for nula
////        }
////        
////        db.close((err) => {
////            if (err) {
////                console.error('Erro ao fechar o banco de dados:', err.message);
////                return reject(err); // Rejeita a Promise em caso de erro
////            }
////            console.log('Banco de dados fechado com sucesso.');
////            resolve(); // Resolve a Promise
////        });
////    });
////}
//
//module.exports = {
//    db, // Exporta a instância para casos de uso avançados
//    run, // Exporta a função para queries de inserção/update
//    all  // Exporta a função para queries de busca
//};