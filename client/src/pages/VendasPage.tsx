// src/pages/VendasPage.tsx

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api'; // Seu cliente Axios seguro
import { logout } from '../services/authService';

// --- Interfaces Atualizadas para Tipagem (TypeScript) ---

interface Venda {
    id_venda: string;
    id_ml: number;
    sku: string;
    valor: number;
    comissao: number;
    qtde_sp: number;            // NOVO: Estoque de São Paulo
    qtde_sc: number;
    quantidade: number;
    // Campo de data essencial para exibição na tabela (reintroduzido)
    data: string; // ISO string
    disponibilidade: 'campinas' | 'sul' | 'pendencia' | null;
}

const VendasPage: React.FC = () => {
    const navigate = useNavigate();
    const [vendas, setVendas] = useState<Venda[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    

    // Função para buscar dados
    useEffect(() => {
        const fetchSales = async () => {
            setLoading(true);
            setError(null);
            try {
                // Chama o endpoint do backend. 
                // Assumindo que o endpoint continua sendo /sales/listarVendas
                const response = await api.get('/vendas/listarVendas'); 
                
                // Se a API retornar o array diretamente:
                setVendas(response.data);
                
            } catch (err: any) {
                // Lidar com falha de autenticação (token expirado)
                if (err.response?.status === 401 || err.response?.status === 403) {
                     logout();
                     navigate('/login');
                }
                setError('Falha ao carregar a lista de vendas.');
                console.error('Erro ao buscar vendas:', err);
            } finally {
                setLoading(false);
            }
        };

        fetchSales();
    }, [navigate]);
    

const getEstoqueIndicator = (venda: Venda) => {
    switch (venda.disponibilidade) {
        case 'campinas':
            return {
                label: 'PRONTA ENTREGA',
                color: 'bg-green-600', 
                icon: '⚡'
            };
        case 'sul':
            return {
                label: 'SOLICITAR DO SUL',
                color: 'bg-yellow-600', 
                icon: '🚚'
            };
        case 'pendencia':
            return {
                label: 'PENDÊNCIA DE ESTOQUE',
                color: 'bg-red-600', 
                icon: '❌'
            };
        default:
            return {
                label: 'STATUS INDEFINIDO',
                color: 'bg-gray-500', 
                icon: '❓'
            };
    }
};


const handleMarcarComoColetado = async (vendaId: string) => {
    try {
        // 1. 🎯 Chamada à API para alterar o status no DB
        // (PUT para atualizar o recurso)
        await api.put(`/vendas/coletado/${vendaId}`); 
        
        // 2. Atualizar o estado local (otimista) para REMOVER o item da lista
        setVendas(prevVendas => prevVendas.filter(venda => venda.id_venda !== vendaId));
        
        console.log(`Venda ID: ${vendaId} marcada como coletada e removida da lista.`);

    } catch (error) {
        setError('Falha ao marcar como Coletado. Tente novamente.');
        // Se a falha for 401/403, trate o logout aqui também
        console.error('Erro ao marcar coleta:', error);
    }
};


    // Função utilitária para formatar o valor monetário (R$ 1.234,56)
    const formatCurrency = (value: number) => {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL',
        }).format(value);
    };

    // Função utilitária para navegar de volta ao Dashboard
    const handleGoBack = () => {
        navigate('/dashboard');
    };


    // --- Renderização de Estados ---
    if (loading) {
        return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">Carregando Vendas...</div>;
    }

    // --- Renderização Principal ---
    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            <header className="flex justify-between items-center mb-10 border-b border-gray-700 pb-4">
                <h1 className="text-4xl font-bold text-indigo-400">📊 Lista de Rodas para Coleta</h1>
                <button
                    onClick={handleGoBack}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-semibold transition"
                >
                    &larr; Voltar ao Dashboard
                </button>
            </header>

            {/* Exibição de Erros */}
            {error && <div className="bg-red-900 text-red-300 p-3 rounded mb-4">{error}</div>}

<div className="space-y-4"> {/* Usa space-y-4 para separar as cards */}
                {vendas.length === 0 ? (
                    <p className="text-center text-gray-400">Nenhuma venda pendente de separação.</p>
                ) : (
                    vendas.map((venda) => {
                        const indicator = getEstoqueIndicator(venda);
                        return (
                            <div 
                                key={venda.id_venda} 
                                className="bg-gray-800 p-5 rounded-xl shadow-lg border border-gray-700 flex justify-between items-center transition hover:border-indigo-500"
                            >
                                {/* Bloco Esquerdo: Detalhes da Venda */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-gray-400">ID Venda ML: <span className="font-semibold text-indigo-400">{venda.id_venda}</span></p>
                                    <p className="text-sm text-gray-400">ID Anúncio: <span className="font-semibold text-indigo-400">{venda.id_ml}</span></p>
                                    <h3 className="text-xl font-bold truncate text-white mt-1">
                                        {venda.sku} <span className="text-base font-normal text-gray-400">({venda.quantidade} Un.)</span>
                                    </h3>
                                    
                                    
                                    
                                    
                                    {/* Indicação de Estoque (Pronta Entrega vs Solicitar Sul) */}
                                    <span 
                                        className={`mt-2 inline-block px-3 py-1 text-xs font-semibold rounded-full text-white ${indicator.color}`}
                                    >
                                        {indicator.icon} {indicator.label}
                                    </span>
                                </div>
                                
                                {/* Bloco Direito: Ação e Valores */}
                                <div className="flex flex-col items-end space-y-2 ml-4">
                                    <p className="text-2xl font-bold text-green-400">{formatCurrency(venda.valor)}</p>
                                    <p className="text-sm text-red-400">Comissão: {formatCurrency(venda.comissao)}</p>
                                    
                                    {/* Checkbox de Despache (To-Do) */}
                                    <button
                                        onClick={() => handleMarcarComoColetado(venda.id_venda)}
                                        className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition flex items-center"
                                    >
                                        ✅ Marcar como Coletado
                                    </button>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>
        </div>
    );
};

export default VendasPage;