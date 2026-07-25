const express = require("express");
const { pool } = require("../pool");

// Categories live here (single source of truth) and are shipped to the client in
// GET /inventory, so the icon/label list can never drift between front and back.
const CATEGORIES = [
  { key: "top", label: "Top", icon: "ph-t-shirt" },
  { key: "bottom", label: "Bottom", icon: "ph-pants" },
  { key: "underwear", label: "Underwear", icon: "ph-coat-hanger" },
  { key: "shoes", label: "Shoes", icon: "ph-sneaker" },
  { key: "outerwear", label: "Outerwear", icon: "ph-hoodie" },
  { key: "toiletries", label: "Toiletries", icon: "ph-drop" },
  { key: "electronics", label: "Electronics", icon: "ph-devices" },
  { key: "charger", label: "Charger / cable", icon: "ph-plug-charging" },
  { key: "meds", label: "Meds", icon: "ph-pill" },
  { key: "documents", label: "Documents", icon: "ph-identification-card" },
  { key: "other", label: "Other", icon: "ph-package" },
];
const CATEGORY_KEYS = new Set(CATEGORIES.map((c) => c.key));

// Guardrails, not billing: the store is frozen, inventory is free. These only
// stop a single account from turning the table into a dumping ground.
const MAX_LOCATIONS = 12;
const MAX_ITEMS = 500;
const NAME_MAX = 80;
const LOCATION_NAME_MAX = 40;
const NOTES_MAX = 200;
const QTY_MAX = 999;
const MOVE_BATCH_MAX = 200;

/** Positive 32-bit int or null — never let a NaN/float/huge value reach SQL. */
function toId(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 2147483647) return null;
  return n;
}

