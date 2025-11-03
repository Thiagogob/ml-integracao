
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api'; 
import { logout } from '../services/authService';


interface Venda {
    id_venda: string;
    id_ml: number;
    sku: string;
    valor: number;
    comissao: number;
    qtde_sp: number;            
    qtde_sc: number;
    quantidade: number;
    data: string; // ISO string
    disponibilidade: 'campinas' | 'sul' | 'pendencia' | null;
}

const VendasPage: React.FC = () => {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();


    
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [rawVendas, setRawVendas] = useState<Venda[]>([]);
    const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());

    const view = searchParams.get('view') || 'coleta';

    // Função para buscar dados
    useEffect(() => {
        const fetchSales = async () => {
            setLoading(true);
            setError(null);
            try {
                // Chama o endpoint do backend. 
               
                const response = await api.get('/vendas/listarVendas'); 
                setRawVendas(response.data);

                
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


const vendasExibidas = useMemo(() => {
        if (view === 'pendencia') {
            return rawVendas.filter(v => v.disponibilidade === 'pendencia');
        } 
        
        // Coleta (Padrão): Pronta Entrega, Sul, e Status Indefinido (NULL)
        return rawVendas.filter(v => 
            v.disponibilidade === 'campinas' || v.disponibilidade === 'sul' || v.disponibilidade === null
        );
    }, [rawVendas, view]);
    
const handleToggleSelecao = (vendaId: string) => {
        setSelecionadas(prev => {
            const novoSet = new Set(prev);
            if (novoSet.has(vendaId)) {
                novoSet.delete(vendaId);
            } else {
                novoSet.add(vendaId);
            }
            return novoSet;
        });
    };

    // --- 3. FUNÇÕES DE NAVEGAÇÃO DOS BOTÕES ---
const setView = (newView: 'coleta' | 'pendencia') => {
        if (newView === 'pendencia') {
            setSearchParams({ view: 'pendencia' });
        } else {
            setSearchParams({});
        }
    };

const handleViewToggle = () => {
        const nextView = view === 'coleta' ? 'pendencia' : 'coleta';
        setView(nextView);
    };

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


const handleMarcarComoColetado = async (vendaId: string, setVendas: any, setError: any) => {
    try {
        // Chamada à API para alterar o status no DB
        // (PUT para atualizar o recurso)
        await api.put(`/vendas/coletado/${vendaId}`); 
        
        // Atualizar o estado local para REMOVER o item da lista
       setVendas((prevVendas: Venda[]) => prevVendas.filter(venda => venda.id_venda !== vendaId));
        
        console.log(`Venda ID: ${vendaId} marcada como coletada e removida da lista.`);

    } catch (error) {
        setError('Falha ao marcar como Coletado. Tente novamente.');
      
        console.error('Erro ao marcar coleta:', error);
    }
};


    // Função utilitária para formatar o valor monetário
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

const handleGerarPedido = () => {
        // 1. Filtrar apenas as rodas que foram selecionadas
        const vendasSelecionadas = rawVendas.filter(venda => selecionadas.has(venda.id_venda));

        if (vendasSelecionadas.length === 0) {
            alert("Selecione pelo menos uma roda para gerar o pedido.");
            return;
        }

        // 2. Navegar, passando os dados no state
        navigate('/gerar-pedido', { 
            state: { vendas: vendasSelecionadas } 
        });
    };


    // --- Renderização Principal ---
 return (
<div className="min-h-screen bg-gray-900 text-white p-8">
            <header className="flex justify-between items-center mb-10 border-b border-gray-700 pb-4">
                <h1 className="text-4xl font-bold text-indigo-400">
                    {view === 'coleta' ? '📦 Lista de Coleta' : '❌ Lista de Pendências'}
                </h1>
                <div className="flex space-x-4">
                    
                    <button
                        onClick={handleGerarPedido}
                        disabled={selecionadas.size === 0}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${selecionadas.size === 0 ? 'bg-gray-500 cursor-not-allowed' : 'bg-green-600 hover:bg-green-700'}`}
                    >
                        Gerar Pedido ({selecionadas.size})
                    </button>

                    <button

                        onClick={handleViewToggle}
                        className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${view === 'coleta' ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
                    >
                        {view === 'coleta' ? 'Listar Pendências' : 'Listar Rodas para Coleta'}
                    </button>
                    
                    <button
                        onClick={() => handleGoBack()} // Usando a chamada correta para a função
                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-semibold transition"
                    >
                        &larr; Voltar
                    </button>
                </div>
            </header>

            {error && <div className="bg-red-900 text-red-300 p-3 rounded mb-4">{error}</div>}

            <div className="space-y-4"> 

                {vendasExibidas.length === 0 ? (
                    <p className="text-center text-gray-400">Nenhuma venda com pendência de estoque.</p>
                ) : (
                    vendasExibidas.map((venda) => {
                        const indicator = getEstoqueIndicator(venda);
                        return (
                            <div 
                                key={venda.id_venda} 
                                className="bg-gray-800 p-5 rounded-xl shadow-lg border border-gray-700 flex justify-between items-center transition hover:border-indigo-500"
                            >
                        <input 
                            type="checkbox"
                            checked={selecionadas.has(venda.id_venda)}
                            onChange={() => handleToggleSelecao(venda.id_venda)}
                            className="mr-4 h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                        />
                                {/* Bloco Esquerdo: Detalhes da Venda */}
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm text-gray-400">
                                        ID do anúncio: <span className="font-semibold text-gray-300">{venda.id_ml}</span>
                                    </p>
                                    <p className="text-sm text-gray-400">
                                        Pedido ID: <span className="font-semibold text-indigo-400">{venda.id_venda}</span>
                                    </p>
                                    <h3 className="text-xl font-bold truncate text-white mt-1">
                                        {venda.sku} <span className="text-base font-normal text-gray-400">({venda.quantidade} Un.)</span>
                                    </h3>
                                    
                                    {/* Indicação de Estoque */}
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
                                    
                                    {view === 'coleta' ? (
                                        <button
                                            onClick={() => handleMarcarComoColetado(venda.id_venda, setRawVendas, setError)}
                                            className="mt-3 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-semibold transition flex items-center"
                                        >
                                            ✅ Marcar como Coletado
                                        </button>
                                    ) : (
                                        <span className="mt-3 px-4 py-2 text-sm text-gray-400 border border-gray-600 rounded-lg">
                                            Aguardando Estoque
                                        </span>
                                    )}
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