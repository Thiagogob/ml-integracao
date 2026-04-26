-- MIGRATION UP: add store_id to store-specific tables
-- All existing rows are assigned to store 1
-- Rollback: run add_store_id_down.sql

ALTER TABLE tokens_ml  ADD COLUMN store_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE anuncios   ADD COLUMN store_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE vendas_ml  ADD COLUMN store_id INTEGER NOT NULL DEFAULT 1;

-- sync_control has a single-column TEXT primary key (id).
-- We extend it to a composite PK (id, store_id) so each store
-- can track its own sync timestamps independently.
ALTER TABLE sync_control ADD COLUMN store_id INTEGER NOT NULL DEFAULT 1;
ALTER TABLE sync_control DROP CONSTRAINT sync_control_pkey;
ALTER TABLE sync_control ADD PRIMARY KEY (id, store_id);