/** Trim + collapse inner whitespace; returns "" when there's nothing left. */
function cleanText(v, max) {
  if (typeof v !== "string") return "";
  return v.replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * Express 4 does not forward rejections from async handlers: an unhandled throw
 * would leave the request hanging forever. Everything below is wrapped.
 */
const wrap = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

// Advisory-lock namespaces (two-int32 form — a separate space from any
// single-bigint lock). One per counted resource so the two never queue on
// each other.
const LOCK_LOCATIONS = 47110;
const LOCK_ITEMS = 47111;

/**
 * Counting rows and then inserting is a check-then-act: N concurrent requests
 * all read the same stale count and every one of them passes, so the cap is
 * whatever the burst size is. Serialise the count+insert per user with a
 * transaction-scoped advisory lock — the lock releases on COMMIT/ROLLBACK.
 * `fn` returns { status, body }, which is sent only after the commit.
 */
async function withUserLock(ns, userId, fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock($1,$2)", [ns, userId]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

function createInventoryRoutes({ auth }) {
  const router = express.Router();

  // ---- read everything (the dataset is small; one round-trip keeps the UI simple)
  router.get("/inventory", auth, wrap(async (req, res) => {
    const [locations, items] = await Promise.all([
      pool.query(
        "SELECT id, name, position FROM inv_locations WHERE user_id=$1 ORDER BY position ASC, id ASC",
        [req.user.id]
      ),
      pool.query(
        `SELECT id, name, category, qty, notes, location_id, updated_at
           FROM inv_items WHERE user_id=$1 ORDER BY LOWER(name) ASC, id ASC`,
        [req.user.id]
      ),
    ]);
    res.json({
      locations: locations.rows,
      items: items.rows,
      categories: CATEGORIES,
      limits: { maxLocations: MAX_LOCATIONS, maxItems: MAX_ITEMS },
    });
  }));

  // ---- locations ---------------------------------------------------------
  router.post("/inventory/locations", auth, wrap(async (req, res) => {
    const name = cleanText(req.body?.name, LOCATION_NAME_MAX);
    if (!name) return res.status(400).json({ error: "name required" });

    try {
      const out = await withUserLock(LOCK_LOCATIONS, req.user.id, async (client) => {
        const c = await client.query(
          "SELECT COUNT(*)::int AS c FROM inv_locations WHERE user_id=$1",
          [req.user.id]
        );
        if (c.rows[0].c >= MAX_LOCATIONS)
          return { status: 400, body: { error: `at most ${MAX_LOCATIONS} places` } };

        const r = await client.query(
          `INSERT INTO inv_locations(user_id, name, position)
             VALUES($1, $2, (SELECT COALESCE(MAX(position),0)+1 FROM inv_locations WHERE user_id=$1))
           RETURNING id, name, position`,
          [req.user.id, name]
        );
        return { status: 201, body: r.rows[0] };
      });
      res.status(out.status).json(out.body);
    } catch (err) {
      if (err.code === "23505")
        return res.status(409).json({ error: "you already have a place with that name" });
      throw err;
    }
  }));

  router.put("/inventory/locations/:id", auth, wrap(async (req, res) => {
    const id = toId(req.params.id);
    const name = cleanText(req.body?.name, LOCATION_NAME_MAX);
    if (!id) return res.status(400).json({ error: "bad id" });
    if (!name) return res.status(400).json({ error: "name required" });
    try {
      const r = await pool.query(
        "UPDATE inv_locations SET name=$1 WHERE id=$2 AND user_id=$3 RETURNING id, name, position",
        [name, id, req.user.id]
      );
      if (!r.rowCount) return res.status(404).json({ error: "not found" });
      res.json(r.rows[0]);
    } catch (err) {
      if (err.code === "23505")
        return res.status(409).json({ error: "you already have a place with that name" });
      throw err;
    }
  }));

  // Deleting a place keeps its items (they become "somewhere unknown") so a
  // mistyped place name can never wipe the catalogue.
  router.delete("/inventory/locations/:id", auth, wrap(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: "bad id" });
    const orphaned = await pool.query(
      "SELECT COUNT(*)::int AS c FROM inv_items WHERE user_id=$1 AND location_id=$2",
      [req.user.id, id]
    );
    const r = await pool.query(
      "DELETE FROM inv_locations WHERE id=$1 AND user_id=$2",
      [id, req.user.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: "not found" });
    res.json({ orphaned: orphaned.rows[0].c });
  }));

  // ---- items -------------------------------------------------------------
  router.post("/inventory/items", auth, wrap(async (req, res) => {
    const name = cleanText(req.body?.name, NAME_MAX);
    if (!name) return res.status(400).json({ error: "name required" });

    const category = CATEGORY_KEYS.has(req.body?.category)
      ? req.body.category
      : "other";
    // Out of range clamps to the cap rather than silently resetting to 1 —
    // someone typing 1000 socks meant "a lot", not "one".
    const qtyRaw = toId(req.body?.qty);
    const qty = qtyRaw ? Math.min(qtyRaw, QTY_MAX) : 1;
    const notes = cleanText(req.body?.notes, NOTES_MAX) || null;

    const out = await withUserLock(LOCK_ITEMS, req.user.id, async (client) => {
      const c = await client.query(
        "SELECT COUNT(*)::int AS c FROM inv_items WHERE user_id=$1",
        [req.user.id]
      );
      if (c.rows[0].c >= MAX_ITEMS)
        return { status: 400, body: { error: `at most ${MAX_ITEMS} items` } };

      // A location id from the client is only trusted after we prove it's this
      // user's — otherwise you could file items into someone else's place.
      let locationId = toId(req.body?.locationId);
      if (locationId) {
        const own = await client.query(
          "SELECT 1 FROM inv_locations WHERE id=$1 AND user_id=$2",
          [locationId, req.user.id]
        );
        if (!own.rowCount) return { status: 400, body: { error: "unknown place" } };
      } else {
        const first = await client.query(
          "SELECT id FROM inv_locations WHERE user_id=$1 ORDER BY position ASC, id ASC LIMIT 1",
          [req.user.id]
        );
        locationId = first.rows[0]?.id ?? null;
      }

      const r = await client.query(
        `INSERT INTO inv_items(user_id, name, category, qty, notes, location_id)
           VALUES($1,$2,$3,$4,$5,$6)
         RETURNING id, name, category, qty, notes, location_id, updated_at`,
        [req.user.id, name, category, qty, notes, locationId]
      );
      return { status: 201, body: r.rows[0] };
    });
    res.status(out.status).json(out.body);
  }));

  router.put("/inventory/items/:id", auth, wrap(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: "bad id" });

    const has = (k) => Object.prototype.hasOwnProperty.call(req.body || {}, k);
    const name = has("name") ? cleanText(req.body.name, NAME_MAX) : null;
    if (has("name") && !name)
      return res.status(400).json({ error: "name required" });

    const category =
      has("category") && CATEGORY_KEYS.has(req.body.category)
        ? req.body.category
        : null;
    const qtyRaw = has("qty") ? toId(req.body.qty) : null;
    const qty = qtyRaw ? Math.min(qtyRaw, QTY_MAX) : null;
    const notes = has("notes") ? cleanText(req.body.notes, NOTES_MAX) : null;

    // Location changes go through POST /inventory/move so every relocation is
    // written to the history — this endpoint deliberately can't set location_id.
    const r = await pool.query(
      `UPDATE inv_items
          SET name=COALESCE($1,name), category=COALESCE($2,category),
              qty=COALESCE($3,qty), notes=COALESCE($4,notes), updated_at=now()
        WHERE id=$5 AND user_id=$6
      RETURNING id, name, category, qty, notes, location_id, updated_at`,
      [name || null, category, qty, notes, id, req.user.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: "not found" });
    res.json(r.rows[0]);
  }));

  router.delete("/inventory/items/:id", auth, wrap(async (req, res) => {
    const id = toId(req.params.id);
    if (!id) return res.status(400).json({ error: "bad id" });
    const r = await pool.query(
      "DELETE FROM inv_items WHERE id=$1 AND user_id=$2",
      [id, req.user.id]
    );
    if (!r.rowCount) return res.status(404).json({ error: "not found" });
    res.status(204).end();
  }));

  // ---- the central operation: move items to a place ("packing") ----------
  router.post("/inventory/move", auth, wrap(async (req, res) => {
    const ids = Array.isArray(req.body?.itemIds) ? req.body.itemIds : [];
    if (!ids.length) return res.status(400).json({ error: "itemIds required" });
    if (ids.length > MOVE_BATCH_MAX)
      return res.status(400).json({ error: "too many items at once" });

    const itemIds = ids.map(toId);
    if (itemIds.some((n) => n === null))
      return res.status(400).json({ error: "bad item id" });

    // toLocationId null is legal and means "unknown place".
    const toLocationId = toId(req.body?.toLocationId);
    if (req.body?.toLocationId != null && toLocationId === null)
      return res.status(400).json({ error: "bad place id" });

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Ownership of the destination is checked inside the transaction, against
      // this user only — a place id belonging to another account must not resolve.
      let toName = null;
      if (toLocationId !== null) {
        const dest = await client.query(
          "SELECT name FROM inv_locations WHERE id=$1 AND user_id=$2",
          [toLocationId, req.user.id]
        );
        if (!dest.rowCount) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: "unknown place" });
        }
        toName = dest.rows[0].name;
      }

      // Lock the rows we're about to move so two concurrent moves can't
      // interleave and write a history that contradicts the final location.
      const owned = await client.query(
        `SELECT i.id, i.name, i.location_id, l.name AS from_name
           FROM inv_items i
           LEFT JOIN inv_locations l ON l.id = i.location_id AND l.user_id = i.user_id
          WHERE i.user_id=$1 AND i.id = ANY($2::int[])
          ORDER BY i.id
            FOR UPDATE OF i`,
        [req.user.id, itemIds]
      );
      if (owned.rowCount !== new Set(itemIds).size) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "some items not found" });
      }

      const movedIds = owned.rows
        .filter((row) => row.location_id !== toLocationId)
        .map((row) => row.id);

      if (movedIds.length) {
        await client.query(
          "UPDATE inv_items SET location_id=$1, updated_at=now() WHERE user_id=$2 AND id = ANY($3::int[])",
          [toLocationId, req.user.id, movedIds]
        );
        for (const row of owned.rows) {
          if (row.location_id === toLocationId) continue;
          await client.query(
            `INSERT INTO inv_moves(user_id, item_id, item_name, from_location_id, from_name, to_location_id, to_name)
               VALUES($1,$2,$3,$4,$5,$6,$7)`,
            [
              req.user.id,
              row.id,
              row.name,
              row.location_id,
              row.from_name,
              toLocationId,
              toName,
            ]
          );
        }
      }

      await client.query("COMMIT");
      res.json({ moved: movedIds.length, toLocationId });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }));

  // ---- history: "what did I take last time?" -----------------------------
  router.get("/inventory/moves", auth, wrap(async (req, res) => {
    const limit = Math.min(toId(req.query.limit) || 40, 200);
    const r = await pool.query(
      `SELECT id, item_name, from_name, to_name, moved_at
         FROM inv_moves WHERE user_id=$1 ORDER BY moved_at DESC, id DESC LIMIT $2`,
      [req.user.id, limit]
    );
    res.json(r.rows);
  }));

  return router;
}

module.exports = { createInventoryRoutes, CATEGORIES };
