import React, { useState } from 'react';
import InputField from '../components/ui/InputField';
import Button from '../components/ui/Button';
import { login } from '../services/authService'; 
import { useNavigate } from 'react-router-dom'; 

// Definição da interface para os dados do formulário
interface LoginFormState {
    username: string;
    password: string;
}

const LoginPage: React.FC = () => {
    const navigate = useNavigate();
    
    const [formData, setFormData] = useState<LoginFormState>({
        username: '',
        password: '',
    });
    
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value,
        });
        setError(null);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsLoading(true);
        setError(null);

        if (!formData.username || !formData.password) {
            setError('Por favor, preencha o usuário e a senha.');
            setIsLoading(false);
            return;
        }

        try {
            await login(formData.username, formData.password);
            
            console.log("Login bem-sucedido. Token salvo.");
            
            navigate('/dashboard', { replace: true }); 
            
        } catch (err: any) {
            const errorMessage = err.response?.data?.message || 'Erro de conexão ou credenciais inválidas.';
            setError(errorMessage);
            console.error("Erro no login:", err);
            
        } finally {
            setIsLoading(false);
        }
    };

    return (
        // Contêiner principal: Fundo Cinza Escuro (bg-gray-900) e Letras Brancas (text-white)
        <div className="min-h-screen flex items-center justify-center bg-gray-900 p-4">
            
           
            <div className="w-full max-w-md p-8 space-y-6 bg-gray-800 rounded-xl shadow-2xl border border-gray-700">
                
                <h1 className="text-3xl font-bold text-center text-white">
                    Acesso ao Sistema
                </h1>
                <p className="text-center text-gray-400">
                    Insira suas credenciais para continuar
                </p>
                
                
                {error && (
                    // Alerta de erro com fundo vermelho escuro e texto claro
                    <div className="bg-red-900 border border-red-700 text-red-300 px-4 py-3 rounded relative text-sm" role="alert">
                        <span className="block sm:inline">{error}</span>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-6">
                   
                    <InputField
                        label="Usuário"
                        id="username"
                        name="username"
                        type="text"
                        value={formData.username}
                        onChange={handleChange}
                        disabled={isLoading}
                        autoComplete="username"
                    />
                    
                    <InputField
                        label="Senha"
                        id="password"
                        name="password"
                        type="password"
                        value={formData.password}
                        onChange={handleChange}
                        disabled={isLoading}
                        autoComplete="current-password"
                    />
                    
                    <Button 
                        type="submit" 
                        isLoading={isLoading}
                        disabled={isLoading}
                    >
                        Entrar
                    </Button>
                </form>
            </div>
        </div>
    );
};

export default LoginPage;