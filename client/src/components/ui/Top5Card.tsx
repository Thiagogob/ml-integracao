import React from 'react';
import Card from './Card';
import Badge from './Badge';

interface TopVenda {
    sku: string;
    total_vendido: number;
}

interface Top5Props {
    data: TopVenda[];
}

const Top5Card: React.FC<Top5Props> = ({ data }) => {
    // A barra de cada item e proporcional ao mais vendido da lista.
    const maior = Math.max(1, ...data.map(item => Number(item.total_vendido) || 0));

    return (
        <Card className="flex flex-1 flex-col gap-4 p-6">
            <div className="flex items-center justify-between">
                <h2 className="text-heading font-semibold text-ink-900">Mais vendidas</h2>
                <Badge tone="info">Últimos 15 dias</Badge>
            </div>

            {data.length === 0 ? (
                <p className="text-body text-ink-400">Nenhuma venda de roda registrada nos últimos 15 dias.</p>
            ) : (
                <ol className="flex flex-col gap-3">
                    {data.map((item, index) => (
                        <li key={item.sku} className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between gap-2.5">
                                <div className="flex min-w-0 items-center gap-2.5">
                                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-label font-semibold text-brand-strong">
                                        {index + 1}
                                    </span>
                                    <span className="truncate font-mono text-code font-medium text-ink-900">{item.sku}</span>
                                </div>
                                <span className="shrink-0 text-body font-semibold text-ink-900">{item.total_vendido} vendas</span>
                            </div>
                            <div className="h-1.5 w-full rounded-full bg-neutral-soft">
                                <div
                                    className="h-1.5 rounded-full bg-brand"
                                    style={{ width: `${(Number(item.total_vendido) / maior) * 100}%` }}
                                />
                            </div>
                        </li>
                    ))}
                </ol>
            )}
        </Card>
    );
};

export default Top5Card;
