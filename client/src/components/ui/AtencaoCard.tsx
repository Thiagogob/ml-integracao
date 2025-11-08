// src/components/AtencaoCard.tsx

import React from 'react';
import { Trash2 } from 'lucide-react';

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

const AtencaoCard: React.FC<AtencaoCardProps> = ({ data, onDispensar }) => {
    return (
        <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 col-span-1 md:col-span-3">
            <h2 className="text-xl font-bold text-red-500 mb-4">🚨 Rodas que Precisam de Atenção (Maior Risco)</h2>
            
            {data.length === 0 ? (
                <p className="text-gray-400 text-center">Nenhuma roda em risco de esgotamento nos últimos 15 dias.</p>
            ) : (
                <ul className="space-y-2">
                    {data.map((item, index) => (
                        
                        // 🎯 ITEM PRINCIPAL: Usamos 'group' para o hover
                        <li 
                            key={item.sku} 
                            // O botão de dispensar será a margem esquerda inteira
                            onClick={() => onDispensar(item.sku)}
                            
                            // Adicionamos 'group' e ajustamos a borda para ser interna
                            className="group relative flex justify-between items-center py-2 pl-4 pr-3 bg-gray-700/50 rounded-lg transition hover:bg-gray-700 cursor-pointer overflow-hidden"
                        >
                            
                            {/* 1. MARGEM/BOTÃO DE DISPENSA (ELEMENTO DE FUNDO EXPANSIVO) */}
                            <div
                                // O elemento começa estreito (4px) e expande (para w-20, por exemplo)
                                className="absolute left-0 top-0 bottom-0 
                                           bg-red-700 w-1 transition-all duration-300 ease-in-out 
                                           group-hover:w-full group-hover:bg-red-800/80 
                                           flex items-center justify-start px-2"
                            >
                                {/* ÍCONE DE LIXEIRA (Aparece no hover) */}
                                <Trash2 
                                    className="h-5 w-5 text-white opacity-0 transition duration-300 group-hover:opacity-100" 
                                />
                            </div>

                            {/* 2. CONTEÚDO PRINCIPAL (MANTIDO) */}
                            <div className="flex-1 z-10 flex justify-between items-center">
                                
                                {/* SKU e Pedidos */}
                                <div className="flex-1">
                                    <span className="text-base font-semibold text-white block">
                                        #{index + 1} - {item.sku}
                                    </span>
                                    <span className="text-sm text-gray-400">
                                        {item.total_pedidos_15dias} pedidos em 15 dias
                                    </span>
                                </div>
                                
                                {/* Estoque e Índice */}
                                <div className="flex items-center space-x-4">
                                    <div className="text-right">
                                        <span className="text-lg font-extrabold text-yellow-400 block">
                                            {item.indice_atencao}
                                        </span>
                                        <span className="text-sm text-gray-400">
                                            ({item.qtde_estoque_total} no estoque total)
                                        </span>
                                    </div>
                                </div>
                            </div>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default AtencaoCard;