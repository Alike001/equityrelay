BEGIN;
ALTER TABLE execution_routes ADD COLUMN IF NOT EXISTS recovery_state text;
CREATE INDEX IF NOT EXISTS execution_routes_recovery_state ON execution_routes(recovery_state) WHERE recovery_state IS NOT NULL;
ALTER TABLE execution_receipts ADD COLUMN IF NOT EXISTS payload_v2 jsonb;
ALTER TABLE execution_receipts ADD COLUMN IF NOT EXISTS receipt_hash_v2 text;
ALTER TABLE execution_receipts ALTER COLUMN payload_v1 DROP NOT NULL;
ALTER TABLE execution_receipts ALTER COLUMN receipt_hash DROP NOT NULL;
COMMIT;
