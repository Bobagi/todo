const express = require("express");
const { pool } = require("../pool");
const { getAllowedTabSlots } = require("../billing/limits");

function createTabsRoutes({ auth }) {
  const router = express.Router();

  router.get("/tabs", auth, async (req, res) => {
    const r = await pool.query(
      "SELECT id, name, position FROM tabs WHERE user_id=$1 ORDER BY position ASC, id ASC",
      [req.user.id]
    );
    res.json(r.rows);
  });

  router.get("/tabs/capacity", auth, async (req, res) => {
    const allowed = await getAllowedTabSlots(req.user.id);
    const current = (
      await pool.query("SELECT COUNT(*)::int c FROM tabs WHERE user_id=$1", [
        req.user.id,
      ])
    ).rows[0].c;
    res.json({ allowed, current, canCreate: current < allowed });
  });

  router.post("/tabs", auth, async (req, res) => {
    const { name } = req.body;
    const trimmed = (name || "").trim();
    if (!trimmed) return res.status(400).json({ error: "name required" });
    if (trimmed.length > 30)
      return res.status(400).json({ error: "name too long (max 30)" });

    const current = await pool.query(
      "SELECT COUNT(*)::int AS c FROM tabs WHERE user_id=$1",
      [req.user.id]
    );
    const allowed = await getAllowedTabSlots(req.user.id);
    if (current.rows[0].c >= allowed)
      return res.status(402).json({ error: "tab limit reached" });

    try {
      const posRows = await pool.query(
        "SELECT COALESCE(MAX(position),0)+1 AS next FROM tabs WHERE user_id=$1",
        [req.user.id]
      );
      const nextPosition = posRows.rows[0].next;
      const ins = await pool.query(
        "INSERT INTO tabs(name,user_id,position) VALUES($1,$2,$3) RETURNING id,name,position",
        [trimmed, req.user.id, nextPosition]
      );
      res.status(201).json(ins.rows[0]);
    } catch (err) {
      if (err.code === "23505")
        return res.status(400).json({ error: "tab exists" });
      res.status(500).end();
    }
  });

  router.post("/tabs/reorder", auth, async (req, res) => {
    const { orderedIds } = req.body;
    if (!Array.isArray(orderedIds) || orderedIds.length === 0)
      return res.status(400).json({ error: "orderedIds required" });
    await pool.query("BEGIN");
    try {
      for (let i = 0; i < orderedIds.length; i++) {
        await pool.query(
          "UPDATE tabs SET position=$1 WHERE id=$2 AND user_id=$3",
          [i + 1, orderedIds[i], req.user.id]
        );
      }
      await pool.query("COMMIT");
      const r = await pool.query(
        "SELECT id, name, position FROM tabs WHERE user_id=$1 ORDER BY position ASC, id ASC",
        [req.user.id]
      );
      res.json(r.rows);
    } catch (e) {
      await pool.query("ROLLBACK");
      res.status(500).end();
    }
  });

  router.put("/tabs/:id", auth, async (req, res) => {
    const { id } = req.params;
    const name = (req.body.name || "").trim();
    if (!name) return res.status(400).json({ error: "name required" });
    if (name.length > 30)
      return res.status(400).json({ error: "name too long (max 30)" });
    try {
      const r = await pool.query(
        "UPDATE tabs SET name=$1 WHERE id=$2 AND user_id=$3 RETURNING id,name",
        [name, id, req.user.id]
      );
      res.json(r.rows[0]);
    } catch (err) {
      if (err.code === "23505")
        return res.status(400).json({ error: "tab exists" });
      res.status(500).end();
    }
  });

  router.delete("/tabs/:id", auth, async (req, res) => {
    const { id } = req.params;

    // única aba?
    const tabsCount = await pool.query(
      "SELECT COUNT(*)::int c FROM tabs WHERE user_id=$1",
      [req.user.id]
    );
    if (tabsCount.rows[0].c <= 1) {
      return res
        .status(400)
        .json({ error: "cannot delete the only tab in the account" });
    }

    // compras ativas?
    const hasActive = await pool.query(
      "SELECT 1 FROM entitlements WHERE user_id=$1 AND tab_id=$2 AND type='TASK_PACK' AND expires_at>now() LIMIT 1",
      [req.user.id, id]
    );
    if (hasActive.rowCount) {
      return res
        .status(400)
        .json({ error: "cannot delete a tab with active purchases" });
    }

    await pool.query("BEGIN");
    try {
      await pool.query("DELETE FROM tasks WHERE tab_id=$1 AND user_id=$2", [
        id,
        req.user.id,
      ]);
      await pool.query("DELETE FROM tabs WHERE id=$1 AND user_id=$2", [
        id,
        req.user.id,
      ]);
      await pool.query("COMMIT");
      res.status(204).end();
    } catch {
      await pool.query("ROLLBACK");
      res.status(500).end();
    }
  });

  return router;
}

module.exports = { createTabsRoutes };
