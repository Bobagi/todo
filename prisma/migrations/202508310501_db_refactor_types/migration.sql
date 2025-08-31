-- enums
DO $$ BEGIN
  CREATE TYPE billing_action AS ENUM ('TAB_SLOT','TASK_PACK');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- users: tighten types + legal acceptance columns
ALTER TABLE users
  ALTER COLUMN username TYPE varchar(50) USING username::varchar(50),
  ALTER COLUMN email TYPE varchar(255) USING email::varchar(255),
  ALTER COLUMN password TYPE varchar(255) USING password::varchar(255);

DO $$ BEGIN
  ALTER TABLE users ALTER COLUMN google_id TYPE varchar(64) USING google_id::varchar(64);
EXCEPTION WHEN undefined_column THEN
  -- in some DBs it's mapped name; ignore if missing
  RAISE NOTICE 'google_id column not found, skipping';
END $$;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS tos_version varchar(20),
  ADD COLUMN IF NOT EXISTS tos_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS privacy_version varchar(20),
  ADD COLUMN IF NOT EXISTS privacy_accepted_at timestamptz;

-- tasks.title -> varchar(200)
ALTER TABLE tasks
  ALTER COLUMN title TYPE varchar(200) USING LEFT(title,200);

-- billing_config.currency -> varchar(10)
ALTER TABLE billing_config
  ALTER COLUMN currency TYPE varchar(10) USING currency::varchar(10);

-- entitlements.type -> enum
ALTER TABLE entitlements
  ALTER COLUMN type TYPE billing_action
  USING (CASE
    WHEN type IN ('TAB_SLOT','TASK_PACK') THEN type::billing_action
    ELSE 'TAB_SLOT'::billing_action
  END);

-- payments columns
ALTER TABLE payments
  ALTER COLUMN stripe_payment_intent_id TYPE varchar(128) USING stripe_payment_intent_id::varchar(128),
  ALTER COLUMN currency TYPE varchar(10) USING currency::varchar(10);

ALTER TABLE payments
  ALTER COLUMN action_type TYPE billing_action
  USING (CASE
    WHEN action_type IN ('TAB_SLOT','TASK_PACK') THEN action_type::billing_action
    ELSE NULL
  END);

-- minimal access logs (Marco Civil - 6 meses de guarda)
CREATE TABLE IF NOT EXISTS access_logs (
  id          bigserial PRIMARY KEY,
  user_id     int NULL REFERENCES users(id) ON DELETE SET NULL,
  event_type  varchar(20) NOT NULL, -- 'login' | 'register'
  ip          inet NULL,
  user_agent  varchar(300) NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_access_logs_user_created ON access_logs(user_id, created_at DESC);
