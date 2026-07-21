-- ENG1 Slice 2: idempotent Vink creation. A client-generated key, stable across retries of
-- the same create attempt, lets a lost-response retry return the original Vink instead of
-- creating a duplicate. PostgreSQL uniqueness is the final guard (hard rule); the
-- application layer's own pre-check is only an optimization.
ALTER TABLE vinks ADD COLUMN creation_idempotency_key TEXT;
UPDATE vinks SET creation_idempotency_key = gen_random_uuid()::text
  WHERE creation_idempotency_key IS NULL;
ALTER TABLE vinks ALTER COLUMN creation_idempotency_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_vinks_organizer_creation_key
  ON vinks (organizer_user_id, creation_idempotency_key);
