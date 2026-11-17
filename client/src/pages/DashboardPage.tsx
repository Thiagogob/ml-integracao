import React, { useState, useEffect, useMemo } from 'react';
import { logout } from '../services/authService'; // Para a função de logout
import { useNavigate } from 'react-router-dom';
import Top5Card from '../components/ui/Top5Card';
import { toast } from 'react-toastify'; // Usado para notificar a cópia
import api from '../services/api'; 
import AtencaoCard from '../components/ui/AtencaoCard';
import AppLayout from '../components/ui/AppLayout';
import Badge from '../components/ui/Badge';
import type { BadgeTone } from '../components/ui/Badge';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import ErrorAlert from '../components/ui/ErrorAlert';
import PageHeader from '../components/ui/PageHeader';

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
    const [skusDispensados, setSkusDispensados] = useState<Set<string>>(new Set());


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

    
    const handleListarVendas = () => {
        navigate('/vendas'); 
    };

    // O botao do cabecalho dizia "Enviar estoque atualizado" mas chamava
    // handleListarVendas e levava para /vendas, no codigo e no redesenho.
    const handleImportarEstoque = () => {
        navigate('/importar-estoque');
    };

const top5AtencaoFiltrado = useMemo(() => {
        if (!data || !data.top5Atencao) return [];
        
        // 1. Filtrar os itens dispensados
        const listaFiltrada = data.top5Atencao.filter(item => !skusDispensados.has(item.sku));
        
        // 2. 🎯 NOVO: Limitar o resultado exibido aos 5 primeiros
        // O item que antes era Top 6 (agora Top 5) será carregado na lista.
        return listaFiltrada.slice(0, 5);
        
    }, [data, skusDispensados]);

    const handleDispensarRoda = (sku: string) => {
        setSkusDispensados(prevSet => {
            const novoSet = new Set(prevSet);
            novoSet.add(sku); // Adiciona o SKU dispensado
            return novoSet;
        });
        toast.info(`Atenção dispensada para o SKU ${sku}`);
    };


    if (loading) {
        return (
            <AppLayout>
                <Card className="p-6 text-body text-ink-600">Carregando Dashboard...</Card>
            </AppLayout>
        );
    }

    const sincronizacao = descreverSincronizacao(data?.ultimaSincronizacao);

    return (
        <AppLayout>
            <PageHeader
                title="Visão geral"
                subtitle="Resumo da operação de hoje, atualizado a cada consulta de vendas."
                actions={
                    <>
                        {/* Mantido o comportamento atual: o botao abre a lista de vendas (ver relatorio). */}
                        <Button type="button" variant="secondary" icon="⬆" onClick={handleImportarEstoque}>
                            Enviar estoque atualizado
                        </Button>
                        <Button type="button" icon="→" onClick={handleListarVendas}>
                            Listar rodas para coleta
                        </Button>
                    </>
                }
            />

            {error && <ErrorAlert message={error} />}

            {data ? (
                <>
                    <div className="grid w-full grid-cols-1 gap-6 md:grid-cols-3">
                        <KpiCard
                            label="Rodas vendidas hoje"
                            value={formatarNumero(data.rodasVendidasDia)}
                            footnote="Unidades de roda vendidas no dia"
                        />
                        <KpiCard
                            label="Rodas em estoque"
                            value={formatarNumero(data.totalRodasEmEstoque)}
                            footnote="Saldo consolidado de SP, SC e PR"
                        />
                        <KpiCard
                            label="Última sincronização"
                            value={sincronizacao.hora}
                            footnote={sincronizacao.nota}
                            badge={<Badge tone={sincronizacao.tom}>{sincronizacao.situacao}</Badge>}
                        />
                    </div>

                    <div className="flex w-full flex-col items-start gap-6 lg:flex-row">
                        {data.top5Vendas && <Top5Card data={data.top5Vendas} />}

                        {data.top5Atencao && data.top5Atencao.length > 0 && (
                            <AtencaoCard
                                data={top5AtencaoFiltrado}
                                onDispensar={handleDispensarRoda}
                            />
                        )}
                    </div>
                </>
            ) : (
                <Card className="p-6 text-body text-ink-400">Nenhum dado disponível.</Card>
            )}
        </AppLayout>
    );
};

const formatarNumero = (valor: number | string): string => {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero.toLocaleString('pt-BR') : String(valor);
};

// A API devolve so o horario do ponto de controle (last_sale_sync), ou 'N/A'.
// A situacao e calculada no cliente: a consulta roda a cada 10 minutos, entao ate 20 minutos esta em dia.
const descreverSincronizacao = (valor?: string) => {
    const data = valor ? new Date(valor) : null;
    if (!data || Number.isNaN(data.getTime())) {
        return { hora: 'N/A', nota: 'Consulta automática a cada 10 min', situacao: 'Sem registro', tom: 'neutral' as BadgeTone };
    }
    const minutos = (Date.now() - data.getTime()) / 60000;
    return {
        hora: data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        nota: `${data.toLocaleDateString('pt-BR')} · consulta automática a cada 10 min`,
        situacao: minutos <= 20 ? 'Em dia' : 'Atrasada',
        tom: (minutos <= 20 ? 'success' : 'warning') as BadgeTone,
    };
};

interface KpiCardProps {
    label: string;
    value: string;
    footnote: string;
    badge?: React.ReactNode;
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, footnote, badge }) => (
    <Card className="flex flex-col gap-2 p-6">
        <div className="flex h-6 items-center justify-between">
            <p className="text-label font-semibold uppercase text-ink-600">{label}</p>
            {badge}
        </div>
        <p className="text-kpi font-bold text-ink-900">{value}</p>
        <p className="text-body text-ink-400">{footnote}</p>
    </Card>
);

export default DashboardPage;
