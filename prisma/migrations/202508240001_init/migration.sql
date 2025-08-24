CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username TEXT UNIQUE,
  email TEXT UNIQUE,
  password TEXT,
  google_id TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower ON users (LOWER(username));

CREATE TABLE IF NOT EXISTS tabs (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tabs_user_lower_name ON tabs (user_id, LOWER(name));

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  done BOOLEAN DEFAULT FALSE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  tab_id INTEGER REFERENCES tabs(id) ON DELETE CASCADE
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='tasks' AND column_name='tab_id'
  ) THEN
    ALTER TABLE tasks ADD COLUMN tab_id INTEGER;
    ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_tab_id_fkey;
    ALTER TABLE tasks ADD CONSTRAINT tasks_tab_id_fkey FOREIGN KEY (tab_id) REFERENCES tabs(id) ON DELETE CASCADE;
  END IF;
END $$;

INSERT INTO tabs(name, user_id)
SELECT 'General', u.id
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM tabs t WHERE t.user_id = u.id AND LOWER(t.name) = 'general'
);

WITH j AS (
  SELECT u.id AS user_id, t.id AS general_tab_id
  FROM users u
  JOIN tabs t ON t.user_id = u.id AND LOWER(t.name) = 'general'
)
UPDATE tasks tk
SET tab_id = j.general_tab_id
FROM j
WHERE tk.user_id = j.user_id AND tk.tab_id IS NULL;
