const path = require('path');
// Carrega o dotenv para ter acesso às variáveis de DB
require('dotenv').config({ path: path.resolve(__dirname, '.env') }); 

// Importa a função de sincronização e o modelo User
const { syncDb, User, sequelize } = require('./src/config/database'); 

// --- DADOS DO ÚNICO USUÁRIO ---
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'rodolfoecarlaomkr'; // **ALTERE ISTO!**
// --- FIM DOS DADOS ---

const seedUser = async () => {
    try {
        // Garante que a conexão com o DB está aberta e as tabelas criadas
        await syncDb(); 
        
        // Tenta encontrar o usuário para evitar duplicidade
        const existingUser = await User.findOne({ where: { username: DEFAULT_USERNAME } });

        if (existingUser) {
            console.warn(`Usuário '${DEFAULT_USERNAME}' já existe. Nenhuma ação necessária.`);
            return;
        }

        // Insere o novo usuário. O hook 'beforeCreate' irá criptografar a senha!
        await User.create({
            username: DEFAULT_USERNAME,
            password: DEFAULT_PASSWORD,
            role: 'admin'
        });

        console.log(`\n✅ Usuário padrão '${DEFAULT_USERNAME}' inserido com sucesso!`);

    } catch (error) {
        console.error('❌ Erro ao popular o usuário:', error.message);
    } finally {
        // Fecha a conexão do Sequelize
        await sequelize.close(); 
    }
};

seedUser();