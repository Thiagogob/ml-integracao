
import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import api from '../services/api'; 
import { logout } from '../services/authService';
import AppLayout from '../components/ui/AppLayout';
import Badge from '../components/ui/Badge';
import type { BadgeTone } from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import ErrorAlert from '../components/ui/ErrorAlert';
import PageHeader from '../components/ui/PageHeader';


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
    
    // Contagens das abas e resumo por disponibilidade, calculados a partir da mesma lista.
    const totalColeta = useMemo(() => rawVendas.filter(v => v.disponibilidade !== 'pendencia').length, [rawVendas]);
    const totalPendencias = useMemo(() => rawVendas.filter(v => v.disponibilidade === 'pendencia').length, [rawVendas]);
    const resumo = useMemo(() => {
        const ordem: Array<Venda['disponibilidade']> = ['campinas', 'sul', 'pendencia', null];
        return ordem
            .map(disp => {
                const quantidade = vendasExibidas.filter(v => v.disponibilidade === disp).length;
                const rotulos: Record<string, string> = { campinas: 'pronta entrega', sul: 'solicitar do sul', pendencia: 'pendência', null: 'indefinido' };
                const tons: Record<string, BadgeTone> = { campinas: 'success', sul: 'warning', pendencia: 'danger', null: 'neutral' };
                return { chave: String(disp), quantidade, rotulo: rotulos[String(disp)], tone: tons[String(disp)] };
            })
            .filter(item => item.quantidade > 0);
    }, [vendasExibidas]);

    // --- 3. FUNÇÕES DE NAVEGAÇÃO DOS BOTÕES ---
const setView = (newView: 'coleta' | 'pendencia') => {
        if (newView === 'pendencia') {
            setSearchParams({ view: 'pendencia' });
        } else {
            setSearchParams({});
        }
    };

