// src/components/AtencaoCard.tsx

import React from 'react';
import Card from './Card';
import Badge from './Badge';

interface AtencaoRodas {
    sku: string;
    total_pedidos_15dias: number;
    qtde_estoque_total: number;
    indice_atencao: string;
}

interface AtencaoCardProps {
    data: AtencaoRodas[];
    onDispensar: (sku: string) => void;
}

// O indice vem do PostgreSQL como NUMERIC em string, sem arredondamento.
const formatarIndice = (valor: string): string => {
    const numero = Number(valor);
    return Number.isFinite(numero) ? numero.toFixed(2) : valor;
};

const AtencaoCard: React.FC<AtencaoCardProps> = ({ data, onDispensar }) => {
    return (
        <Card className="flex flex-1 flex-col gap-4 p-6">
            <div className="flex items-center justify-between">
                <h2 className="text-heading font-semibold text-ink-900">Precisam de atenção</h2>
                <Badge tone="danger">Risco de esgotar</Badge>
            </div>
            <p className="text-body text-ink-600">
                Índice de atenção = rodas vendidas em 15 dias ÷ estoque total. Quanto maior, mais rápido o saldo acaba.
            </p>

            {data.length === 0 ? (
                <p className="text-body text-ink-400">Nenhuma roda em risco de esgotamento nos últimos 15 dias.</p>
            ) : (
                <ul className="flex flex-col gap-2">
                    {data.map((item, index) => (
                        <li
                            key={item.sku}
                            className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface-sunken px-3 py-2.5"
                        >
                            <div className="flex min-w-0 flex-col gap-0.5">
                                <span className="truncate font-mono text-code font-medium text-ink-900 whitespace-pre">
                                    {`#${index + 1}  ${item.sku}`}
                                </span>
                                <span className="text-body text-ink-600">
                                    {item.total_pedidos_15dias} pedidos em 15 dias · {item.qtde_estoque_total} no estoque total
                                </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-3">
                                <Badge tone={Number(item.indice_atencao) >= 1 ? 'danger' : 'warning'}>
                                    Índice {formatarIndice(item.indice_atencao)}
                                </Badge>
                                <button
                                    type="button"
                                    onClick={() => onDispensar(item.sku)}
                                    className="inline-flex items-center gap-2 rounded-md border border-line bg-surface-card px-3.5 py-2 text-body font-semibold text-ink-900 hover:opacity-90 cursor-pointer"
                                >
                                    <span aria-hidden="true">✕</span>
                                    <span>Dispensar</span>
                                </button>
                            </div>
                        </li>
                    ))}
                </ul>
            )}

            <p className="text-label font-semibold text-ink-400">
                Dispensar oculta o item nesta sessão e o próximo da fila ocupa a vaga.
            </p>
        </Card>
    );
};

export default AtencaoCard;
