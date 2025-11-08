// src/pages/GerarPedidoPage.tsx

import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import api from '../services/api';
import { toast } from 'react-toastify'; // Usado para notificar a cópia

// Tipagem básica para os dados necessários
interface Venda {
    sku: string;
    quantidade: number;
    // ... outros campos (id_venda, etc.)
}

interface RodaDetalhe extends Venda {
    modelo: string;
    aro: string;
    pcd: string;
    offset: string;
    acabamento: string;
    precoCusto: number; 
    isLoaded: boolean;
    linhaRoda: string;
}

const LINHAS_RODA = ['Passeio', 'BAR','Linha M', '4x4', 'Linha Polida', 'Linha E', 'Linha L', 'Linha F', 'Linha G'];

const inferirLinha = (modelo: string, acabamento: string): string => {
    const modeloUpper = modelo.toUpperCase().trim();
    const acabamentoUpper = acabamento.toUpperCase().trim();

    // 1. Regra baseada no Acabamento (Precedência alta)
    if (acabamentoUpper.includes('POLIDA') || acabamentoUpper.includes('POL')) {
        return 'Linha Polida';
    }
    
    // 2. 🎯 NOVA REGRA: Linha BAR (Verifica se o nome do modelo está no Set)
    if (LINHA_BAR_MODELOS.has(modeloUpper)) {
        return 'BAR';
    }

    // 3. Regra baseada no Modelo (Prefixos)
    if (modeloUpper.startsWith('M')) {
        return 'Linha M';
    }
    if (modeloUpper.startsWith('E')) {
        return 'Linha E';
    }
    if (modeloUpper.startsWith('L')) {
        return 'Linha L';
    }
    if (modeloUpper.startsWith('F')) {
        return 'Linha F';
    }
    if (modeloUpper.startsWith('G')) {
        return 'Linha G';
    }

    // 4. Regra Padrão (Fallback)
    return 'Passeio';
};

const CUSTO_PASSEIO = {
    '13': 1540.00,
    '14': 1650.00,
    '15 T6': 1840.00,
    '15 T7/8': 2060.00,
    '16 T6': 2180.00,
    '17 T4/6/7': 2500.00,
    '18 T7': 3080.00,
    '18 T8': 3140.00,
    '20 T7.5': 3800.00,
    '20 T8': 3880.00,
};

// src/pages/GerarPedidoPage.tsx (Adicionar no escopo do arquivo)

const CUSTO_LINHA_M: Record<string, number> = {
    // Chave: 'CODIGO|ARO' ou apenas 'CODIGO'
    'M05|15': 2060.00,
    'M08|14': 2480.00,
    'M08|15': 2580.00,
    'M10|14': 2480.00,
    'M10|15': 2580.00,
    'M10|17': 3500.00,
    'M11|15': 2000.00,
    'M12': 3880.00, // Geral
    'M15': 3300.00, // Geral
    'M17|15': 2360.00,
    'M17|17': 2740.00,
    'M18': 1990.00, // Geral
    'M19': 2060.00, // Geral
    'M20|15': 2060.00,
    'M20|17': 2600.00,
    'M21|16': 2390.00,
    'M22|16': 3790.00,
    'M22|18': 4300.00,
    'M23|18': 3790.00,
    'M23|20': 4350.00,
    'M26': 2060.00, // Geral
    'M27|16': 4050.00,
    'M28|15': 1840.00,
    'M28|16': 2180.00,
    'M30|17': 2600.00,
    'M30|18': 3300.00,
    'M30|19': 4100.00,
    'M30|20': 4300.00,
    'M31|17': 3990.00, // Desempate
    'M31|20': 4990.00, // Desempate
    'M32': 2000.00, // Geral
    'M33': 6200.00, // Geral
    'M34': 4300.00, // Geral
};

// src/pages/GerarPedidoPage.tsx (Adicionar no escopo do arquivo)

