// src/pages/ImportacaoEstoquePage.tsx
//
// Importacao acompanhada do relatorio de estoque.
//
// A tela tem tres momentos, que espelham a maquina de estados do servidor:
//
//   1. Envio          escolher o PDF
//   2. Conferencia    ver o que mudaria e autorizar, ou desistir
//   3. Acompanhamento barra, contadores, estimativa e a lista de anuncios
//
// A conferencia e o passo que justifica a tela. Antes dela nada e gravado e
// nenhum anuncio e tocado; e a ultima chance de perceber que o arquivo esta
// errado antes de ~980 chamadas ao Mercado Livre.
//
// Visual conforme os boards "Tela / Importacao - Conferencia" e
// "Tela / Importacao - Acompanhamento" do arquivo Penpot, pagina "Telas".

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import AppLayout from '../components/ui/AppLayout';
import PageHeader from '../components/ui/PageHeader';
import Card from '../components/ui/Card';
import Button from '../components/ui/Button';
import Badge, { type BadgeTone } from '../components/ui/Badge';
import {
    enviarRelatorio, obterImportacao, listarImportacoes, buscarEventos,
    confirmarImportacao, retomarImportacao, cancelarImportacao,
    ConflitoDeArquivo, ESTADOS_TERMINAIS,
    rotuloDoEstado, rotuloDoResultado, formatarDuracao, formatarInstante,
    type Importacao, type EventoImportacao, type ResultadoEvento, type EstadoImportacao
} from '../services/importacoesService';

// Intervalo de consulta. Dois segundos acompanha de perto sem pesar: com 500 ms
// deliberados entre anuncios, cada consulta traz de dois a quatro eventos.
const INTERVALO_CONSULTA_MS = 2000;
// Quantos eventos manter na lista. Com ~980 por execucao, segurar todos no DOM
// travaria a pagina; os mais antigos seguem contados, apenas nao desenhados.
const EVENTOS_NA_TELA = 120;

const FILTROS: Array<{ valor: ResultadoEvento | 'todos'; rotulo: string }> = [
    { valor: 'todos', rotulo: 'Todos' },
    { valor: 'atualizado', rotulo: 'Atualizados' },
    { valor: 'ja_atualizado', rotulo: 'Recusados pelo ML' },
    { valor: 'erro', rotulo: 'Com erro' },
    { valor: 'ignorado', rotulo: 'Ignorados' }
];

/**
 * Junta o que chegou com o que a tela ja tinha, do ordinal maior para o menor e
 * sem repetir. Desduplicar e necessario porque dois efeitos consultam na
 * montagem, o do filtro e o do acompanhamento, e ambos partem do ordinal zero.
 */
const juntarEventos = (anteriores: EventoImportacao[], novos: EventoImportacao[]): EventoImportacao[] => {
    const porSeq = new Map<number, EventoImportacao>();
    for (const e of anteriores) porSeq.set(e.seq, e);
    for (const e of novos) porSeq.set(e.seq, e);
    return [...porSeq.values()].sort((a, b) => b.seq - a.seq).slice(0, EVENTOS_NA_TELA);
};

const TOM_DO_ESTADO: Record<EstadoImportacao, BadgeTone> = {
    analisando: 'info',
    aguardando_confirmacao: 'warning',
    processando: 'info',
    concluida: 'success',
    falhou: 'danger',
    cancelada: 'neutral',
    interrompida: 'warning'
};

const TOM_DO_RESULTADO: Record<ResultadoEvento, BadgeTone> = {
    atualizado: 'success',
    ja_atualizado: 'warning',
    erro: 'danger',
    ignorado: 'neutral'
};

// Bloco numerico do diagnostico e dos contadores
const Numero: React.FC<{
    rotulo: string; valor: React.ReactNode; nota: string; cor?: string; titulo?: string;
}> = ({ rotulo, valor, nota, cor = 'text-ink-900', titulo }) => (
    <Card className="flex min-w-0 flex-1 flex-col gap-1.5 px-[18px] py-5">
        <span className="text-label font-semibold uppercase text-ink-600" title={titulo}>{rotulo}</span>
        <span className={`text-kpi font-bold ${cor}`}>{valor}</span>
        <span className="text-label text-ink-400">{nota}</span>
    </Card>
);

