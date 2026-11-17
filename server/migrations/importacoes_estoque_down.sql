-- MIGRATION DOWN: desfaz importacoes_estoque_up.sql
--
-- importacoes_eventos cai primeiro por causa da chave estrangeira.
-- Os indices caem junto com as tabelas.

DROP TABLE IF EXISTS importacoes_eventos;
DROP TABLE IF EXISTS importacoes_estoque;
