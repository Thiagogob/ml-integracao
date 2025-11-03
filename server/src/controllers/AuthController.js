const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const { User } = require('../config/database'); // Importa o modelo User
const { sequelize } = require('../config/database');

const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 10; 


// --- FUNÇÃO PRINCIPAL DE LOGIN ---
exports.login = async (req, res) => {
    const { username, password } = req.body;

    // 1. Busca o usuário pelo username
    const user = await User.findOne({ where: { username: username } });

    if (!user) {
        return res.status(401).json({ message: 'Credenciais inválidas: Usuário ou senha inválidos' });
    }

    // 2. Compara a senha fornecida com a hash salva no DB
    const isPasswordValid = await bcrypt.compare(password, user.password);

    if (!isPasswordValid) {
        return res.status(401).json({ message: 'Credenciais inválidas: Usuário ou senha inválidos' });
    }

    // 3. Geração do Token JWT
    const token = jwt.sign(
        { 
            userId: user.id, 
            username: user.username,
        }, 
        JWT_SECRET,
        { expiresIn: '12h' }
    );

    // 4. Retorna o token para o frontend
    res.json({ 
        message: 'Login bem-sucedido',
        token: token 
    });
};