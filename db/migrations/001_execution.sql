BEGIN;
CREATE TABLE IF NOT EXISTS auth_challenges (
  nonce_hash text PRIMARY KEY, wallet text NOT NULL, chain_id integer NOT NULL CHECK (chain_id = 56),
  domain text NOT NULL, uri text NOT NULL, message text NOT NULL, issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  session_hash text PRIMARY KEY, wallet text NOT NULL, chain_id integer NOT NULL CHECK (chain_id = 56),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS execution_routes (
  route_id uuid PRIMARY KEY, wallet text NOT NULL, chain_id integer NOT NULL CHECK (chain_id = 56),
  original_intent jsonb NOT NULL, original_source_raw numeric(78,0) NOT NULL CHECK (original_source_raw > 0),
  max_exposure_loss_bps integer NOT NULL CHECK (max_exposure_loss_bps BETWEEN 0 AND 10000),
  lifecycle_state text NOT NULL, session_snapshot jsonb NOT NULL, version bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS execution_steps (
  step_id uuid PRIMARY KEY, route_id uuid NOT NULL REFERENCES execution_routes(route_id),
  stage text NOT NULL, action_kind text NOT NULL, action_hash text NOT NULL,
  action_v1 jsonb NOT NULL, status text NOT NULL, attempt integer NOT NULL CHECK (attempt > 0),
  quote_metadata jsonb, bounded_authorization jsonb, recommended_gas jsonb,
  tx_hash text UNIQUE, confirmed_block numeric(78,0), failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(route_id, stage, attempt)
);
CREATE UNIQUE INDEX IF NOT EXISTS execution_steps_one_active ON execution_steps(route_id, stage)
  WHERE status IN ('REVIEW_READY','CONFIRMATION_RESERVED','AWAITING_WALLET_TX','SUBMITTED','PENDING','CONFIRMED');
CREATE TABLE IF NOT EXISTS settlement_evidence (
  evidence_id uuid PRIMARY KEY, route_id uuid NOT NULL REFERENCES execution_routes(route_id),
  stage text NOT NULL, tx_hash text NOT NULL UNIQUE, block_number numeric(78,0) NOT NULL,
  block_hash text NOT NULL, token_in text NOT NULL, token_out text NOT NULL,
  amount_in_raw numeric(78,0) NOT NULL CHECK (amount_in_raw > 0),
  amount_out_raw numeric(78,0) NOT NULL CHECK (amount_out_raw > 0),
  log_references jsonb NOT NULL, evidence_source text NOT NULL,
  confirmed_at timestamptz NOT NULL, UNIQUE(route_id, stage)
);
CREATE TABLE IF NOT EXISTS confirmation_intents (
  intent_id uuid PRIMARY KEY, token_hash text NOT NULL UNIQUE, route_id uuid NOT NULL REFERENCES execution_routes(route_id),
  wallet text NOT NULL, stage text NOT NULL, action_hash text NOT NULL, route_version bigint NOT NULL,
  idempotency_key text NOT NULL, expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), used_at timestamptz,
  UNIQUE(route_id, stage, idempotency_key)
);
CREATE TABLE IF NOT EXISTS execution_receipts (
  route_id uuid PRIMARY KEY REFERENCES execution_routes(route_id), status text NOT NULL,
  payload_v1 jsonb NOT NULL, receipt_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
COMMIT;
