-- Email is now REQUIRED on password signup (Google login was already email-driven).
-- The username is case-insensitively unique (idx_users_username_lower); mirror that
-- for email so two accounts can't differ only in letter case. NULLs are allowed to
-- repeat (legacy username-only rows keep email NULL), so this is safe to backfill.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower ON users (LOWER(email));
