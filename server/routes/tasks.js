const express = require("express");
const { pool } = require("../pool");
const { getAllowedTasksForTab } = require("../billing/limits");

async function getDefaultTabId(userId) {
  const r = await pool.query(
    "SELECT id FROM tabs WHERE user_id=$1 ORDER BY position ASC, id ASC LIMIT 1",
    [userId]
  );
  return r.rows[0]?.id || null;
}

function createTasksRoutes({ auth }) {
  const router = express.Router();

  router.get("/tasks", auth, async (req, res) => {
    const tabId = req.query.tabId ? parseInt(req.query.tabId, 10) : null;
    if (tabId) {
      const r = await pool.query(
        "SELECT * FROM tasks WHERE user_id=$1 AND tab_id=$2 ORDER BY position ASC, id ASC",
        [req.user.id, tabId]
      );
      return res.json(r.rows);
    }
    const r = await pool.query(
      "SELECT * FROM tasks WHERE user_id=$1 ORDER BY id DESC",
      [req.user.id]
    );
    res.json(r.rows);
  });

  router.post("/tasks", auth, async (req, res) => {
    const { title, tabId } = req.body;
    if (!title) return res.status(400).json({ error: "title required" });
    const effectiveTabId = tabId || (await getDefaultTabId(req.user.id));

    const allowed = await getAllowedTasksForTab(req.user.id, effectiveTabId);
    const c = await pool.query(
      "SELECT COUNT(*)::int AS c FROM tasks WHERE user_id=$1 AND tab_id=$2",
      [req.user.id, effectiveTabId]
    );
    if (c.rows[0].c >= allowed)
      return res.status(402).json({ error: "task limit reached" });

    const posRows = await pool.query(
      "SELECT COALESCE(MAX(position),0)+1 AS next FROM tasks WHERE user_id=$1 AND tab_id=$2",
      [req.user.id, effectiveTabId]
    );
    const nextPos = posRows.rows[0].next;

    const r = await pool.query(
      "INSERT INTO tasks(title,user_id,tab_id,position) VALUES($1,$2,$3,$4) RETURNING *",
      [title, req.user.id, effectiveTabId, nextPos]
    );
    res.status(201).json(r.rows[0]);
  });

  router.post("/tasks/reorder", auth, async (req, res) => {
    const { orderedIds, tabId } = req.body || {};
    if (!Array.isArray(orderedIds) || !orderedIds.length || !tabId) {
      return res.status(400).json({ error: "orderedIds and tabId required" });
    }
    const rows = await pool.query(
      "SELECT id FROM tasks WHERE user_id=$1 AND tab_id=$2 AND id = ANY($3::int[])",
      [req.user.id, tabId, orderedIds]
    );
    if (rows.rowCount !== orderedIds.length) {
      return res
        .status(400)
        .json({ error: "some tasks not found in this tab" });
    }

    await pool.query("BEGIN");
    try {
      for (let i = 0; i < orderedIds.length; i++) {
        await pool.query(
          "UPDATE tasks SET position=$1 WHERE id=$2 AND user_id=$3 AND tab_id=$4",
          [i + 1, orderedIds[i], req.user.id, tabId]
        );
      }
      await pool.query("COMMIT");
    } catch (e) {
      await pool.query("ROLLBACK");
      return res.status(500).end();
    }

    const out = await pool.query(
      "SELECT * FROM tasks WHERE user_id=$1 AND tab_id=$2 ORDER BY position ASC, id ASC",
      [req.user.id, tabId]
    );
    res.json(out.rows);
  });

  router.put("/tasks/:id", auth, async (req, res) => {
    const { id } = req.params;
    const { title, done, tabId } = req.body;
    const r = await pool.query(
      "UPDATE tasks SET title=COALESCE($1,title), done=COALESCE($2,done), tab_id=COALESCE($3,tab_id) WHERE id=$4 AND user_id=$5 RETURNING *",
      [title, done, tabId, id, req.user.id]
    );
    res.json(r.rows[0]);
  });

  router.delete("/tasks/:id", auth, async (req, res) => {
    const { id } = req.params;
    await pool.query("DELETE FROM tasks WHERE id=$1 AND user_id=$2", [
      id,
      req.user.id,
    ]);
    res.status(204).end();
  });

  return router;
}

module.exports = { createTasksRoutes };
