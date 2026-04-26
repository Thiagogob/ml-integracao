-- MIGRATION DOWN: remove store_id from all tables (full rollback)
-- Run this if the migration needs to be reverted
-- Then redeploy the previous git commit

ALTER TABLE tokens_ml  DROP COLUMN store_id;
ALTER TABLE anuncios   DROP COLUMN store_id;
ALTER TABLE vendas_ml  DROP COLUMN store_id;

-- Restore sync_control to its original single-column PK
ALTER TABLE sync_control DROP CONSTRAINT sync_control_pkey;
ALTER TABLE sync_control ADD PRIMARY KEY (id);
ALTER TABLE sync_control DROP COLUMN store_id;
