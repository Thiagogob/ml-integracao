const jwt = require('jsonwebtoken');
const logger = require('../config/logger');

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    logger.error('ERRO CRITICO: JWT_SECRET nao esta definida nas variaveis de ambiente');
}

exports.protect = (req, res, next) => {
    // 1. Verifica se o token está presente no cabeçalho
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        // Se não houver cabeçalho ou se o formato estiver incorreto
        return res.status(401).json({ message: 'Acesso negado. Token de autorização não fornecido.' });
    }

    // 2. Extrai o token (remove "Bearer ")
    const token = authHeader.split(' ')[1]; 

    try {
        // 3. Verifica e decodifica o token usando a chave secreta
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // Armazena as informações decodificadas do usuário na requisição (útil para controllers)
        req.user = decoded; 

        // 4. Se o token for válido, passa o controle para a próxima função (o Controller)
        next(); 

    } catch (error) {
        // Captura erros como: Token expirado, Assinatura inválida (adulterado)
        logger.error({ err: error }, 'erro de verificacao JWT');
        return res.status(403).json({ message: 'Token inválido ou expirado.' });
    }
};