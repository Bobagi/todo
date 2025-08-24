ALTER TABLE tabs ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

WITH ranked AS (
  SELECT id, user_id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY id) AS rn
  FROM tabs
)
UPDATE tabs t
SET position = r.rn
FROM ranked r
WHERE t.id = r.id;

CREATE INDEX IF NOT EXISTS idx_tabs_user_position ON tabs (user_id, position);
