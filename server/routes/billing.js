const express = require("express");
const { readBillingConfigOrDefaults } = require("../billing/config");
const { pool } = require("../pool");

function createBillingRoutes({ auth, stripe, getAllowedTabSlots }) {
  const router = express.Router();

  router.get("/billing/config", auth, async (req, res) => {
    const cfg = await readBillingConfigOrDefaults();
    res.json({
      currency: cfg.currency,
      tab_price_cents: cfg.tab_price_cents,
      task_pack_price_cents: cfg.task_pack_price_cents,
      task_pack_size: cfg.task_pack_size,
      entitlement_days: cfg.entitlement_days,
      base_tabs: cfg.base_tabs,
      base_tasks_per_tab: cfg.base_tasks_per_tab,
    });
  });

  router.get("/billing/my-entitlements", auth, async (req, res) => {
    const r = await pool.query(
      `SELECT e.id, e.type, e.tab_id, t.name AS tab_name, e.amount, e.expires_at,
              (e.expires_at > now()) AS is_active
         FROM entitlements e
         LEFT JOIN tabs t ON t.id = e.tab_id
        WHERE e.user_id = $1
        ORDER BY e.expires_at DESC`,
      [req.user.id]
    );
    res.json(r.rows);
  });

  router.post("/billing/checkout", auth, async (req, res) => {
    const { actionType, tabId } = req.body || {};
    if (actionType === "TASK_PACK" && !tabId)
      return res.status(400).json({ error: "tabId required" });

    if (actionType === "TASK_PACK") {
      const owns = await pool.query(
        "SELECT 1 FROM tabs WHERE id=$1 AND user_id=$2",
        [tabId, req.user.id]
      );
      if (!owns.rowCount)
        return res.status(404).json({ error: "tab not found" });
    }

    const cfg = await readBillingConfigOrDefaults();
    const origin =
      req.headers.origin ||
      (req.headers.referer
        ? new URL(req.headers.referer).origin
        : `http://localhost:${process.env.WEB_PORT || 3000}`);

    let line;
    if (actionType === "TAB_SLOT") {
      line = {
        price_data: {
          currency: cfg.currency,
          product_data: { name: "Additional Tab (30 days)" },
          unit_amount: cfg.tab_price_cents,
        },
        quantity: 1,
      };
    } else if (actionType === "TASK_PACK") {
      line = {
        price_data: {
          currency: cfg.currency,
          product_data: {
            name: `+${cfg.task_pack_size} tasks for tab (30 days)`,
          },
          unit_amount: cfg.task_pack_price_cents,
        },
        quantity: 1,
      };
    } else {
      return res.status(400).json({ error: "invalid actionType" });
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [line],
      success_url: `${origin}/?paid=1&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?canceled=1`,
      metadata: {
        userId: String(req.user.id),
        actionType,
        tabId: tabId ? String(tabId) : "",
      },
    });

    res.json({ url: session.url });
  });

  // DEV
  router.post("/billing/fake-grant", auth, async (req, res) => {
    if (process.env.ALLOW_FAKE_PAYMENTS !== "true") {
      return res.status(403).json({ error: "disabled" });
    }
    try {
      const { actionType, tabId } = req.body || {};
      const cfg = await readBillingConfigOrDefaults();
      const expiresSql = `now() + interval '${cfg.entitlement_days} days'`;
      if (actionType === "TAB_SLOT") {
        await pool.query(
          `INSERT INTO entitlements(user_id,type,tab_id,amount,expires_at) VALUES($1,'TAB_SLOT',NULL,1,${expiresSql})`,
          [req.user.id]
        );
      } else if (actionType === "TASK_PACK" && tabId) {
        await pool.query(
          `INSERT INTO entitlements(user_id,type,tab_id,amount,expires_at) VALUES($1,'TASK_PACK',$2,$3,${expiresSql})`,
          [req.user.id, tabId, cfg.task_pack_size]
        );
      } else {
        return res.status(400).json({ error: "invalid actionType/tabId" });
      }
      res.json({ ok: true });
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "internal" });
    }
  });

  return router;
}

module.exports = { createBillingRoutes };
