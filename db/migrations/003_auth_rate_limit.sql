BEGIN;
CREATE TABLE IF NOT EXISTS auth_challenge_limits (
  bucket_key text NOT NULL,
  window_start timestamptz NOT NULL,
  attempts integer NOT NULL CHECK (attempts > 0),
  PRIMARY KEY (bucket_key, window_start)
);
CREATE INDEX IF NOT EXISTS auth_challenge_limits_window ON auth_challenge_limits(window_start);
COMMIT;
