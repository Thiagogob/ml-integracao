-- MIGRATION UP: importacao de relatorio de estoque como job observavel
--
-- Duas tabelas:
--   importacoes_estoque   um registro por envio de arquivo (o job)
--   importacoes_eventos   um registro por anuncio tocado (o detalhe)
--
-- Dimensionamento tirado das execucoes reais em server/logs/sync-*.json:
-- 1.613 linhas por relatorio, ~795 SKUs com cadastro, ~980 anuncios tocados
-- por execucao. A tabela de eventos cresce ~1.000 linhas por importacao.
--
-- Rollback: run importacoes_estoque_down.sql

CREATE TABLE IF NOT EXISTS importacoes_estoque (
    id                SERIAL PRIMARY KEY,
    store_id          INTEGER      NOT NULL DEFAULT 1,

    -- qual pipeline: 'upload_pdf' (SP), 'upload_pdf_sul', 'upload_local'
    origem            TEXT         NOT NULL,

    -- maquina de estados; ver importacoes.service.js (ESTADOS)
    --   analisando               lendo o PDF, nada foi gravado
    --   aguardando_confirmacao   diagnostico pronto, esperando o operador
    --   processando              gravando estoque e sincronizando anuncios
    --   concluida | falhou | cancelada | interrompida
    estado            TEXT         NOT NULL DEFAULT 'analisando',

    arquivo_nome      TEXT,
    arquivo_bytes     INTEGER,
    -- SHA-256 do conteudo: base da idempotencia (ver indice unico abaixo)
    arquivo_sha256    CHAR(64)     NOT NULL,

    -- quem enviou, extraido do JWT; NULL para execucao do agendador
    usuario_id        INTEGER,
    usuario_nome      TEXT,

    criada_em         TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    confirmada_em     TIMESTAMPTZ,
    iniciada_em       TIMESTAMPTZ,
    concluida_em      TIMESTAMPTZ,

    -- batido a cada anuncio processado; reconciliador usa para achar orfas
    heartbeat_em      TIMESTAMPTZ,
    -- identifica o processo que detem o job, para o reconciliador nao
    -- derrubar execucao de outra instancia
    executor          TEXT,

    -- total de anuncios previsto apos a analise; NULL enquanto nao se sabe
    total_anuncios    INTEGER,

    processados       INTEGER      NOT NULL DEFAULT 0,
    atualizados       INTEGER      NOT NULL DEFAULT 0,
    ja_atualizados    INTEGER      NOT NULL DEFAULT 0,
    erros             INTEGER      NOT NULL DEFAULT 0,
    ignorados         INTEGER      NOT NULL DEFAULT 0,

    -- diagnostico da analise do PDF, mesmo formato de sync-*.json ("resumo")
    resumo            JSONB,
    -- listas longas da analise (semSKU, naoEncontradas, naoCobertas)
    detalhe_analise   JSONB,

    -- onde o arquivo enviado ficou, apenas para auditoria. NAO e dele que a
    -- execucao depende: o sistema de arquivos do Railway e efemero e se perde a
    -- cada deploy, justamente quando a retomada e necessaria.
    arquivo_caminho   TEXT,

    -- As duas colunas abaixo tornam a execucao independente do disco. A analise
    -- grava aqui as linhas lidas do relatorio e os pares (sku, ml_id) a tocar;
    -- a confirmacao e a retomada leem daqui, nunca do arquivo. Custo medido com
    -- os relatorios reais de abril: ~1.613 linhas e ~980 pares, algo como
    -- 260 KB por importacao. Sao anuladas quando o job encerra em concluida ou
    -- cancelada, estados dos quais nao se retoma (ver importacoes.repo.js).
    entrada_rodas     JSONB,
    plano_anuncios    JSONB,

    erro_mensagem     TEXT,
    -- cancelamento cooperativo: o laco consulta e para no proximo anuncio
    cancelamento_pedido BOOLEAN    NOT NULL DEFAULT FALSE,

    CONSTRAINT importacoes_estoque_estado_valido CHECK (estado IN (
        'analisando', 'aguardando_confirmacao', 'processando',
        'concluida', 'falhou', 'cancelada', 'interrompida'
    )),
    -- invariante de contabilidade: a soma das classificacoes e o total
    CONSTRAINT importacoes_estoque_soma_bate CHECK (
        processados = atualizados + ja_atualizados + erros + ignorados
    )
);

-- Idempotencia. As execucoes de 2026-04-24T21:19 e 2026-04-25T13:03 gravaram
-- relatorios identicos byte a byte (fora o timestamp): o mesmo PDF foi
-- reprocessado 16 horas depois, repetindo ~980 chamadas ao Mercado Livre.
-- Um arquivo em curso ou ja concluido nao pode ser reenviado; um que falhou
-- ou foi cancelado pode, porque reenviar e justamente a correcao.
CREATE UNIQUE INDEX IF NOT EXISTS importacoes_estoque_arquivo_vivo
    ON importacoes_estoque (store_id, arquivo_sha256)
    WHERE estado IN ('analisando', 'aguardando_confirmacao', 'processando', 'concluida');

-- Listagem do historico na tela
CREATE INDEX IF NOT EXISTS importacoes_estoque_recentes
    ON importacoes_estoque (store_id, criada_em DESC);

-- Reconciliador: varre apenas o que esta em voo
CREATE INDEX IF NOT EXISTS importacoes_estoque_em_voo
    ON importacoes_estoque (estado, heartbeat_em)
    WHERE estado IN ('analisando', 'processando');


CREATE TABLE IF NOT EXISTS importacoes_eventos (
    id              BIGSERIAL    PRIMARY KEY,
    importacao_id   INTEGER      NOT NULL
                        REFERENCES importacoes_estoque(id) ON DELETE CASCADE,

    -- ordinal dentro do job. A tela pagina por ele (?desde_seq=N), o que
    -- torna a busca incremental estavel mesmo com escrita concorrente.
    seq             INTEGER      NOT NULL,
    criado_em       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    sku             TEXT,
    ml_id           TEXT,
    titulo          TEXT,

    --   atualizado    ML aceitou
    --   ja_atualizado ML respondeu 400/409 (nao aplicou)
    --   erro          excecao ou resposta inesperada
    --   ignorado      anuncio sem SKU de roda no estoque
    resultado       TEXT         NOT NULL,

    status_http     INTEGER,
    -- quantidade enviada no payload. A anterior nao e registrada porque
    -- exigiria um GET extra por anuncio no ML, dobrando a duracao da execucao.
    quantidade_nova INTEGER,
    motivo          TEXT,
    duracao_ms      INTEGER,

    CONSTRAINT importacoes_eventos_resultado_valido CHECK (resultado IN (
        'atualizado', 'ja_atualizado', 'erro', 'ignorado'
    )),
    -- retomada: o mesmo anuncio nao pode ser gravado duas vezes no mesmo job
    CONSTRAINT importacoes_eventos_seq_unico UNIQUE (importacao_id, seq)
);

-- Busca incremental da tela: WHERE importacao_id = ? AND seq > ? ORDER BY seq
CREATE INDEX IF NOT EXISTS importacoes_eventos_paginacao
    ON importacoes_eventos (importacao_id, seq);

-- Retomada: descobrir rapidamente quais anuncios ja foram tocados
CREATE INDEX IF NOT EXISTS importacoes_eventos_anuncio
    ON importacoes_eventos (importacao_id, ml_id, sku);

-- Filtro "mostrar so os que falharam"
CREATE INDEX IF NOT EXISTS importacoes_eventos_resultado
    ON importacoes_eventos (importacao_id, resultado);
