// src/services/importacoesService.ts
//
// Cliente da importacao acompanhada.
//
// A instancia de api.ts tem timeout global de 10 segundos, adequado a consultas
// de painel. Aqui ele e sobreposto por requisicao: o envio carrega um PDF e
// espera a analise do arquivo inteiro, e as consultas de acompanhamento devem
// falhar rapido para o intervalo seguinte tentar de novo.

import api from './api';

export type EstadoImportacao =
    | 'analisando'
    | 'aguardando_confirmacao'
    | 'processando'
    | 'concluida'
    | 'falhou'
    | 'cancelada'
    | 'interrompida';

export type ResultadoEvento = 'atualizado' | 'ja_atualizado' | 'erro' | 'ignorado';

export interface ResumoAnalise {
    totalRodasNoPDF: number;
    atualizadasComSKU: number;
    semSKUNoBanco: number;
    novasNaoEncontradas: number;
    comSKUNaoCobertasPeloPDF: number;
}

export interface Importacao {
    id: number;
    store_id: number;
    origem: string;
    estado: EstadoImportacao;

    arquivo_nome: string | null;
    arquivo_bytes: number | null;
    arquivo_sha256: string;

    usuario_nome: string | null;

    criada_em: string;
    confirmada_em: string | null;
    iniciada_em: string | null;
    concluida_em: string | null;

    total_anuncios: number | null;
    processados: number;
    atualizados: number;
    ja_atualizados: number;
    erros: number;
    ignorados: number;

    resumo: ResumoAnalise | null;
    erro_mensagem: string | null;
    cancelamento_pedido: boolean;

    // derivados pelo servidor
    percentual?: number | null;
    vazao_por_segundo?: number | null;
    segundos_restantes?: number | null;
    em_voo?: boolean;
    retomavel?: boolean;
    soma_bate?: boolean;
}

export interface EventoImportacao {
    id: number;
    importacao_id: number;
    seq: number;
    criado_em: string;
    sku: string | null;
    ml_id: string | null;
    titulo: string | null;
    resultado: ResultadoEvento;
    status_http: number | null;
    quantidade_nova: number | null;
    motivo: string | null;
    duracao_ms: number | null;
}

export interface RespostaEventos {
    total: number;
    maior_seq: number;
    truncado: boolean;
    eventos: EventoImportacao[];
}

export class ConflitoDeArquivo extends Error {
    importacao: Importacao;
    constructor(mensagem: string, importacao: Importacao) {
        super(mensagem);
        this.name = 'ConflitoDeArquivo';
        this.importacao = importacao;
    }
}

// Ler o PDF e cruzar 1.613 linhas com o cadastro leva alguns segundos; cinco
// minutos e folga larga sobre o pior caso observado.
const TIMEOUT_ENVIO_MS = 300000;
// Consulta de acompanhamento: falhar rapido e tentar no proximo intervalo
const TIMEOUT_CONSULTA_MS = 15000;

export const enviarRelatorio = async (
    arquivo: File,
    onProgresso?: (percentual: number) => void
): Promise<Importacao> => {
    const corpo = new FormData();
    corpo.append('arquivo', arquivo);
    corpo.append('origem', 'upload_pdf');

    try {
        const resposta = await api.post('/importacoes', corpo, {
            timeout: TIMEOUT_ENVIO_MS,
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: (evento) => {
                if (!onProgresso || !evento.total) return;
                onProgresso(Math.round((evento.loaded / evento.total) * 100));
            }
        });
        return resposta.data.importacao;
    } catch (erro: any) {
        // 409: o mesmo arquivo ja tem importacao viva. Nao e falha, e protecao:
        // reenviar repetiria as chamadas ao Mercado Livre sem necessidade.
        if (erro?.response?.status === 409 && erro.response.data?.importacao) {
            throw new ConflitoDeArquivo(
                erro.response.data.error || 'Este arquivo ja foi enviado.',
                erro.response.data.importacao
            );
        }
        throw erro;
    }
};

