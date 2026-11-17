// /server/src/config/models/importacoes.js
//
// Fabrica dos modelos da importacao acompanhada.
//
// Esta fabrica existe separada de database.js por um motivo pratico: database.js
// cria a conexao a partir das variaveis de ambiente e fixa o dialeto em
// 'postgres'. Recebendo a instancia por parametro, os mesmos modelos podem ser
// definidos sobre um sqlite em memoria na suite de testes, sem Postgres e sem
// credenciais. O esquema de producao e criado pela migracao em
// server/migrations/importacoes_estoque_up.sql, nao por sync().

const { DataTypes } = require('sequelize');

// Estados do job. O CHECK da migracao repete esta lista; mudar aqui exige
// mudar la.
const ESTADOS = {
    ANALISANDO: 'analisando',
    AGUARDANDO_CONFIRMACAO: 'aguardando_confirmacao',
    PROCESSANDO: 'processando',
    CONCLUIDA: 'concluida',
    FALHOU: 'falhou',
    CANCELADA: 'cancelada',
    INTERROMPIDA: 'interrompida'
};

// Estados em que o arquivo nao pode ser reenviado (ver indice unico parcial).
// Quem falhou ou foi cancelada pode ser reenviada: reenviar e a correcao.
const ESTADOS_QUE_BLOQUEIAM_REENVIO = [
    ESTADOS.ANALISANDO,
    ESTADOS.AGUARDANDO_CONFIRMACAO,
    ESTADOS.PROCESSANDO,
    ESTADOS.CONCLUIDA
];

// Estados em voo, que o reconciliador inspeciona na subida do processo
const ESTADOS_EM_VOO = [ESTADOS.ANALISANDO, ESTADOS.PROCESSANDO];

// Estados terminais
const ESTADOS_TERMINAIS = [
    ESTADOS.CONCLUIDA,
    ESTADOS.FALHOU,
    ESTADOS.CANCELADA,
    ESTADOS.INTERROMPIDA
];

const RESULTADOS = {
    ATUALIZADO: 'atualizado',
    JA_ATUALIZADO: 'ja_atualizado',
    ERRO: 'erro',
    IGNORADO: 'ignorado'
};

// Coluna de resultado -> coluna de contador na tabela do job
const CONTADOR_POR_RESULTADO = {
    [RESULTADOS.ATUALIZADO]: 'atualizados',
    [RESULTADOS.JA_ATUALIZADO]: 'ja_atualizados',
    [RESULTADOS.ERRO]: 'erros',
    [RESULTADOS.IGNORADO]: 'ignorados'
};

const definirModelosImportacao = (sequelize) => {
    // JSONB so existe no Postgres; no sqlite da suite cai para JSON (TEXT).
    const tipoJson = sequelize.getDialect() === 'postgres'
        ? DataTypes.JSONB
        : DataTypes.JSON;

    const Importacao = sequelize.define('Importacao', {
        id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
        store_id: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },

        origem: { type: DataTypes.TEXT, allowNull: false },
        estado: { type: DataTypes.TEXT, allowNull: false, defaultValue: ESTADOS.ANALISANDO },

        arquivo_nome: { type: DataTypes.TEXT },
        arquivo_bytes: { type: DataTypes.INTEGER },
        arquivo_sha256: { type: DataTypes.STRING(64), allowNull: false },

        usuario_id: { type: DataTypes.INTEGER },
        usuario_nome: { type: DataTypes.TEXT },

        criada_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
        confirmada_em: { type: DataTypes.DATE },
        iniciada_em: { type: DataTypes.DATE },
        concluida_em: { type: DataTypes.DATE },

        heartbeat_em: { type: DataTypes.DATE },
        executor: { type: DataTypes.TEXT },

        total_anuncios: { type: DataTypes.INTEGER },

        processados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        atualizados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        ja_atualizados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        erros: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
        ignorados: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },

        resumo: { type: tipoJson },
        detalhe_analise: { type: tipoJson },

        arquivo_caminho: { type: DataTypes.TEXT },
        // entrada e plano ficam no banco para que confirmacao e retomada nao
        // dependam do sistema de arquivos, que e efemero no Railway
        entrada_rodas: { type: tipoJson },
        plano_anuncios: { type: tipoJson },

        erro_mensagem: { type: DataTypes.TEXT },
        cancelamento_pedido: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
    }, {
        tableName: 'importacoes_estoque',
        timestamps: false
    });

    const ImportacaoEvento = sequelize.define('ImportacaoEvento', {
        id: { type: DataTypes.BIGINT, primaryKey: true, autoIncrement: true },
        importacao_id: { type: DataTypes.INTEGER, allowNull: false },

        seq: { type: DataTypes.INTEGER, allowNull: false },
        criado_em: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },

        sku: { type: DataTypes.TEXT },
        ml_id: { type: DataTypes.TEXT },
        titulo: { type: DataTypes.TEXT },

        resultado: { type: DataTypes.TEXT, allowNull: false },
        status_http: { type: DataTypes.INTEGER },
        quantidade_nova: { type: DataTypes.INTEGER },
        motivo: { type: DataTypes.TEXT },
        duracao_ms: { type: DataTypes.INTEGER }
    }, {
        tableName: 'importacoes_eventos',
        timestamps: false,
        indexes: [
            { unique: true, fields: ['importacao_id', 'seq'] },
            { fields: ['importacao_id', 'resultado'] }
        ]
    });

    Importacao.hasMany(ImportacaoEvento, { foreignKey: 'importacao_id', as: 'eventos' });
    ImportacaoEvento.belongsTo(Importacao, { foreignKey: 'importacao_id', as: 'importacao' });

    return { Importacao, ImportacaoEvento };
};

module.exports = {
    definirModelosImportacao,
    ESTADOS,
    ESTADOS_QUE_BLOQUEIAM_REENVIO,
    ESTADOS_EM_VOO,
    ESTADOS_TERMINAIS,
    RESULTADOS,
    CONTADOR_POR_RESULTADO
};
