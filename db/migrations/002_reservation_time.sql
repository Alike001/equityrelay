BEGIN;
ALTER TABLE execution_steps ADD COLUMN reserved_at timestamptz;
COMMIT;
