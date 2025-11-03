import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { getToken } from './authService'; 


const BASE_URL = '/api'; 

// 1. Cria a instância base do Axios
const api: AxiosInstance = axios.create({
    baseURL: BASE_URL,
    timeout: 10000, 
    headers: {
        'Content-Type': 'application/json',
    },
});

// 2. O Interceptor: Adiciona o Token JWT a cada requisição
api.interceptors.request.use(
    (config) => {
        // Busca o token JWT salvo no localStorage
        const token = getToken();

        // Se o token existir, anexa-o ao cabeçalho Authorization
        if (token) {
            // Padrão JWT: Bearer <token>
            config.headers['Authorization'] = `Bearer ${token}`;
        }
        
        // Retorna a configuração modificada
        return config;
    },
    (error) => {
        // Lida com erros de requisição antes de serem enviadas
        return Promise.reject(error);
    }
);

// Interceptor para erros de resposta (401/403)
// Este interceptor é útil para deslogar o usuário se o token expirar
api.interceptors.response.use(
    (response) => response,
    (error) => {
        // Verifica se é erro de Autorização (401) ou Proibido/Token Expirado (403)
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            console.error('Sessão expirada ou não autorizada. Redirecionando para login...');
            
        }
        return Promise.reject(error);
    }
);

export default api;