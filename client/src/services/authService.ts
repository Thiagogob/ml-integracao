import api from './api'; // Sua instância configurada do axios

// Chave que usamos para armazenar o token no navegador
const TOKEN_KEY = 'jwtToken';

/**
 * @typedef {Object} LoginResponse
 * @property {string} token - O token JWT recebido do backend.
 * @property {string} message - Mensagem de sucesso do backend.
 */
interface LoginResponse {
    token: string;
    message: string;
}

/**
 * Envia as credenciais para o backend e armazena o token JWT.
 * * @param username Nome de usuário.
 * @param password Senha do usuário.
 * @returns Promise<LoginResponse>
 */
export const login = async (username: string, password: string): Promise<LoginResponse> => {
    try {
        const response = await api.post('/login', { username, password });
        
        const data: LoginResponse = response.data;
        
        if (data.token) {
            // Sucesso: Salva o token no localStorage
            localStorage.setItem(TOKEN_KEY, data.token);
        }

        return data;

    } catch (error: any) {
        // Axios lança erros para status code 4xx/5xx.
        // O LoginPage já trata esse erro, então apenas o relançamos.
        throw error; 
    }
};

/**
 * Remove o token do localStorage e encerra a sessão do usuário.
 */
export const logout = (): void => {
    localStorage.removeItem(TOKEN_KEY);
};

/**
 * Busca o token atualmente armazenado no navegador.
 * @returns string | null
 */
export const getToken = (): string | null => {
    return localStorage.getItem(TOKEN_KEY);
};

// Opcional: Você pode adicionar uma função para verificar se o usuário está logado
export const isLoggedIn = (): boolean => {
    return !!getToken();
};