export const obterImportacao = async (id: number): Promise<Importacao> => {
    const resposta = await api.get(`/importacoes/${id}`, { timeout: TIMEOUT_CONSULTA_MS });
    return resposta.data.importacao;
};

export const listarImportacoes = async (limite = 15): Promise<Importacao[]> => {
    const resposta = await api.get('/importacoes', {
        params: { limite },
        timeout: TIMEOUT_CONSULTA_MS
    });
    return resposta.data.importacoes;
};

/**
 * Busca incremental. Manda o maior ordinal que a tela ja tem e recebe apenas o
 * que chegou depois. Com ~980 eventos por execucao, refazer a lista a cada
 * consulta seria desperdicio.
 */
export const buscarEventos = async (
    id: number,
    desdeSeq: number,
    resultado?: ResultadoEvento,
    limite = 200,
    sinal?: AbortSignal
): Promise<RespostaEventos> => {
    const resposta = await api.get(`/importacoes/${id}/eventos`, {
        params: { desde_seq: desdeSeq, resultado, limite },
        timeout: TIMEOUT_CONSULTA_MS,
        signal: sinal
    });
    return resposta.data;
};

export const confirmarImportacao = async (id: number): Promise<Importacao> => {
    const resposta = await api.post(`/importacoes/${id}/confirmar`, {}, {
        timeout: TIMEOUT_CONSULTA_MS
    });
    return resposta.data.importacao;
};

export const retomarImportacao = async (id: number): Promise<Importacao> => {
    const resposta = await api.post(`/importacoes/${id}/retomar`, {}, {
        timeout: TIMEOUT_CONSULTA_MS
    });
    return resposta.data.importacao;
};

export const cancelarImportacao = async (id: number): Promise<Importacao> => {
    const resposta = await api.post(`/importacoes/${id}/cancelar`, {}, {
        timeout: TIMEOUT_CONSULTA_MS
    });
    return resposta.data.importacao;
};

// ------------------------------------------------------------------ formatacao

export const ESTADOS_TERMINAIS: EstadoImportacao[] =
    ['concluida', 'falhou', 'cancelada', 'interrompida'];

export const rotuloDoEstado = (estado: EstadoImportacao): string => ({
    analisando: 'Analisando o arquivo',
    aguardando_confirmacao: 'Aguardando sua confirmação',
    processando: 'Atualizando anúncios',
    concluida: 'Concluída',
    falhou: 'Falhou',
    cancelada: 'Cancelada',
    interrompida: 'Interrompida'
}[estado] || estado);

export const corDoEstado = (estado: EstadoImportacao): string => ({
    analisando: 'bg-blue-600',
    aguardando_confirmacao: 'bg-amber-500',
    processando: 'bg-indigo-600',
    concluida: 'bg-green-600',
    falhou: 'bg-red-600',
    cancelada: 'bg-gray-500',
    interrompida: 'bg-orange-600'
}[estado] || 'bg-gray-500');

export const rotuloDoResultado = (resultado: ResultadoEvento): string => ({
    atualizado: 'Atualizado',
    ja_atualizado: 'Recusado pelo ML',
    erro: 'Erro',
    ignorado: 'Ignorado'
}[resultado] || resultado);

export const corDoResultado = (resultado: ResultadoEvento): string => ({
    atualizado: 'text-green-400',
    ja_atualizado: 'text-amber-400',
    erro: 'text-red-400',
    ignorado: 'text-gray-400'
}[resultado] || 'text-gray-400');

export const formatarDuracao = (segundos: number | null | undefined): string => {
    if (segundos === null || segundos === undefined) return '--';
    if (segundos < 60) return `${segundos}s`;
    const minutos = Math.floor(segundos / 60);
    const resto = segundos % 60;
    if (minutos < 60) return `${minutos}min ${String(resto).padStart(2, '0')}s`;
    const horas = Math.floor(minutos / 60);
    return `${horas}h ${String(minutos % 60).padStart(2, '0')}min`;
};

export const formatarInstante = (iso: string | null): string => {
    if (!iso) return '--';
    return new Date(iso).toLocaleString('pt-BR', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
};
