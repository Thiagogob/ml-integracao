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

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-toastify';
import {
    enviarRelatorio, obterImportacao, listarImportacoes, buscarEventos,
    confirmarImportacao, retomarImportacao, cancelarImportacao,
    ConflitoDeArquivo, ESTADOS_TERMINAIS,
    rotuloDoEstado, corDoEstado, rotuloDoResultado, corDoResultado,
    formatarDuracao, formatarInstante,
    type Importacao, type EventoImportacao, type ResultadoEvento
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

const Contador: React.FC<{ rotulo: string; valor: number | string; cor?: string; dica?: string }> =
({ rotulo, valor, cor = 'text-white', dica }) => (
    <div className="bg-gray-800 border border-gray-700 rounded-lg p-4" title={dica}>
        <p className="text-xs uppercase tracking-wide text-gray-400">{rotulo}</p>
        <p className={`text-2xl font-bold mt-1 ${cor}`}>{valor}</p>
    </div>
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

    // ------------------------------------------------------------- historico

    const recarregarHistorico = useCallback(async () => {
        try {
            setHistorico(await listarImportacoes(15));
        } catch {
            // historico e acessorio: falhar aqui nao deve atrapalhar o resto
        }
    }, []);

    useEffect(() => {
        recarregarHistorico();
    }, [recarregarHistorico]);

    // Se houver importacao em voo ou esperando confirmacao, a tela assume: o
    // operador pode ter fechado o navegador no meio.
    useEffect(() => {
        const pendente = historico.find(
            (i) => !ESTADOS_TERMINAIS.includes(i.estado)
        );
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
                    id,
                    maiorSeq.current,
                    filtro === 'todos' ? undefined : filtro,
                    200,
                    abortar.current.signal
                );
                if (!vivo) return;

                if (pagina.eventos.length > 0) {
                    maiorSeq.current = pagina.maior_seq;
                    setEventos((anteriores) =>
                        [...pagina.eventos.reverse(), ...anteriores].slice(0, EVENTOS_NA_TELA)
                    );
                }

                if (ESTADOS_TERMINAIS.includes(estado.estado)) {
                    recarregarHistorico();
                }
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
                setEventos(pagina.eventos.reverse().slice(0, EVENTOS_NA_TELA));
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
                const detalhe = erro?.response?.data?.error || erro?.message;
                toast.error(`Falha no envio: ${detalhe}`);
            }
        } finally {
            setEnviando(false);
        }
    };

    const executarAcao = async (
        acao: (id: number) => Promise<Importacao>,
        mensagem: string
    ) => {
        if (!atual) return;
        setAgindo(true);
        try {
            const atualizada = await acao(atual.id);
            setAtual(atualizada);
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

    const eventosVisiveis = useMemo(() => eventos, [eventos]);

    const alerta = useMemo(() => {
        if (!atual || !atual.resumo) return null;
        const r = atual.resumo;
        const semCadastro = r.semSKUNoBanco;
        const proporcao = r.totalRodasNoPDF > 0
            ? Math.round((semCadastro / r.totalRodasNoPDF) * 100)
            : 0;
        if (proporcao >= 40) {
            return `${semCadastro} das ${r.totalRodasNoPDF} linhas do relatório (${proporcao}%) não têm SKU no cadastro e não chegam a nenhum anúncio.`;
        }
        return null;
    }, [atual]);

    // ------------------------------------------------------------------ render

    return (
        <div className="min-h-screen bg-gray-900 text-white p-8">
            <header className="flex justify-between items-center mb-8 border-b border-gray-700 pb-4">
                <div>
                    <h1 className="text-3xl font-bold text-indigo-400">Importar relatório de estoque</h1>
                    <p className="text-sm text-gray-400 mt-1">
                        O arquivo é conferido antes de qualquer alteração. Nada é gravado sem a sua autorização.
                    </p>
                </div>
                <button
                    onClick={() => navigate('/dashboard')}
                    className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm font-semibold transition"
                >
                    &larr; Voltar
                </button>
            </header>

            {/* ---------------------------------------------------- 1. ENVIO */}
            {(!atual || ESTADOS_TERMINAIS.includes(atual.estado)) && (
                <section className="mb-8">
                    <div
                        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
                        onDragLeave={() => setArrastando(false)}
                        onDrop={(e) => { e.preventDefault(); setArrastando(false); escolher(e.dataTransfer.files); }}
                        onClick={() => seletor.current?.click()}
                        className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition ${
                            arrastando ? 'border-indigo-400 bg-gray-800' : 'border-gray-600 hover:border-gray-500'
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
                            <div>
                                <p className="text-lg font-semibold">{arquivo.name}</p>
                                <p className="text-sm text-gray-400 mt-1">
                                    {(arquivo.size / 1024).toFixed(0)} KB
                                </p>
                            </div>
                        ) : (
                            <div>
                                <p className="text-lg">Arraste o PDF do relatório aqui, ou clique para escolher</p>
                                <p className="text-sm text-gray-500 mt-2">Somente PDF, até 25 MB</p>
                            </div>
                        )}
                    </div>

                    {arquivo && (
                        <div className="mt-4 flex items-center gap-3">
                            <button
                                onClick={enviar}
                                disabled={enviando}
                                className={`px-5 py-2 rounded-lg text-sm font-semibold transition ${
                                    enviando ? 'bg-gray-600 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                                }`}
                            >
                                {enviando
                                    ? (percentualEnvio < 100
                                        ? `Enviando ${percentualEnvio}%`
                                        : 'Analisando o arquivo...')
                                    : 'Conferir o arquivo'}
                            </button>
                            <button
                                onClick={() => { setArquivo(null); if (seletor.current) seletor.current.value = ''; }}
                                disabled={enviando}
                                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition disabled:opacity-50"
                            >
                                Trocar
                            </button>
                            <span className="text-xs text-gray-500">
                                A conferência não grava nada e não toca em nenhum anúncio.
                            </span>
                        </div>
                    )}
                </section>
            )}

            {/* ------------------------------------- 2. CONFERENCIA E ESTADO */}
            {atual && (
                <section className="mb-8 bg-gray-800 border border-gray-700 rounded-xl p-6">
                    <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
                        <div>
                            <div className="flex items-center gap-3">
                                <span className={`px-3 py-1 rounded-full text-xs font-bold ${corDoEstado(atual.estado)}`}>
                                    {rotuloDoEstado(atual.estado)}
                                </span>
                                <span className="text-sm text-gray-400">
                                    importação #{atual.id}
                                </span>
                            </div>
                            <p className="mt-2 font-semibold">{atual.arquivo_nome}</p>
                            <p className="text-xs text-gray-500 font-mono mt-1">
                                sha256 {atual.arquivo_sha256.slice(0, 16)}…
                            </p>
                            <p className="text-xs text-gray-400 mt-1">
                                enviada em {formatarInstante(atual.criada_em)}
                                {atual.usuario_nome ? ` por ${atual.usuario_nome}` : ''}
                            </p>
                        </div>

                        <div className="flex flex-wrap gap-2">
                            {atual.estado === 'aguardando_confirmacao' && (
                                <>
                                    <button
                                        onClick={() => executarAcao(confirmarImportacao, 'Importação autorizada.')}
                                        disabled={agindo}
                                        className="px-5 py-2 bg-green-600 hover:bg-green-700 rounded-lg text-sm font-semibold transition disabled:opacity-50"
                                    >
                                        Autorizar e atualizar {atual.total_anuncios ?? 0} anúncios
                                    </button>
                                    <button
                                        onClick={() => executarAcao(cancelarImportacao, 'Importação descartada.')}
                                        disabled={agindo}
                                        className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition disabled:opacity-50"
                                    >
                                        Descartar
                                    </button>
                                </>
                            )}
                            {atual.estado === 'processando' && (
                                <button
                                    onClick={() => executarAcao(cancelarImportacao, 'Cancelamento pedido. O laço para no próximo anúncio.')}
                                    disabled={agindo || atual.cancelamento_pedido}
                                    className="px-4 py-2 bg-red-700 hover:bg-red-600 rounded-lg text-sm font-semibold transition disabled:opacity-50"
                                >
                                    {atual.cancelamento_pedido ? 'Parando...' : 'Cancelar'}
                                </button>
                            )}
                            {atual.estado === 'interrompida' && (
                                <button
                                    onClick={() => executarAcao(retomarImportacao, 'Retomando de onde parou.')}
                                    disabled={agindo}
                                    className="px-5 py-2 bg-orange-600 hover:bg-orange-700 rounded-lg text-sm font-semibold transition disabled:opacity-50"
                                >
                                    Retomar de onde parou
                                </button>
                            )}
                        </div>
                    </div>

                    {/* diagnostico da conferencia */}
                    {atual.resumo && (
                        <>
                            <h2 className="text-sm uppercase tracking-wide text-gray-400 mb-3">
                                {atual.estado === 'aguardando_confirmacao'
                                    ? 'O que este arquivo faria'
                                    : 'O que este arquivo trouxe'}
                            </h2>
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                                <Contador rotulo="Linhas no PDF" valor={atual.resumo.totalRodasNoPDF} />
                                <Contador
                                    rotulo="Com cadastro"
                                    valor={atual.resumo.atualizadasComSKU}
                                    cor="text-green-400"
                                    dica="Rodas cujo código existe no cadastro e que podem chegar a anúncios"
                                />
                                <Contador
                                    rotulo="Sem SKU"
                                    valor={atual.resumo.semSKUNoBanco}
                                    cor="text-amber-400"
                                    dica="Linhas do relatório sem SKU no cadastro: não chegam a nenhum anúncio"
                                />
                                <Contador
                                    rotulo="Não encontradas"
                                    valor={atual.resumo.novasNaoEncontradas}
                                    cor="text-amber-400"
                                    dica="Rodas que o relatório traz e o cadastro não conhece"
                                />
                                <Contador
                                    rotulo="Anúncios a tocar"
                                    valor={atual.total_anuncios ?? '--'}
                                    cor="text-indigo-300"
                                    dica="Pares de SKU e anúncio que serão enviados ao Mercado Livre"
                                />
                            </div>

                            {alerta && (
                                <div className="bg-amber-900/40 border border-amber-700 rounded-lg p-3 text-sm mb-4">
                                    <b>Confira antes de autorizar.</b> {alerta}
                                </div>
                            )}

                            {atual.estado === 'aguardando_confirmacao' && atual.total_anuncios ? (
                                <p className="text-sm text-gray-400 mb-2">
                                    Ao autorizar, o estoque consolidado é gravado e {atual.total_anuncios} anúncios
                                    são atualizados um a um, com meio segundo entre cada chamada para respeitar o
                                    limite do Mercado Livre. Isso leva cerca de{' '}
                                    <b>{formatarDuracao(Math.round(atual.total_anuncios * 0.9))}</b>. Você pode
                                    fechar esta página: a execução segue no servidor.
                                </p>
                            ) : null}
                        </>
                    )}

                    {/* ------------------------------- 3. ACOMPANHAMENTO */}
                    {(atual.estado === 'processando' || atual.processados > 0) && (
                        <div className="mt-5 pt-5 border-t border-gray-700">
                            <div className="flex justify-between text-sm mb-2">
                                <span className="text-gray-300">
                                    {atual.processados} de {atual.total_anuncios ?? '?'} anúncios
                                </span>
                                <span className="text-gray-400">
                                    {atual.percentual != null ? `${atual.percentual}%` : ''}
                                    {atual.estado === 'processando' && atual.segundos_restantes != null && (
                                        <> · faltam cerca de {formatarDuracao(atual.segundos_restantes)}</>
                                    )}
                                    {atual.vazao_por_segundo ? ` · ${atual.vazao_por_segundo}/s` : ''}
                                </span>
                            </div>
                            <div className="w-full bg-gray-700 rounded-full h-3 overflow-hidden">
                                <div
                                    className={`h-3 rounded-full transition-all duration-500 ${
                                        atual.estado === 'processando' ? 'bg-indigo-500' :
                                        atual.estado === 'concluida' ? 'bg-green-500' : 'bg-orange-500'
                                    }`}
                                    style={{ width: `${atual.percentual ?? 0}%` }}
                                />
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
                                <Contador rotulo="Atualizados" valor={atual.atualizados} cor="text-green-400" />
                                <Contador
                                    rotulo="Recusados pelo ML"
                                    valor={atual.ja_atualizados}
                                    cor="text-amber-400"
                                    dica="O Mercado Livre respondeu 400 ou 409 e NÃO aplicou a alteração"
                                />
                                <Contador rotulo="Com erro" valor={atual.erros} cor="text-red-400" />
                                <Contador
                                    rotulo="Ignorados"
                                    valor={atual.ignorados}
                                    cor="text-gray-400"
                                    dica="Anúncio sem nenhum SKU de roda no estoque"
                                />
                            </div>

                            {atual.soma_bate === false && (
                                <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-sm mt-3">
                                    Os contadores desta importação não fecham com o total processado. Isso não
                                    deveria acontecer: avise o responsável pelo sistema.
                                </div>
                            )}
                        </div>
                    )}

                    {atual.erro_mensagem && (
                        <div className="bg-red-900/40 border border-red-700 rounded-lg p-3 text-sm mt-4">
                            {atual.erro_mensagem}
                        </div>
                    )}
                </section>
            )}

            {/* ------------------------------------------- lista de anuncios */}
            {atual && (atual.processados > 0 || eventosVisiveis.length > 0) && (
                <section className="mb-8">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
                        <h2 className="text-lg font-semibold">Anúncios</h2>
                        <div className="flex flex-wrap gap-2">
                            {FILTROS.map((f) => (
                                <button
                                    key={f.valor}
                                    onClick={() => setFiltro(f.valor)}
                                    className={`px-3 py-1 rounded-lg text-xs font-semibold transition ${
                                        filtro === f.valor
                                            ? 'bg-indigo-600 text-white'
                                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                    }`}
                                >
                                    {f.rotulo}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                        {eventosVisiveis.length === 0 ? (
                            <p className="p-6 text-sm text-gray-400">
                                {emVoo ? 'Aguardando os primeiros anúncios...' : 'Nenhum anúncio neste filtro.'}
                            </p>
                        ) : (
                            <ul className="divide-y divide-gray-700 max-h-[28rem] overflow-y-auto">
                                {eventosVisiveis.map((evento) => (
                                    <li key={evento.seq} className="px-4 py-3 flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <p className="text-sm font-semibold truncate">
                                                <span className="text-gray-500 font-mono mr-2">
                                                    #{String(evento.seq).padStart(4, '0')}
                                                </span>
                                                {evento.sku}
                                                {evento.ml_id && (
                                                    <span className="text-gray-400 font-normal ml-2">
                                                        {evento.ml_id}
                                                    </span>
                                                )}
                                            </p>
                                            {evento.titulo && (
                                                <p className="text-xs text-gray-500 truncate mt-0.5">{evento.titulo}</p>
                                            )}
                                            {evento.motivo && (
                                                <p className="text-xs text-gray-400 mt-0.5">{evento.motivo}</p>
                                            )}
                                        </div>
                                        <div className="text-right whitespace-nowrap">
                                            <p className={`text-sm font-semibold ${corDoResultado(evento.resultado)}`}>
                                                {rotuloDoResultado(evento.resultado)}
                                                {evento.status_http ? ` · ${evento.status_http}` : ''}
                                            </p>
                                            <p className="text-xs text-gray-500 mt-0.5">
                                                {evento.quantidade_nova != null && (
                                                    <>qtde {evento.quantidade_nova}</>
                                                )}
                                                {evento.duracao_ms != null && (
                                                    <> · {evento.duracao_ms} ms</>
                                                )}
                                            </p>
                                        </div>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>

                    {atual.processados > EVENTOS_NA_TELA && (
                        <p className="text-xs text-gray-500 mt-2">
                            Mostrando os {EVENTOS_NA_TELA} mais recentes dos {atual.processados} processados.
                            Use os filtros para achar os que não deram certo.
                        </p>
                    )}
                </section>
            )}

            {/* ----------------------------------------------------- historico */}
            <section>
                <h2 className="text-lg font-semibold mb-3">Importações anteriores</h2>
                {historico.length === 0 ? (
                    <p className="text-sm text-gray-400">Nenhuma importação registrada ainda.</p>
                ) : (
                    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                        <ul className="divide-y divide-gray-700">
                            {historico.map((registro) => (
                                <li
                                    key={registro.id}
                                    onClick={() => abrir(registro.id)}
                                    className={`px-4 py-3 flex items-center justify-between gap-4 cursor-pointer hover:bg-gray-700/50 transition ${
                                        atual?.id === registro.id ? 'bg-gray-700/40' : ''
                                    }`}
                                >
                                    <div className="min-w-0">
                                        <p className="text-sm">
                                            <span className="text-gray-500 font-mono mr-2">#{registro.id}</span>
                                            {registro.arquivo_nome}
                                        </p>
                                        <p className="text-xs text-gray-400 mt-0.5">
                                            {formatarInstante(registro.criada_em)}
                                            {registro.usuario_nome ? ` · ${registro.usuario_nome}` : ''}
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-4 whitespace-nowrap">
                                        <span className="text-xs text-gray-400">
                                            {registro.processados}/{registro.total_anuncios ?? '?'}
                                            {registro.ja_atualizados > 0 && (
                                                <span className="text-amber-400 ml-2">
                                                    {registro.ja_atualizados} recusados
                                                </span>
                                            )}
                                            {registro.erros > 0 && (
                                                <span className="text-red-400 ml-2">{registro.erros} erros</span>
                                            )}
                                        </span>
                                        <span className={`px-2 py-1 rounded-full text-xs font-bold ${corDoEstado(registro.estado)}`}>
                                            {rotuloDoEstado(registro.estado)}
                                        </span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                )}
            </section>
        </div>
    );
};

export default ImportacaoEstoquePage;
