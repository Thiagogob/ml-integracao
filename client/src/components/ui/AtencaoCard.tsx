// src/components/AtencaoCard.tsx

import React from 'react';

interface AtencaoRodas {
    sku: string;
    total_pedidos_15dias: number;
    qtde_estoque_total: number;
    indice_atencao: string; 
}

interface AtencaoCardProps {
    data: AtencaoRodas[];
}

const AtencaoCard: React.FC<AtencaoCardProps> = ({ data }) => {
    return (
        <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 col-span-1 md:col-span-3">
            <h2 className="text-xl font-bold text-red-500 mb-4">🚨 Rodas que Precisam de Atenção (Maior Risco)</h2>
            
            {data.length === 0 ? (
                <p className="text-gray-400 text-center">Nenhuma roda em risco de esgotamento nos últimos 15 dias.</p>
            ) : (
                <ul className="space-y-2">
                    {data.map((item, index) => (
                        <li 
                            key={item.sku} 
                            className="flex justify-between items-center py-2 px-3 bg-gray-700/50 rounded-lg transition hover:bg-gray-700 border-l-4 border-red-500"
                        >
                            {/* SKU e Vendas */}
                            <div className="flex-1">
                                <span className="text-base font-semibold text-white block">
                                    #{index + 1} - {item.sku}
                                </span>
                                <span className="text-sm text-gray-400">
                                    {item.total_pedidos_15dias} pedidos em 15 dias
                                </span>
                            </div>
                            
                            {/* Estoque e Índice */}
                            <div className="text-right">
                                <span className="text-lg font-extrabold text-yellow-400 block">
                                    {item.indice_atencao}
                                </span>
                                <span className="text-sm text-gray-400">
                                    ({item.qtde_estoque_total} no estoque total)
                                </span>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default AtencaoCard;