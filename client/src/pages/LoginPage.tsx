import React, { useState } from 'react';
import InputField from '../components/ui/InputField';
import Button from '../components/ui/Button';
import ErrorAlert from '../components/ui/ErrorAlert';
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
        <div className="flex min-h-screen bg-surface-page">
            {/* Painel de apresentacao (coluna esquerda) */}
            <section className="hidden w-[620px] shrink-0 flex-col justify-center gap-6 bg-nav-bg p-16 lg:flex">
                <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-brand text-body font-semibold text-white">ML</div>
                    <span className="text-heading font-semibold text-white">ML Integração</span>
                </div>
                <p className="max-w-[480px] text-display font-bold text-white">
                    Estoque do fornecedor, anúncios do Mercado Livre e coleta de pedidos em um só lugar.
                </p>
                <p className="max-w-[460px] text-body text-nav-text">
                    A plataforma concilia o relatório de estoque com os anúncios, consulta as vendas a cada 10 minutos e organiza a separação das rodas para coleta.
                </p>
            </section>

            {/* Formulario (coluna direita) */}
            <section className="flex flex-1 items-center justify-center p-10">
                <div className="flex w-full max-w-[420px] flex-col gap-5 rounded-xl border border-line bg-surface-card p-10 shadow-card">
                    <div className="flex flex-col gap-1.5">
                        <h1 className="text-display font-bold text-ink-900">Acesso ao sistema</h1>
                        <p className="text-body text-ink-600">Insira suas credenciais para continuar.</p>
                    </div>

                    {error && <ErrorAlert message={error} />}

                    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
                        <div className="flex flex-col gap-4">
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
                        </div>

                        <Button
                            type="submit"
                            size="lg"
                            className="w-full"
                            isLoading={isLoading}
                            disabled={isLoading}
                        >
                            Entrar
                        </Button>
                    </form>
                </div>
            </section>
        </div>
    );
};

export default LoginPage;
