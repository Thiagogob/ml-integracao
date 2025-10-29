import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { getToken } from './authService'; // Importa a função que busca o token

// O BASE_URL será o prefixo que o seu proxy (configurado no vite.config.ts) irá interceptar.
// Em desenvolvimento, isso será roteado para http://localhost:3001/api
const BASE_URL = '/api'; 

// 1. Cria a instância base do Axios
const api: AxiosInstance = axios.create({
    baseURL: BASE_URL,
    timeout: 10000, // Tempo limite de 10 segundos para requisições
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

// 3. Opcional: Interceptor para erros de resposta (401/403)
// Este interceptor é útil para deslogar o usuário se o token expirar
api.interceptors.response.use(
    (response) => response,
    (error) => {
        // Verifica se é erro de Autorização (401) ou Proibido/Token Expirado (403)
        if (error.response && (error.response.status === 401 || error.response.status === 403)) {
            console.error('Sessão expirada ou não autorizada. Redirecionando para login...');
            
            // Aqui você deve forçar o logout e o redirecionamento
            // (Requer a função logout importada e um roteador, geralmente feito no Context/Hook)
            
            // Exemplo: logout(); window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

export default api;