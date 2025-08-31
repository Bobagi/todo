-- Adiciona coluna de ordenação nas tarefas
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS position integer NOT NULL DEFAULT 0;

-- Inicializa posições por (user_id, tab_id) seguindo a ordem por id ASC
WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY user_id, COALESCE(tab_id, -1) ORDER BY id ASC) AS rn
  FROM tasks
)
UPDATE tasks t
SET position = o.rn
FROM ordered o
WHERE o.id = t.id;

-- Índice para ordenar/buscar por usuário/aba
CREATE INDEX IF NOT EXISTS idx_tasks_user_tab_position
  ON tasks(user_id, tab_id, position);
