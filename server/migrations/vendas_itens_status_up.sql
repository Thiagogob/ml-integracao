-- MIGRATION UP: vendas_ml com uma linha por item do pedido + status do pedido
-- O banco é compartilhado pelas duas lojas: rodar UMA vez, ANTES do deploy do código novo
-- (ml-integracao e ml-conta-secundaria). O código antigo continua funcionando depois dela.
-- Rollback: vendas_itens_status_down.sql

BEGIN;

-- Posição do item dentro de order_items. As linhas existentes são o primeiro item (0).
ALTER TABLE vendas_ml ADD COLUMN IF NOT EXISTS item_seq INTEGER NOT NULL DEFAULT 0;

-- 'paid' ou 'cancelled'. Pedido cancelado depois de pago deixa de contar nas métricas e na coleta.
ALTER TABLE vendas_ml ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'paid';

-- id_venda deixa de ser único sozinho: um pedido com vários itens tem várias linhas.
DO $$
DECLARE nome TEXT;
BEGIN
    FOR nome IN
        SELECT con.conname
        FROM pg_constraint con
        JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
        WHERE con.conrelid = 'vendas_ml'::regclass
          AND con.contype = 'u'
          AND array_length(con.conkey, 1) = 1
          AND att.attname = 'id_venda'
    LOOP
        EXECUTE format('ALTER TABLE vendas_ml DROP CONSTRAINT %I', nome);
    END LOOP;
END $$;

ALTER TABLE vendas_ml
    ADD CONSTRAINT vendas_ml_id_venda_item_seq_key UNIQUE (id_venda, item_seq);

-- Filtros por loja + data (card "rodas vendidas hoje", top 5, atenção)
CREATE INDEX IF NOT EXISTS vendas_ml_store_data_idx ON vendas_ml (store_id, data);

COMMIT;