const ImportacaoEstoquePage: React.FC = () => {
    const navigate = useNavigate();

    const [arquivo, setArquivo] = useState<File | null>(null);
    const [arrastando, setArrastando] = useState(false);
    const [enviando, setEnviando] = useState(false);
    const [percentualEnvio, setPercentualEnvio] = useState(0);

    const [atual, setAtual] = useState<Importacao | null>(null);
    const [eventos, setEventos] = useState<EventoImportacao[]>([]);
    const [filtro, setFiltro] = useState<ResultadoEvento | 'todos'>('todos');
    const [historico, setHistorico] = useState<Importacao[]>([]);
    const [agindo, setAgindo] = useState(false);

    // Maior ordinal ja recebido. Fica em ref, nao em estado, para o laco de
    // consulta nao se reconstruir a cada evento que chega.
    const maiorSeq = useRef(0);
    const abortar = useRef<AbortController | null>(null);
    const seletor = useRef<HTMLInputElement | null>(null);

    const emVoo = atual ? (atual.estado === 'processando' || atual.estado === 'analisando') : false;
    const naEscolha = !atual || ESTADOS_TERMINAIS.includes(atual.estado);

    // ------------------------------------------------------------- historico

    const recarregarHistorico = useCallback(async () => {
        try {
            setHistorico(await listarImportacoes(15));
        } catch {
            // historico e acessorio: falhar aqui nao deve atrapalhar o resto
        }
    }, []);

    useEffect(() => { recarregarHistorico(); }, [recarregarHistorico]);

    // Se houver importacao em voo ou esperando confirmacao, a tela assume: o
    // operador pode ter fechado o navegador no meio.
    useEffect(() => {
        const pendente = historico.find((i) => !ESTADOS_TERMINAIS.includes(i.estado));
        if (pendente && !atual) {
            setAtual(pendente);
            maiorSeq.current = 0;
            setEventos([]);
        }
    }, [historico, atual]);

    // ------------------------------------------------------- acompanhamento

    useEffect(() => {
        if (!atual || !emVoo) return;

        let vivo = true;
        const id = atual.id;

        const consultar = async () => {
            try {
                const estado = await obterImportacao(id);
                if (!vivo) return;
                setAtual(estado);

                abortar.current?.abort();
                abortar.current = new AbortController();

                // busca incremental: so o que chegou depois do ultimo ordinal
                const pagina = await buscarEventos(
                    id, maiorSeq.current,
                    filtro === 'todos' ? undefined : filtro,
                    200, abortar.current.signal
                );
                if (!vivo) return;

                if (pagina.eventos.length > 0) {
                    maiorSeq.current = Math.max(maiorSeq.current, pagina.maior_seq);
                    setEventos((anteriores) => juntarEventos(anteriores, pagina.eventos));
                }

                if (ESTADOS_TERMINAIS.includes(estado.estado)) recarregarHistorico();
            } catch (erro: any) {
                if (erro?.name === 'CanceledError' || erro?.code === 'ERR_CANCELED') return;
                // Falha de rede nao derruba o acompanhamento: o intervalo
                // seguinte tenta de novo. Uma execucao dura mais de oito
                // minutos e nao pode ser abandonada por um soluco de rede.
                console.warn('consulta de acompanhamento falhou; tentando de novo', erro);
            }
        };

        consultar();
        const temporizador = setInterval(consultar, INTERVALO_CONSULTA_MS);
        return () => {
            vivo = false;
            clearInterval(temporizador);
            abortar.current?.abort();
        };
    }, [atual?.id, emVoo, filtro, recarregarHistorico]);

    // Trocar o filtro recomeca a lista, porque o ordinal de corte muda de sentido
    useEffect(() => {
        if (!atual) return;
        maiorSeq.current = 0;
        setEventos([]);
        buscarEventos(atual.id, 0, filtro === 'todos' ? undefined : filtro, 200)
            .then((pagina) => {
                maiorSeq.current = pagina.maior_seq;
                setEventos(juntarEventos([], pagina.eventos));
            })
            .catch(() => {});
    }, [filtro, atual?.id]);

    // ------------------------------------------------------------------ acoes

    const escolher = (lista: FileList | null) => {
        const escolhido = lista?.[0];
        if (!escolhido) return;
        if (!escolhido.name.toLowerCase().endsWith('.pdf')) {
            toast.error('Envie o relatório em PDF.');
            return;
        }
        setArquivo(escolhido);
    };

    const enviar = async () => {
        if (!arquivo) return;
        setEnviando(true);
        setPercentualEnvio(0);
        try {
            const importacao = await enviarRelatorio(arquivo, setPercentualEnvio);
            setAtual(importacao);
            setEventos([]);
            maiorSeq.current = 0;
            setArquivo(null);
            if (seletor.current) seletor.current.value = '';
            recarregarHistorico();
            toast.success('Arquivo analisado. Confira o resumo antes de autorizar.');
        } catch (erro: any) {
            if (erro instanceof ConflitoDeArquivo) {
                setAtual(erro.importacao);
                toast.warn('Este mesmo arquivo já tem uma importação. Abri ela para você.');
                recarregarHistorico();
            } else {
                toast.error(`Falha no envio: ${erro?.response?.data?.error || erro?.message}`);
            }
        } finally {
            setEnviando(false);
        }
    };

    const executarAcao = async (acao: (id: number) => Promise<Importacao>, mensagem: string) => {
        if (!atual) return;
        setAgindo(true);
        try {
            setAtual(await acao(atual.id));
            toast.success(mensagem);
            recarregarHistorico();
        } catch (erro: any) {
            toast.error(erro?.response?.data?.error || 'Não foi possível concluir a ação.');
            // realinha com o servidor, que e a autoridade sobre o estado
            try { setAtual(await obterImportacao(atual.id)); } catch { /* nada */ }
        } finally {
            setAgindo(false);
        }
    };

    const abrir = async (id: number) => {
        try {
            setAtual(await obterImportacao(id));
            maiorSeq.current = 0;
            setEventos([]);
        } catch {
            toast.error('Não foi possível abrir essa importação.');
        }
    };

    // ---------------------------------------------------------------- derivados

    const alerta = useMemo(() => {
        if (!atual?.resumo) return null;
        const r = atual.resumo;
        const proporcao = r.totalRodasNoPDF > 0
            ? Math.round((r.semSKUNoBanco / r.totalRodasNoPDF) * 100) : 0;
        if (proporcao < 40) return null;
        return `${r.semSKUNoBanco.toLocaleString('pt-BR')} das ${r.totalRodasNoPDF.toLocaleString('pt-BR')} linhas do relatório (${proporcao}%) não têm SKU no cadastro e não chegam a nenhum anúncio.`;
    }, [atual]);

    const acoesDoCabecalho = (
        <Button type="button" variant="secondary" onClick={() => navigate('/dashboard')}>
            ← Voltar
        </Button>
    );

    // ------------------------------------------------------------------ render

    return (
        <AppLayout>
            <PageHeader
                breadcrumb="Estoque"
                title={atual?.estado === 'processando' ? 'Importando relatório de estoque' : 'Importar relatório de estoque'}
                subtitle={atual?.estado === 'processando'
                    ? 'A execução segue no servidor. Você pode fechar esta página e voltar depois.'
                    : 'O arquivo é conferido antes de qualquer alteração. Nada é gravado sem a sua autorização.'}
                actions={acoesDoCabecalho}
            />

            {/* ---------------------------------------------------- 1. ENVIO */}
            {naEscolha && (
                <div className="flex flex-col gap-4">
                    <div
                        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
                        onDragLeave={() => setArrastando(false)}
                        onDrop={(e) => { e.preventDefault(); setArrastando(false); escolher(e.dataTransfer.files); }}
                        onClick={() => seletor.current?.click()}
                        className={`flex cursor-pointer flex-col items-center gap-1.5 rounded-xl border-2 border-dashed px-10 py-10 text-center transition-colors ${
                            arrastando ? 'border-brand bg-brand-soft' : 'border-line bg-surface-card'
                        }`}
                    >
                        <input
                            ref={seletor}
                            type="file"
                            accept="application/pdf,.pdf"
                            className="hidden"
                            onChange={(e) => escolher(e.target.files)}
                        />
                        {arquivo ? (
                            <>
                                <span className="text-heading font-semibold text-ink-900">{arquivo.name}</span>
                                <span className="text-body text-ink-400">{(arquivo.size / 1024).toFixed(0)} KB</span>
                            </>
                        ) : (
                            <>
                                <span className="text-heading text-ink-900">Arraste o PDF do relatório aqui, ou clique para escolher</span>
                                <span className="text-body text-ink-400">Somente PDF, até 100 MB</span>
                            </>
                        )}
                    </div>

                    {arquivo && (
                        <div className="flex flex-wrap items-center gap-3">
                            <Button type="button" onClick={enviar} isLoading={enviando && percentualEnvio >= 100} disabled={enviando}>
                                {enviando && percentualEnvio < 100 ? `Enviando ${percentualEnvio}%` : 'Conferir o arquivo'}
                            </Button>
                            <Button
                                type="button" variant="secondary" disabled={enviando}
                                onClick={() => { setArquivo(null); if (seletor.current) seletor.current.value = ''; }}
                            >
                                Trocar
                            </Button>
                            <span className="text-label text-ink-400">
                                A conferência não grava nada e não toca em nenhum anúncio.
                            </span>
                        </div>
                    )}
                </div>
            )}

            {/* ------------------------------------- 2. CONFERENCIA E ESTADO */}
            {atual && (
                <Card className="flex flex-col gap-4 p-6">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="flex min-w-0 flex-col gap-2">
                            <div className="flex flex-wrap items-center gap-2.5">
                                <Badge tone={TOM_DO_ESTADO[atual.estado]}>{rotuloDoEstado(atual.estado)}</Badge>
                                <span className="text-body text-ink-400">importação #{atual.id}</span>
                            </div>
                            <span className="text-heading font-semibold text-ink-900">{atual.arquivo_nome}</span>
                            <span className="text-label text-ink-400">
                                <span className="font-mono">sha256 {atual.arquivo_sha256.slice(0, 16)}…</span>
                                {atual.arquivo_bytes ? `  ·  ${(atual.arquivo_bytes / 1024).toFixed(0)} KB` : ''}
                                {`  ·  ${formatarInstante(atual.criada_em)}`}
                                {atual.usuario_nome ? ` por ${atual.usuario_nome}` : ''}
                            </span>
                        </div>

                        <div className="flex flex-wrap items-center gap-2.5">
                            {atual.estado === 'aguardando_confirmacao' && (
                                <>
                                    <Button type="button" variant="secondary" disabled={agindo}
                                        onClick={() => executarAcao(cancelarImportacao, 'Importação descartada.')}>
                                        Descartar
                                    </Button>
                                    <Button type="button" variant="success" disabled={agindo}
                                        onClick={() => executarAcao(confirmarImportacao, 'Importação autorizada.')}>
                                        Autorizar e atualizar {(atual.total_anuncios ?? 0).toLocaleString('pt-BR')} anúncios
                                    </Button>
                                </>
                            )}
                            {atual.estado === 'processando' && (
                                <Button type="button" variant="danger" disabled={agindo || atual.cancelamento_pedido}
                                    onClick={() => executarAcao(cancelarImportacao, 'Cancelamento pedido. O laço para no próximo anúncio.')}>
                                    {atual.cancelamento_pedido ? 'Parando...' : 'Cancelar'}
                                </Button>
                            )}
                            {atual.estado === 'interrompida' && (
                                <Button type="button" disabled={agindo}
                                    onClick={() => executarAcao(retomarImportacao, 'Retomando de onde parou.')}>
                                    Retomar de onde parou
                                </Button>
                            )}
                        </div>
                    </div>

                    {/* barra de progresso */}
                    {(atual.estado === 'processando' || atual.processados > 0) && (
                        <div className="flex flex-col gap-2.5">
                            <div className="flex flex-wrap items-center justify-between gap-3">
                                <span className="text-body font-semibold text-ink-900">
                                    {atual.processados.toLocaleString('pt-BR')} de {(atual.total_anuncios ?? 0).toLocaleString('pt-BR')} anúncios
                                </span>
                                <span className="text-label text-ink-400">
                                    {atual.percentual != null ? `${atual.percentual}%` : ''}
                                    {atual.estado === 'processando' && atual.segundos_restantes != null
                                        ? `  ·  faltam cerca de ${formatarDuracao(atual.segundos_restantes)}` : ''}
                                    {atual.vazao_por_segundo ? `  ·  ${atual.vazao_por_segundo}/s` : ''}
                                </span>
                            </div>
                            <div className="h-2.5 w-full overflow-hidden rounded-full bg-line">
                                <div
                                    className={`h-full rounded-full transition-all duration-500 ${
                                        atual.estado === 'processando' ? 'bg-brand'
                                        : atual.estado === 'concluida' ? 'bg-success' : 'bg-warning'
                                    }`}
                                    style={{ width: `${atual.percentual ?? 0}%` }}
                                />
                            </div>
                        </div>
                    )}

                    {atual.erro_mensagem && (
                        <div className="rounded-md bg-danger-soft px-3.5 py-3 text-body text-danger" role="alert">
                            {atual.erro_mensagem}
                        </div>
                    )}

                    {atual.soma_bate === false && (
                        <div className="rounded-md bg-danger-soft px-3.5 py-3 text-body text-danger" role="alert">
                            Os contadores desta importação não fecham com o total processado. Isso não
                            deveria acontecer: avise o responsável pelo sistema.
                        </div>
                    )}
                </Card>
            )}

            {/* diagnostico da conferencia */}
            {atual?.resumo && (
                <section className="flex flex-col gap-3">
                    <h2 className="text-label font-semibold uppercase text-ink-600">
                        {atual.estado === 'aguardando_confirmacao' ? 'O que este arquivo faria' : 'O que este arquivo trouxe'}
                    </h2>
                    <div className="flex flex-wrap gap-4">
                        <Numero rotulo="Linhas no PDF" valor={atual.resumo.totalRodasNoPDF.toLocaleString('pt-BR')} nota="Rodas lidas do relatório" />
                        <Numero rotulo="Com cadastro" valor={atual.resumo.atualizadasComSKU.toLocaleString('pt-BR')} nota="Chegam a algum anúncio"
                            cor="text-success" titulo="Rodas cujo código existe no cadastro" />
                        <Numero rotulo="Sem SKU" valor={atual.resumo.semSKUNoBanco.toLocaleString('pt-BR')} nota="Não chegam a anúncio"
                            cor="text-warning" titulo="Linhas do relatório sem SKU no cadastro" />
                        <Numero rotulo="Não cobertas" valor={atual.resumo.comSKUNaoCobertasPeloPDF.toLocaleString('pt-BR')} nota="No cadastro e fora do relatório"
                            cor="text-warning" />
                        <Numero rotulo="Anúncios a tocar" valor={atual.total_anuncios != null ? atual.total_anuncios.toLocaleString('pt-BR') : '--'} nota="Envios ao Mercado Livre"
                            cor="text-brand-strong" />
                    </div>

                    {alerta && atual.estado === 'aguardando_confirmacao' && (
                        <div className="flex items-start gap-2.5 rounded-lg border border-warning-soft bg-warning-soft px-4 py-3.5 text-body text-warning">
                            <span className="font-bold" aria-hidden="true">!</span>
                            <span><b>Confira antes de autorizar.</b> {alerta}</span>
                        </div>
                    )}

                    {atual.estado === 'aguardando_confirmacao' && atual.total_anuncios ? (
                        <p className="text-label text-ink-400">
                            Ao autorizar, o estoque consolidado é gravado e {atual.total_anuncios} anúncios são
                            atualizados um a um, com meio segundo entre cada chamada para respeitar o limite do
                            Mercado Livre. Isso leva cerca de <b>{formatarDuracao(Math.round(atual.total_anuncios * 0.9))}</b>.
                            Você pode fechar esta página: a execução segue no servidor.
                        </p>
                    ) : null}
                </section>
            )}

            {/* ------------------------------------- 3. CONTADORES E ANUNCIOS */}
            {atual && atual.processados > 0 && (
                <>
                    <div className="flex flex-wrap gap-4">
                        <Numero rotulo="Atualizados" valor={atual.atualizados.toLocaleString('pt-BR')} nota="Mercado Livre aceitou" cor="text-success" />
                        <Numero rotulo="Recusados pelo ML" valor={atual.ja_atualizados.toLocaleString('pt-BR')} nota="Respondeu 400 ou 409"
                            cor="text-warning" titulo="O Mercado Livre NÃO aplicou a alteração" />
                        <Numero rotulo="Com erro" valor={atual.erros} nota="Falha de rede ou limite" cor="text-danger" />
                        <Numero rotulo="Ignorados" valor={atual.ignorados} nota="Sem SKU de roda no estoque" cor="text-ink-400" />
                    </div>

                    <Card className="w-full overflow-hidden">
                        <div className="flex flex-wrap items-center gap-4 px-6 py-4">
                            <h2 className="text-heading font-semibold text-ink-900">Anúncios</h2>
                            <div className="flex flex-wrap gap-2">
                                {FILTROS.map((f) => (
                                    <button
                                        key={f.valor}
                                        type="button"
                                        onClick={() => setFiltro(f.valor)}
                                        className={`cursor-pointer rounded-full px-3 py-1.5 text-label font-semibold transition-opacity hover:opacity-90 ${
                                            filtro === f.valor ? 'bg-brand-strong text-white' : 'bg-surface-sunken text-ink-600'
                                        }`}
                                    >
                                        {f.rotulo}
                                    </button>
                                ))}
                            </div>
                        </div>

                        {eventos.length === 0 ? (
                            <p className="border-t border-line px-6 py-6 text-body text-ink-400">
                                {emVoo ? 'Aguardando os primeiros anúncios...' : 'Nenhum anúncio neste filtro.'}
                            </p>
                        ) : (
                            <ul className="max-h-[28rem] overflow-y-auto">
                                {eventos.map((evento) => (
                                    <li key={evento.seq} className="flex items-center gap-4 border-t border-line px-6 py-3">
                                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                            <div className="flex flex-wrap items-center gap-2.5">
                                                <span className="font-mono text-label text-ink-400">
                                                    #{String(evento.seq).padStart(4, '0')}
                                                </span>
                                                <span className="font-mono text-code font-medium text-ink-900">{evento.sku}</span>
                                                {evento.ml_id && <span className="font-mono text-label text-ink-600">{evento.ml_id}</span>}
                                            </div>
                                            {(evento.motivo || evento.titulo) && (
                                                <span className="truncate text-label text-ink-400">{evento.motivo || evento.titulo}</span>
                                            )}
                                        </div>
                                        <div className="flex shrink-0 items-center gap-3">
                                            {evento.quantidade_nova != null && (
                                                <span className="font-mono text-label text-ink-600">qtde {evento.quantidade_nova}</span>
                                            )}
                                            {evento.duracao_ms != null && (
                                                <span className="font-mono text-label text-ink-400">{evento.duracao_ms} ms</span>
                                            )}
                                            <Badge tone={TOM_DO_RESULTADO[evento.resultado]}>
                                                {rotuloDoResultado(evento.resultado)}
                                                {evento.status_http ? ` · ${evento.status_http}` : ''}
                                            </Badge>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}

                        {atual.processados > EVENTOS_NA_TELA && (
                            <div className="border-t border-line bg-surface-sunken px-6 py-3.5">
                                <span className="text-label text-ink-400">
                                    Mostrando os {EVENTOS_NA_TELA} mais recentes dos {atual.processados} processados.
                                    Use os filtros para achar os que não deram certo.
                                </span>
                            </div>
                        )}
                    </Card>
                </>
            )}

            {/* ----------------------------------------------------- historico */}
            <Card className="w-full overflow-hidden">
                <div className="px-6 py-4">
                    <h2 className="text-heading font-semibold text-ink-900">Importações anteriores</h2>
                </div>
                {historico.length === 0 ? (
                    <p className="border-t border-line px-6 py-6 text-body text-ink-400">
                        Nenhuma importação registrada ainda.
                    </p>
                ) : (
                    <ul>
                        {historico.map((registro) => (
                            <li key={registro.id}>
                                <button
                                    type="button"
                                    onClick={() => abrir(registro.id)}
                                    className={`flex w-full cursor-pointer items-center gap-4 border-t border-line px-6 py-3.5 text-left transition-colors hover:bg-surface-sunken ${
                                        atual?.id === registro.id ? 'bg-surface-sunken' : ''
                                    }`}
                                >
                                    <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="font-mono text-label font-semibold text-ink-400">#{registro.id}</span>
                                            <span className="truncate text-code font-medium text-ink-900">{registro.arquivo_nome}</span>
                                        </div>
                                        <span className="text-label text-ink-400">
                                            {formatarInstante(registro.criada_em)}
                                            {registro.usuario_nome ? ` · ${registro.usuario_nome}` : ''}
                                        </span>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-3.5">
                                        <span className="font-mono text-label text-ink-600">
                                            {registro.processados}/{registro.total_anuncios ?? '?'}
                                        </span>
                                        {registro.ja_atualizados > 0 && (
                                            <span className="text-label text-warning">{registro.ja_atualizados} recusados</span>
                                        )}
                                        {registro.erros > 0 && (
                                            <span className="text-label text-danger">{registro.erros} erros</span>
                                        )}
                                        <Badge tone={TOM_DO_ESTADO[registro.estado]}>{rotuloDoEstado(registro.estado)}</Badge>
                                    </div>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
            </Card>
        </AppLayout>
    );
};

export default ImportacaoEstoquePage;
