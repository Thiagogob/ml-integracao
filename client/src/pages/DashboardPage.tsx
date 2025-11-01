import React, { useState, useEffect } from 'react';
import { logout } from '../services/authService'; // Para a função de logout
import { useNavigate } from 'react-router-dom';
import Top5Card from '../components/ui/Top5Card';
import api from '../services/api'; // Seu cliente Axios seguro
import AtencaoCard from '../components/ui/AtencaoCard';

interface DashboardData {
    rodasVendidasDia: number;
    totalRodasEmEstoque: number;
    ultimaSincronizacao: string;
    top5Vendas: TopVenda[];
    top5Atencao: AtencaoRodas[];
}

interface TopVenda {
    sku: string;
    total_vendido: number;
}

interface AtencaoRodas {
    sku: string;
    total_pedidos_15dias: number;
    qtde_estoque_total: number;
    indice_atencao: string; // Vem como string formatada do backend
}

const DashboardPage: React.FC = () => {
    const navigate = useNavigate();
    const [data, setData] = useState<DashboardData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchDashboardData = async () => {
            try {
                // 1. Chama o novo endpoint do backend para obter dados resumidos
                const response = await api.get('/dashboard/summary');
                setData(response.data);
            } catch (err: any) {
                // Se o token expirar (401/403), o interceptor pode redirecionar.
                // Caso contrário, mostra o erro
                setError('Falha ao carregar dados do dashboard. Tente novamente.');
                console.error('Erro ao buscar dados:', err);
                // Força logout e redireciona se o erro for 401/403
                if (err.response?.status === 401 || err.response?.status === 403) {
                     logout();
                     navigate('/login');
                }
            } finally {
                setLoading(false);
            }
        };

        fetchDashboardData();
    }, [navigate]);

    const handleLogout = () => {
        logout();
        navigate('/login', { replace: true });
    };

    
    const handleListarVendas = () => {
        navigate('/vendas'); 
    };

    if (loading) {
        return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">Carregando Dashboard...</div>;
    }

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            <header className="flex justify-between items-center mb-10 border-b border-gray-700 pb-4">
                <h1 className="text-4xl font-bold text-white-400">Visão Geral</h1>
                <div className="flex space-x-4"> {/* Container para os botões */}
                    {/* NOVO BOTÃO: Listar Vendas */}
                    <button
                        onClick={handleListarVendas}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-semibold transition"
                    >
                        Listar rodas para coleta
                    </button>
                    {/* Botão Sair existente */}
                    <button
                        onClick={handleLogout}
                        className="px-4 py-2 bg-red-600 hover:bg-red-700 rounded-lg text-sm font-semibold transition"
                    >
                        Sair
                    </button>
                </div>
            </header>
            {error && <div className="bg-red-900 text-red-300 p-3 rounded mb-4">{error}</div>}

            {data ? (
                <>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
                    {/* Exemplo de Cartão de Dados */}
                    <DashboardCard title="Vendas de roda no dia" value={data.rodasVendidasDia} />
                    <DashboardCard title="Quantidade de rodas em Estoque" value={data.totalRodasEmEstoque} />
                    <DashboardCard title="Horário da última venda" value={data.ultimaSincronizacao} isDate={true} />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {/* Exemplo de Cartão de Dados */}
                    {data.top5Vendas && <Top5Card data={data.top5Vendas} />}
                </div>

                {data.top5Atencao && data.top5Atencao.length > 0 && (
            <div className="mt-8"> {/* Adiciona espaço superior */}
                <AtencaoCard data={data.top5Atencao} />
            </div>
        )}
                </>
            ) : (
                <p className="text-center text-gray-400">Nenhum dado disponível.</p>
            )}

            {/* Aqui você adicionaria mais botões de sincronização manual, tabelas, etc. */}
        </div>
    );
};

// Componente simples para o cartão de resumo (Adicionar no mesmo arquivo ou em /components/ui)
interface CardProps {
    title: string;
    value: string | number;
    isDate?: boolean;
}

const DashboardCard: React.FC<CardProps> = ({ title, value, isDate = false }) => (
    <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
        <p className="text-sm font-medium text-gray-400 mb-2">{title}</p>
        <h2 className="text-3xl font-extrabold text-white">
            {isDate ? new Date(value).toLocaleString() : value}
        </h2>
    </div>
);

export default DashboardPage;