const CUSTO_LINHA_BAR: Record<string, number> = {
    'ALFA|17': 2550.00,
    'AMG|18': 3435.00,
    'AMG|19': 3880.00,
    'ARION|19': 3880.00,
    'B20|15': 1940.00,
    'BALLINA|17': 2850.00,
    'BALLINA|18': 3100.00,
    'BMW|20': 3880.00,
    'CENTAURO|20': 3880.00,
    'DISCOVE|19': 3880.00,
    'FUCHS|17': 2700.00,
    'GLI|17': 2450.00,
    'GTS|18': 3570.00,
    'GTS|20': 3880.00,
    'MAGNA|18': 3210.00,
    'MK7|20': 4180.00,
    'MORGAN|15': 1940.00,
    'MORGAN|17': 2560.00,
    'MTB|16': 2890.00,
    'NEWSUN|15': 2140.00,
    'NEWSUN|17': 2550.00,
    'NEWSUN|18': 3200.00,
    'ORBITAL|17': 2390.00,
    'PINGO|15': 2440.00,
    'PINGO|17': 2970.00,
    'POLO|17': 2390.00,
    'PORSHE 914|17': 2550.00,
    'Q8|20': 3880.00,
    'SAMPSO|17': 2450.00,
    'SAMPSO|18': 3570.00,
    'SAMPSO|19': 3880.00,
    'STROLLE|18': 3570.00,
    'SUMMER|15': 2430.00,
    'SUMMER|17': 2550.00,
    'TARANT|15': 1940.00,
    'TE37|17': 2550.00,
    'TT|17': 2250.00,
    'VRS|15': 1940.00,
};

const LINHA_BAR_MODELOS = new Set(
    Object.keys(CUSTO_LINHA_BAR).map(key => key.split('|')[0])
);

const calcularPrecoCusto = (roda: RodaDetalhe): number => {
    
    // --- 1. DECLARAÇÃO ÚNICA: Extração de dados (INALTERADO) ---
    const linhaRoda = roda.linhaRoda;
    const modeloUpper = roda.modelo.toUpperCase().trim();
    
    // Extrai Aro e Tala
    const [aroString, talaString] = roda.aro.toUpperCase().split('X'); 
    const aro = parseInt(aroString, 10);
    const tala = parseFloat(talaString?.replace(',', '.') || '0'); 
    // -----------------------------------------------------------


    // --- 2. LÓGICA DE CUSTO SEQUENCIAL (if / else if) ---

    // 🎯 Bloco A: Linha PASSEIO
    if (linhaRoda === 'Passeio') {
        // AQUI VAI TODA A LÓGICA DO PASSEIO (ARO 20, 18, 17, etc.)
        
   if (aro === 20) {
            if (tala >= 8) return CUSTO_PASSEIO['20 T8'];
            if (tala >= 7.5) return CUSTO_PASSEIO['20 T7.5'];
        }

        // ARO 18
        if (aro === 18) {
            if (tala >= 8) return CUSTO_PASSEIO['18 T8'];
            if (tala >= 7) return CUSTO_PASSEIO['18 T7'];
        }
        
        // ARO 17
        if (aro === 17) {
            if (tala >= 4 && tala <= 7) return CUSTO_PASSEIO['17 T4/6/7'];
            return 2500.00; 
        }
        
        // ARO 16
        if (aro === 16) {
            return CUSTO_PASSEIO['16 T6'];
        }
        
        // ARO 15
        if (aro === 15) {
            if (tala >= 7) return CUSTO_PASSEIO['15 T7/8'];
            if (tala >= 6) return CUSTO_PASSEIO['15 T6'];
        }

        // ARO 14
        if (aro === 14) {
            return CUSTO_PASSEIO['14'];
        }

        // ARO 13
        if (aro === 13) {
            return CUSTO_PASSEIO['13'];
        }
        
        // 🎯 RETORNO SE NENHUMA REGRA ESPECÍFICA FOR ATENDIDA (Ex: ARO 19)
        return 0; 
    }
    
    // 🎯 Bloco B: Linha M
    else if (linhaRoda.includes('Linha M')) {
        const match = modeloUpper.match(/M\d{1,3}/);
        const codigoM = match ? match[0] : null;

        if (!codigoM) return 0;

        // Tentativa 1: Chave composta (CÓDIGO|ARO)
        const chaveComposta = `${codigoM}|${aro}`;
        if (CUSTO_LINHA_M[chaveComposta]) {
            return CUSTO_LINHA_M[chaveComposta];
        }

        // Tentativa 2: Código M geral
        if (CUSTO_LINHA_M[codigoM]) {
            return CUSTO_LINHA_M[codigoM];
        }
        return 0; // Fallback Linha M
    } 
    
    // 🎯 Bloco C: Linha BAR (Este bloco está OK)
    else if (linhaRoda === 'BAR') {
        // A lógica da Linha BAR se baseia no Modelo (normalizado) + Aro
        const chaveComposta = `${modeloUpper}|${aro}`;
        
        if (CUSTO_LINHA_BAR[chaveComposta]) {
            return CUSTO_LINHA_BAR[chaveComposta];
        }
        return 0; // Fallback Linha BAR
    }
 
    // [REMOVIDO O BLOCO DE LÓGICA DE PRECIFICAÇÃO DUPLICADO DA PARTE INFERIOR]
    
    return 0; // Retorno padrão se nenhuma regra for aplicada ou linha não for implementada
};

