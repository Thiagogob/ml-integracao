// /server/seed.js
//
// Cria, ou redefine a senha de, o usuario de acesso a plataforma.
//
// A SENHA NAO MORA NESTE ARQUIVO.
//
// Ela morava: ate 17/11/2026 este script carregava uma senha em texto puro, num
// repositorio publico. Qualquer pessoa que lesse o repositorio entrava na
// plataforma, e de la zerava a quantidade dos anuncios no Mercado Livre. A
// senha foi trocada e esta versao passou a le-la de variavel de ambiente.
//
// Trocar o arquivo nao desfaz o passado: a senha antiga continua no historico
// do git. O que resolve e ela ter sido rotacionada, e nao poder mais ser usada.
//
// USO
//
//   Criar o usuario, se nao existir:
//     SEED_USERNAME=admin SEED_PASSWORD='...' node seed.js
//
//   Redefinir a senha de quem ja existe (o hook beforeUpdate refaz a hash):
//     SEED_USERNAME=admin SEED_PASSWORD='...' SEED_RESET=1 node seed.js
//
//   Contra o banco de producao, com as variaveis do servico:
//     railway run --service ml-integracao -- node seed.js
//   Lembrando que DB_HOST e endereco de rede privada: isso funciona de dentro
//   do Railway, nao da sua maquina. De fora, use a URL publica do servico
//   Postgres.
//
// Nao passe a senha em linha de comando onde o historico do shell a guarde.
// Prefira exportar a variavel, ou um .env fora do repositorio.

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '.env') });

const { syncDb, User, sequelize } = require('./src/config/database');

const USERNAME = process.env.SEED_USERNAME || 'admin';
const PASSWORD = process.env.SEED_PASSWORD;
const RESET = process.env.SEED_RESET === '1';

// Comprimento minimo. Nao e politica de seguranca, e apenas um empecilho a
// repetir o problema que este arquivo causou.
const MINIMO = 12;

const seedUser = async () => {
    if (!PASSWORD) {
        console.error(
            '\nSEED_PASSWORD nao definida.\n\n' +
            '  SEED_PASSWORD=\'sua-senha\' node seed.js\n\n' +
            'A senha nao fica neste arquivo de proposito: o repositorio e publico.\n'
        );
        process.exitCode = 2;
        return;
    }

    if (PASSWORD.length < MINIMO) {
        console.error(`\nSenha curta demais: use ao menos ${MINIMO} caracteres.\n`);
        process.exitCode = 2;
        return;
    }

    try {
        await syncDb();

        const existente = await User.findOne({ where: { username: USERNAME } });

        if (existente && !RESET) {
            console.warn(
                `\nUsuario '${USERNAME}' ja existe. Nada foi alterado.\n` +
                'Para redefinir a senha dele, repita com SEED_RESET=1.\n'
            );
            return;
        }

        if (existente) {
            // Atribuir e salvar, em lugar de User.update, para o hook
            // beforeUpdate rodar e gerar a hash. Um UPDATE direto gravaria a
            // senha em texto puro no banco.
            existente.password = PASSWORD;
            await existente.save();
            console.log(`\nSenha do usuario '${USERNAME}' redefinida.\n`);
            return;
        }

        // O hook beforeCreate gera a hash com bcrypt
        await User.create({ username: USERNAME, password: PASSWORD });
        console.log(`\nUsuario '${USERNAME}' criado.\n`);
    } catch (error) {
        console.error('\nErro ao popular o usuario:', error.message, '\n');
        process.exitCode = 1;
    } finally {
        await sequelize.close();
    }
};

seedUser();
