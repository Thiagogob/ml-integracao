// /server/src/config/database.js

const { Sequelize, DataTypes } = require('sequelize');
const path = require('path');
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 10; // Número de rounds para a criptografia
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
    id_venda: { type: DataTypes.TEXT, unique: true }, 
    data: { type: DataTypes.TEXT },
    id_ml: { type: DataTypes.TEXT },
    sku: { type: DataTypes.TEXT },
    valor: { type: DataTypes.REAL(10, 2) },
    comissao: { type: DataTypes.REAL(10, 2) },
    quantidade: {type: DataTypes.INTEGER},

    disponibilidade: {
        type: DataTypes.ENUM('campinas', 'sul', 'pendencia'),
        allowNull: true, // Permite NULL
        // Sem defaultValue
    },

    coletada: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false // Por padrão, a roda não foi coletada
    }
}, {
    tableName: 'vendas_ml',
    timestamps: false
});

//tabela de usuarios
const User = sequelize.define('User', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true // Garante que não haja dois usuários com o mesmo nome
    },
    password: {
        type: DataTypes.STRING, // Tipo ideal para armazenar a hash da senha
        allowNull: false,
    }
}, {
    tableName: 'users',
    timestamps: true,
    hooks: {
        beforeCreate: async (user) => {
            if (user.password) {
                // Gera a hash da senha com o bcrypt
                const salt = await bcrypt.genSalt(SALT_ROUNDS);
                user.password = await bcrypt.hash(user.password, salt);
            }
        },
        beforeUpdate: async (user) => {
            if (user.password) {
                // Garante que a senha seja criptografada também ao ser atualizada
                const salt = await bcrypt.genSalt(SALT_ROUNDS);
                user.password = await bcrypt.hash(user.password, salt);
            }
        }
    } // Use 'true' para ter campos createdAt e updatedAt automáticos
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
    qtde_pr: { 
        type: DataTypes.INTEGER
     },
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


const EstoqueTemporario = sequelize.define('EstoqueTemporario', {
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
    qtde_pr: { type: DataTypes.INTEGER }, // Quantidade no Paraná
    qtde_sc: { type: DataTypes.INTEGER }, // Quantidade em Santa Catarina
    sku: { type: DataTypes.TEXT }, // Preenchido posteriormente
}, {
    tableName: 'estoque_temporario',
    timestamps: false,
    indexes: [
    {
        unique: true,
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

const SyncControl = sequelize.define('SyncControl', {
    // A chave será o identificador da tarefa ('last_sale_sync')
    id: {
        type: DataTypes.TEXT, 
        primaryKey: true
    },
    // Armazena a data/hora do último processamento bem-sucedido
    last_timestamp: { 
        type: DataTypes.DATE,
        allowNull: true // Pode ser nulo na primeira execução
    },
}, {
    tableName: 'sync_control',
    timestamps: false
});

Venda.belongsTo(Estoque, {
    foreignKey: 'sku',
    targetKey: 'sku',
    as: 'estoque_associado', // Nome da associação para ser usado no 'include'
    constraints: false // IMPEDE o Sequelize de criar uma FOREIGN KEY no banco de dados
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
    EstoqueTemporario,
    Token,
    Anuncio,
    SyncControl,
    User,
    syncDb
};


