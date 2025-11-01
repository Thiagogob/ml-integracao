import React from 'react';

interface TopVenda {
    sku: string;
    total_vendido: number;
}

interface Top5Props {
    data: TopVenda[];
}

const Top5Card: React.FC<Top5Props> = ({ data }) => {
    return (
        <div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700 col-span-1 md:col-span-3">
            <h2 className="text-xl font-bold text-indigo-400 mb-4">🏆 Top 5 Rodas Mais Vendidas (Últimos 15 Dias)</h2>
            
            {data.length === 0 ? (
                <p className="text-gray-400 text-center">Nenhuma venda de roda registrada nos últimos 15 dias.</p>
            ) : (
                <ul className="space-y-2"> 
                    {data.map((item, index) => (
                        <li 
                            key={item.sku} 
                            className="flex justify-between items-center py-2 px-3 bg-gray-700/50 rounded-lg hover:bg-gray-700 transition"
                        >
                            <span className="text-base font-semibold text-white"> 
                                #{index + 1} - {item.sku}
                            </span>
                            <span className="text-base font-extrabold text-green-400"> 
                                {item.total_vendido} VENDAS
                            </span>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
};

export default Top5Card;