-- billing config (uma linha)
CREATE TABLE IF NOT EXISTS billing_config (
  id SERIAL PRIMARY KEY,
  currency TEXT NOT NULL DEFAULT 'brl',
  tab_price_cents INTEGER NOT NULL DEFAULT 200,
  task_pack_price_cents INTEGER NOT NULL DEFAULT 200,
  task_pack_size INTEGER NOT NULL DEFAULT 6,
  entitlement_days INTEGER NOT NULL DEFAULT 30,
  base_tabs INTEGER NOT NULL DEFAULT 1,
  base_tasks_per_tab INTEGER NOT NULL DEFAULT 6
);

-- entitlements: créditos temporários (30 dias) por usuário
CREATE TABLE IF NOT EXISTS entitlements (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'TAB_SLOT' | 'TASK_PACK'
  tab_id INTEGER REFERENCES tabs(id) ON DELETE CASCADE,
  amount INTEGER NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- índices: usar colunas, não expressão com now()
CREATE INDEX IF NOT EXISTS idx_entitlements_user_type_expires
  ON entitlements (user_id, type, expires_at);

CREATE INDEX IF NOT EXISTS idx_entitlements_user_type_tab_expires
  ON entitlements (user_id, type, tab_id, expires_at);

-- payments: log do Stripe
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  stripe_payment_intent_id TEXT UNIQUE,
  amount_cents INTEGER,
  currency TEXT,
  action_type TEXT,
  tab_id INTEGER,
  quantity INTEGER,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- limita nome da aba a 30 chars (mantém dados existentes)
ALTER TABLE tabs ALTER COLUMN name TYPE VARCHAR(30);

-- garante cascade de tasks quando a aba é removida (se ainda não existir)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE constraint_name = 'tasks_tab_id_fkey'
      AND table_name = 'tasks'
  ) THEN
    ALTER TABLE tasks
      ADD CONSTRAINT tasks_tab_id_fkey
      FOREIGN KEY (tab_id) REFERENCES tabs(id) ON DELETE CASCADE;
  END IF;
END $$;