const getEstoqueIndicator = (venda: Venda): { label: string; tone: BadgeTone } => {
    switch (venda.disponibilidade) {
        case 'campinas':
            return { label: 'Pronta entrega', tone: 'success' };
        case 'sul':
            return { label: 'Solicitar do sul', tone: 'warning' };
        case 'pendencia':
            return { label: 'Pendência de estoque', tone: 'danger' };
        default:
            return { label: 'Status indefinido', tone: 'neutral' };
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
        return (
            <AppLayout gap="md">
                <Card className="p-6 text-body text-ink-600">Carregando Vendas...</Card>
            </AppLayout>
        );
    }

    // --- Renderização Principal ---
    const formatarData = (iso: string) => {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return '';
        return `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    };

    const colunas = 'flex items-center gap-4 px-5 py-3.5';

    return (
        <AppLayout gap="md">
            <PageHeader
                breadcrumb="Vendas"
                title={view === 'coleta' ? 'Lista de coleta' : 'Lista de pendências'}
                subtitle="Vendas do Mercado Livre ainda não coletadas, consultadas a cada 10 minutos."
                actions={
                    <Button type="button" variant="secondary" onClick={() => handleGoBack()}>
                        ← Voltar
                    </Button>
                }
            />

            <div className="flex w-full flex-wrap items-center justify-between gap-4">
                <div className="flex gap-1 rounded-lg bg-line p-1" role="tablist" aria-label="Visão da lista">
                    <TabButton ativo={view === 'coleta'} onClick={() => setView('coleta')} rotulo="Para coleta" contagem={totalColeta} tom="info" />
                    <TabButton ativo={view === 'pendencia'} onClick={() => setView('pendencia')} rotulo="Pendências" contagem={totalPendencias} tom="danger" />
                </div>
                {resumo.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="text-body text-ink-600">Nesta lista:</span>
                        {resumo.map(item => (
                            <Badge key={item.chave} tone={item.tone}>{item.quantidade} {item.rotulo}</Badge>
                        ))}
                    </div>
                )}
            </div>

            {error && <ErrorAlert message={error} />}

            <Card className="w-full overflow-hidden">
                <div className="overflow-x-auto">
                    <div className="min-w-[1004px]">
                        <div className={`${colunas} bg-surface-sunken text-label font-semibold uppercase text-ink-600`}>
                            <span className="min-w-0 flex-1">Venda</span>
                            <span className="w-16 shrink-0">Qtd.</span>
                            <span className="w-[196px] shrink-0">Disponibilidade</span>
                            <span className="w-[120px] shrink-0">Data</span>
                            <span className="w-[150px] shrink-0 text-right">Valor e comissão</span>
                            <span className="w-[200px] shrink-0" />
                        </div>

                        {vendasExibidas.length === 0 ? (
                            <p className="border-t border-line px-5 py-6 text-body text-ink-400">
                                {view === 'coleta' ? 'Nenhuma roda aguardando coleta.' : 'Nenhuma venda com pendência de estoque.'}
                            </p>
                        ) : (
                            vendasExibidas.map((venda) => {
                                const indicator = getEstoqueIndicator(venda);
                                return (
                                    <div
                                        key={venda.id_venda}
                                        className={`${colunas} border-t border-line bg-surface-card`}
                                    >
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <span className="truncate font-mono text-code font-medium text-ink-900">{venda.sku}</span>
                                            <span className="text-body text-ink-600">
                                                Pedido {venda.id_venda} · Anúncio {venda.id_ml}
                                            </span>
                                        </div>
                                        <span className="w-16 shrink-0 text-body font-semibold text-ink-900">{venda.quantidade} un.</span>
                                        <span className="w-[196px] shrink-0">
                                            <Badge tone={indicator.tone}>{indicator.label}</Badge>
                                        </span>
                                        <span className="w-[120px] shrink-0 text-body text-ink-600">{formatarData(venda.data)}</span>
                                        <div className="flex w-[150px] shrink-0 flex-col items-end gap-0.5">
                                            <span className="text-body font-semibold text-ink-900">{formatCurrency(venda.valor)}</span>
                                            <span className="text-body text-danger">Comissão {formatCurrency(venda.comissao)}</span>
                                        </div>
                                        <div className="flex w-[200px] shrink-0 justify-end">
                                            {view === 'coleta' ? (
                                                <Button
                                                    type="button"
                                                    variant="secondary"
                                                    icon="✓"
                                                    onClick={() => handleMarcarComoColetado(venda.id_venda, setRawVendas, setError)}
                                                >
                                                    Marcar como coletada
                                                </Button>
                                            ) : (
                                                <span className="rounded-md border border-line px-3.5 py-2 text-body font-semibold text-ink-600">
                                                    Aguardando estoque
                                                </span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })
                        )}

                        <div className="flex items-center justify-between border-t border-line bg-surface-sunken px-5 py-3">
                            <span className="text-body text-ink-600">
                                {vendasExibidas.length === 1
                                    ? '1 venda aguardando coleta'
                                    : `${vendasExibidas.length} vendas aguardando coleta`}
                            </span>
                        </div>
                    </div>
                </div>
            </Card>
        </AppLayout>
    );
};

interface TabButtonProps {
    ativo: boolean;
    onClick: () => void;
    rotulo: string;
    contagem: number;
    tom: 'info' | 'danger';
}

const TabButton: React.FC<TabButtonProps> = ({ ativo, onClick, rotulo, contagem, tom }) => (
    <button
        type="button"
        role="tab"
        aria-selected={ativo}
        onClick={onClick}
        className={`flex items-center gap-2 rounded-md px-3.5 py-2 text-body cursor-pointer ${ativo ? 'bg-surface-card font-semibold text-ink-900 shadow-card' : 'text-ink-600'}`}
    >
        <span>{rotulo}</span>
        <span className={`rounded-full px-2 py-px text-label font-semibold ${tom === 'info' ? 'bg-brand-soft text-brand-strong' : 'bg-danger-soft text-danger'}`}>
            {contagem}
        </span>
    </button>
);

export default VendasPage;
