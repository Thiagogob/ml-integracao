-- MIGRATION DOWN: desfaz vendas_itens_status_up.sql
-- ATENÇÃO: apaga as linhas de itens extras (item_seq > 0) para voltar a ter id_venda único.
-- Fazer backup de vendas_ml antes, e voltar o código para a versão anterior antes de rodar.

BEGIN;

DROP INDEX IF EXISTS vendas_ml_store_data_idx;
ALTER TABLE vendas_ml DROP CONSTRAINT IF EXISTS vendas_ml_id_venda_item_seq_key;
DELETE FROM vendas_ml WHERE item_seq > 0;
ALTER TABLE vendas_ml ADD CONSTRAINT vendas_ml_id_venda_key UNIQUE (id_venda);
ALTER TABLE vendas_ml DROP COLUMN IF EXISTS status;
ALTER TABLE vendas_ml DROP COLUMN IF EXISTS item_seq;

COMMIT;