const GerarPedidoPage: React.FC = () => {
    const location = useLocation();
    const navigate = useNavigate();
    
    // Recebe a lista de vendas do state de navegação
    const vendasIniciais = location.state?.vendas || [];

    const [rodasPedido, setRodasPedido] = useState<RodaDetalhe[]>([]);
    const [loading, setLoading] = useState(true);
    const [textoPedido, setTextoPedido] = useState('');

    const recalcularPrecoParaNovaLinha = (rodaAtual: RodaDetalhe, novaLinha: string): number => {
    // 1. Cria um objeto temporário com a nova linha
    const rodaComNovaLinha = { ...rodaAtual, linhaRoda: novaLinha };
    
    // 2. Chama a função de cálculo de custo com o objeto temporário
    return calcularPrecoCusto(rodaComNovaLinha);
};

const handleLinhaChange = (sku: string, novaLinha: string) => {
    
    setRodasPedido(prev => prev.map(r => {
        if (r.sku === sku) {
            
            // Encontra o novo preço baseado na nova linha
            const novoPreco = recalcularPrecoParaNovaLinha(r, novaLinha);
            
            return { 
                ...r, 
                linhaRoda: novaLinha,
                precoCusto: novoPreco // 🎯 ATUALIZAÇÃO CHAVE
            };
        }
        return r;
    }));
};

    // --- LÓGICA DE BUSCA DE DETALHES ---
    useEffect(() => {
        if (vendasIniciais.length === 0) {
            alert("Nenhuma venda selecionada. Retornando ao dashboard.");
            navigate('/dashboard');
            return;
        }

const fetchDetalhes = async () => {
            const rodaPromessas = vendasIniciais.map(async (venda: Venda) => {
                const response = await api.get(`/stock/detalhes-roda-simples/${venda.sku}`);
                const detalhes = response.data;
                
                const linhaInferida = inferirLinha(detalhes.modelo, detalhes.acabamento);

                // 1. Calcula o preço de custo base (sem desconto)
                const precoBase = calcularPrecoCusto({ 
                    ...venda, 
                    ...detalhes, 
                    linhaRoda: linhaInferida 
                } as RodaDetalhe);
                
                // 2. 🎯 DEFINIÇÃO DA TAXA DE DESCONTO
                let fatorDesconto;
                if (linhaInferida === 'BAR') {
                    // 7% de desconto (Preço final = 93% do base)
                    fatorDesconto = 0.93; 
                } else {
                    // 8% de desconto (Preço final = 92% do base) - Aplica a todas as outras linhas
                    fatorDesconto = 0.92; 
                }
                
                // 3. APLICAÇÃO DO DESCONTO
                const precoComDesconto = precoBase * fatorDesconto;

                const precoFinalArredondado = Math.floor(precoComDesconto);

                return {
                    ...venda,
                    ...detalhes,
                    isLoaded: true,
                    linhaRoda: linhaInferida,
                    precoCusto: precoFinalArredondado // Usa o valor já com desconto condicional
                } as RodaDetalhe;
            });

            const detalhesCompletos = await Promise.all(rodaPromessas);
            
            // ... (restante do código) ...
            setRodasPedido(detalhesCompletos);
            setLoading(false);
        };

        fetchDetalhes();
    }, [vendasIniciais, navigate]);

    const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: 'BRL',
    }).format(value);
};

    // --- FUNÇÃO DE GERAÇÃO E FORMATAÇÃO DO TEXTO ---
