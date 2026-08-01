-- Password reset (and future email verification): one-time tokens, only the SHA-256 HASH is stored
-- (the raw token is emailed). Mirrors the Porkfolio auth_tokens design.
CREATE TABLE IF NOT EXISTS auth_tokens (
    id          BIGSERIAL PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    purpose     VARCHAR(32) NOT NULL,           -- 'password_reset' | 'email_verification'
    token_hash  TEXT NOT NULL,
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS auth_tokens_token_hash_unique ON auth_tokens (token_hash);
CREATE INDEX IF NOT EXISTS auth_tokens_user_purpose_idx ON auth_tokens (user_id, purpose);
CREATE INDEX IF NOT EXISTS auth_tokens_expires_at_idx ON auth_tokens (expires_at);

-- The JWT is stateless (can't be revoked by deleting a server-side session). token_version is embedded
-- in every issued JWT and re-checked against this column in the auth guard; bumping it (on password
-- reset) instantly invalidates every previously issued token for that user, kicking any attacker.
ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0;