const gerarTextoPedido = (rodas: RodaDetalhe[]): string => {
    const linhasPedido = rodas.map(roda => {
        
        // --- 🎯 CORREÇÃO: EXTRAÇÃO E FORMATAÇÃO DAS PARTES DA RODA ---
        
        // 1. Modelo Curto (Ex: AK2010 -> AK20)
        // Assume que o modelo é o que você quer no pedido (curto)
        const modeloCompleto = roda.modelo.toUpperCase().trim();
        
        // 2. Aro Numérico (Ex: 17X7.5 -> 17)
        // Pega a parte do aro antes do 'X' (Ex: '17')
        const aroNum = roda.aro.toUpperCase().split('X')[0].replace(/,/g, '.').trim(); 
        
        // 3. PCD Formatado (Ex: 5X100 -> 5X100)
        // Pega o PCD e padroniza o 'x' para 'X'
        const pcdFormatado = roda.pcd.toUpperCase().replace('X', 'X').trim(); 
        
        // 4. Acabamento Curto (Ex: BD (PRETO DIAMANTADO) -> BD)
        // Pega apenas a primeira palavra/código do acabamento
        const acabamentoCurto = roda.acabamento.split(' ')[0].toUpperCase().trim(); 

        const precoFormatado = formatCurrency(roda.precoCusto);

        // --- FIM DA EXTRAÇÃO ---
        
        // Retorna a linha do pedido: 04 S48 15 4X100 BD
        return `${String(roda.quantidade).padStart(2, '0')} ${modeloCompleto} ${aroNum} ${pcdFormatado} ${acabamentoCurto}\n${precoFormatado}\n`;
    }).join('\n');

    return `${linhasPedido}\nCliente Retira\n\nCheques`;
};
    
    // --- LÓGICA DE GERAÇÃO E CÓPIA FINAL ---
useEffect(() => {
        if (!loading) {
            // 🎯 CORREÇÃO: Usa todas as rodas carregadas, sem filtro de seleção.
            setTextoPedido(gerarTextoPedido(rodasPedido));
        }
    }, [rodasPedido, loading]);

    const handleCopy = () => {
        navigator.clipboard.writeText(textoPedido);
        toast.success('Pedido copiado!'); // Substitua por Toast ou similar
    };
    
    // --- Renderização ---
    if (loading) {
        return <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white">Preparando Pedido...</div>;
    }




    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            <header className="flex justify-between items-center mb-10 border-b border-gray-700 pb-4">
                <h1 className="text-4xl font-bold text-indigo-400">📝 Gerar Pedido ao Fornecedor</h1>
                <button
                    onClick={() => navigate(-1)} // Volta para a tela anterior
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-semibold transition"
                >
                    &larr; Voltar
                </button>
            </header>

            {/* Seção de Seleção */}
 <div className="mb-8 bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
    <h2 className="text-xl font-bold mb-4 text-indigo-400">Confirmação da Linha de Preço:</h2>
    <div className="space-y-4">
        {rodasPedido.map(roda => (
            <div key={roda.sku} className="flex justify-between items-center bg-gray-900 p-4 rounded-lg">
                
                {/* Detalhes da Roda */}
                <div className="flex-1 min-w-0">
                    <p className="text-lg font-semibold text-white truncate">{roda.sku} ({roda.quantidade} UNID.)</p>
                    <span className="text-sm text-gray-400">{roda.modelo} - {roda.acabamento}</span>
                </div>

                {/* Seletor de Linha (Edição) */}
        <div className="ml-4">
            <label htmlFor={`linha-${roda.sku}`} className="block text-xs font-medium text-gray-400">Linha Atual:</label>
            <select
                id={`linha-${roda.sku}`}
                value={roda.linhaRoda}
                onChange={(e) => handleLinhaChange(roda.sku, e.target.value)} 
                className="mt-1 block w-full py-2 px-3 border border-gray-700 bg-gray-700 rounded-md shadow-sm focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 text-white sm:text-sm"
            >
                {LINHAS_RODA.map(linha => (
                    <option key={linha} value={linha}>{linha}</option>
                ))}
            </select>
            
            {/* 🎯 EXIBIÇÃO DINÂMICA DO PREÇO DE CUSTO PARA CONFIRMAÇÃO */}
            <p className="text-sm font-semibold text-gray-300 mt-1">Custo: {formatCurrency(roda.precoCusto)}</p>

        </div>
            </div>
        ))}
    </div>
</div>

            {/* Resultado Final */}
<div className="bg-gray-800 p-6 rounded-xl shadow-lg border border-gray-700">
                <h2 className="text-xl font-bold mb-4">Texto Final do Pedido:</h2>
                <pre className="whitespace-pre-wrap bg-gray-900 p-4 rounded-lg text-green-400 text-sm font-mono">
                    {textoPedido}
                </pre>
                
                <button
                    onClick={handleCopy}
                    // O botão agora é habilitado se houver rodas carregadas
                    disabled={rodasPedido.length === 0} 
                    className="mt-4 px-6 py-3 bg-green-600 hover:bg-green-700 rounded-lg text-lg font-semibold transition disabled:bg-gray-500"
                >
                    Copiar Pedido ({rodasPedido.length} itens)
                </button>
            </div>
        </div>
    );
};

export default GerarPedidoPage;