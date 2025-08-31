const express = require("express");
const path = require("path");
const fs = require("fs").promises;
const { Pool } = require("pg");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
const Stripe = require("stripe");
require("dotenv").config();

const jwtSecret = process.env.JWT_SECRET || "secret";
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const stripe = Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

const app = express();
const port = 3000;
const port_web_dev = process.env.WEB_PORT || 3000;

const pool = new Pool({
  user: process.env.POSTGRES_USER || "todo",
  host: process.env.POSTGRES_HOST || "db",
  database: process.env.POSTGRES_DB || "todo",
  password: process.env.POSTGRES_PASSWORD || "todo",
});

app.use(cors());
app.use(express.static(path.join(__dirname, "public")));
app.use("/service-worker.js", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

/* -------------------- STRIPE WEBHOOK (RAW) -------------------- */
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch {
      return res.status(400).send("invalid signature");
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const metadata = session.metadata || {};
        const userId = parseInt(metadata.userId || "0", 10);
        const actionType = metadata.actionType || "";
        const tabId = metadata.tabId ? parseInt(metadata.tabId, 10) : null;
        const paymentIntentId = session.payment_intent;
        const amountCents = session.amount_total || 0;
        const currency = session.currency || "brl";

        const exists = await pool.query(
          "SELECT 1 FROM payments WHERE stripe_payment_intent_id=$1",
          [paymentIntentId]
        );
        if (!exists.rowCount && userId) {
          await pool.query(
            "INSERT INTO payments(user_id,stripe_payment_intent_id,amount_cents,currency,action_type,tab_id,quantity) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              userId,
              paymentIntentId,
              amountCents,
              currency,
              actionType,
              tabId,
              null,
            ]
          );

          const cfg = await readBillingConfigOrDefaults();
          const expiresSql = `now() + interval '${cfg.entitlement_days} days'`;

          if (actionType === "TAB_SLOT") {
            await pool.query(
              `INSERT INTO entitlements(user_id,type,tab_id,amount,expires_at) VALUES($1,'TAB_SLOT',NULL,1,${expiresSql})`,
              [userId]
            );
          }
          if (actionType === "TASK_PACK" && tabId) {
            await pool.query(
              `INSERT INTO entitlements(user_id,type,tab_id,amount,expires_at) VALUES($1,'TASK_PACK',$2,$3,${expiresSql})`,
              [userId, tabId, cfg.task_pack_size || 6]
            );
          }
        }
      }
    } catch (err) {
      console.error("webhook error:", err);
      return res.status(500).end();
    }
    res.json({ received: true });
  }
);

app.use(express.json());

/* -------------------- AUTH -------------------- */
function generateToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    jwtSecret,
    { expiresIn: "7d" }
  );
}
function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "no token" });
  const token = authHeader.split(" ")[1];
  try {
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
}

/* -------------------- MIGRATIONS (raw /migrations) -------------------- */
async function runMigrations() {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id SERIAL PRIMARY KEY, name TEXT UNIQUE, applied_at TIMESTAMPTZ DEFAULT now())"
  );
  const dir = path.join(__dirname, "migrations");
  await fs.mkdir(dir, { recursive: true });
  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const seen = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE name=$1",
      [f]
    );
    if (seen.rowCount) continue;
    const sql = await fs.readFile(path.join(dir, f), "utf-8");
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations(name) VALUES($1)", [f]);
  }
}

/* -------------------- BILLING HELPERS -------------------- */
async function readBillingConfig() {
  const r = await pool.query("SELECT * FROM billing_config LIMIT 1");
  return r.rows[0];
}
async function readBillingConfigOrDefaults() {
  let cfg = await readBillingConfig();
  if (!cfg) {
    cfg = {
      currency: "brl",
      tab_price_cents: 200,
      task_pack_price_cents: 200,
      task_pack_size: 6,
      entitlement_days: 30,
      base_tabs: 1,
      base_tasks_per_tab: 6,
    };
  }
  return cfg;
}

async function getActiveSum(userId, type, tabId) {
  if (tabId) {
    const r = await pool.query(
      "SELECT COALESCE(SUM(amount),0) s FROM entitlements WHERE user_id=$1 AND type=$2 AND tab_id=$3 AND expires_at>now()",
      [userId, type, tabId]
    );
    return parseInt(r.rows[0].s || 0, 10);
  } else {
    const r = await pool.query(
      "SELECT COALESCE(SUM(amount),0) s FROM entitlements WHERE user_id=$1 AND type=$2 AND tab_id IS NULL AND expires_at>now()",
      [userId, type]
    );
    return parseInt(r.rows[0].s || 0, 10);
  }
}
async function getAllowedTabSlots(userId) {
  const cfg = await readBillingConfigOrDefaults();
  const extra = await getActiveSum(userId, "TAB_SLOT", null);
  return (cfg.base_tabs || 1) + extra;
}
async function getAllowedTasksForTab(userId, tabId) {
  const cfg = await readBillingConfigOrDefaults();
  const extra = await getActiveSum(userId, "TASK_PACK", tabId);
  return (cfg.base_tasks_per_tab || 6) + extra;
}

/* -------------------- AUTH ENDPOINTS -------------------- */
app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "username and password required" });
  try {
    const existing = await pool.query(
      "SELECT id FROM users WHERE LOWER(username)=LOWER($1)",
      [username]
    );
    if (existing.rowCount)
      return res.status(400).json({ error: "user exists" });
    const hashed = await bcrypt.hash(password, 10);
    const ins = await pool.query(
      "INSERT INTO users(username,password) VALUES($1,$2) RETURNING id,username",
      [username, hashed]
    );
    // única criação automática: primeiro login/registro
    await pool.query(
      "INSERT INTO tabs(name,user_id,position) VALUES($1,$2,1)",
      ["Inbox", ins.rows[0].id]
    );
    return res.json({ token: generateToken(ins.rows[0]) });
  } catch (err) {
    if (err.code === "23505")
      return res.status(400).json({ error: "user exists" });
    res.status(500).end();
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const r = await pool.query(
    "SELECT * FROM users WHERE LOWER(username)=LOWER($1)",
    [username]
  );
  const user = r.rows[0];
  if (!user || !(await bcrypt.compare(password, user.password || ""))) {
    return res.status(400).json({ error: "invalid credentials" });
  }
  res.json({ token: generateToken(user) });
});

app.post("/api/google-login", async (req, res) => {
  const { idToken } = req.body;
  if (!idToken) return res.status(400).json({ error: "idToken required" });
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const googleId = payload.sub;
    const email = payload.email;

    const r = await pool.query(
      "SELECT * FROM users WHERE google_id=$1 OR email=$2",
      [googleId, email]
    );
    let user = r.rows[0];
    if (!user) {
      const result = await pool.query(
        "INSERT INTO users(email,google_id) VALUES($1,$2) RETURNING id,email",
        [email, googleId]
      );
      user = result.rows[0];
      await pool.query(
        "INSERT INTO tabs(name,user_id,position) VALUES($1,$2,1)",
        ["Inbox", user.id]
      );
    }
    res.json({ token: generateToken(user) });
  } catch {
    res.status(400).json({ error: "invalid google token" });
  }
});

app.get("/api/me", auth, async (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    email: req.user.email,
  });
});

/* -------------------- BILLING ENDPOINTS -------------------- */
app.get("/api/billing/config", auth, async (req, res) => {
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

app.get("/api/billing/my-entitlements", auth, async (req, res) => {
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

app.post("/api/billing/checkout", auth, async (req, res) => {
  const { actionType, tabId } = req.body || {};
  if (actionType === "TASK_PACK" && !tabId)
    return res.status(400).json({ error: "tabId required" });

  if (actionType === "TASK_PACK") {
    const owns = await pool.query(
      "SELECT 1 FROM tabs WHERE id=$1 AND user_id=$2",
      [tabId, req.user.id]
    );
    if (!owns.rowCount) return res.status(404).json({ error: "tab not found" });
  }

  const cfg = await readBillingConfigOrDefaults();
  const origin =
    req.headers.origin ||
    (req.headers.referer
      ? new URL(req.headers.referer).origin
      : `http://localhost:${port_web_dev}`);

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
    payment_method_types: ["card"], // simples/compatível
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

// DEV: concede crédito local sem Stripe
app.post("/api/billing/fake-grant", auth, async (req, res) => {
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

/* -------------------- TABS -------------------- */
app.get("/api/tabs", auth, async (req, res) => {
  const r = await pool.query(
    "SELECT id, name, position FROM tabs WHERE user_id=$1 ORDER BY position ASC, id ASC",
    [req.user.id]
  );
  res.json(r.rows);
});

// capacidade p/ criar nova aba
app.get("/api/tabs/capacity", auth, async (req, res) => {
  const allowed = await getAllowedTabSlots(req.user.id);
  const current = (
    await pool.query("SELECT COUNT(*)::int c FROM tabs WHERE user_id=$1", [
      req.user.id,
    ])
  ).rows[0].c;
  res.json({ allowed, current, canCreate: current < allowed });
});

app.post("/api/tabs", auth, async (req, res) => {
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

app.post("/api/tabs/reorder", auth, async (req, res) => {
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

app.put("/api/tabs/:id", auth, async (req, res) => {
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

app.delete("/api/tabs/:id", auth, async (req, res) => {
  const { id } = req.params;
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

/* -------------------- TASKS -------------------- */
app.get("/api/tasks", auth, async (req, res) => {
  const tabId = req.query.tabId ? parseInt(req.query.tabId, 10) : null;
  if (tabId) {
    const r = await pool.query(
      "SELECT * FROM tasks WHERE user_id=$1 AND tab_id=$2 ORDER BY id DESC",
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

async function getDefaultTabId(userId) {
  const r = await pool.query(
    "SELECT id FROM tabs WHERE user_id=$1 ORDER BY position ASC, id ASC LIMIT 1",
    [userId]
  );
  return r.rows[0]?.id || null;
}

app.post("/api/tasks", auth, async (req, res) => {
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

  const r = await pool.query(
    "INSERT INTO tasks(title,user_id,tab_id) VALUES($1,$2,$3) RETURNING *",
    [title, req.user.id, effectiveTabId]
  );
  res.status(201).json(r.rows[0]);
});

app.put("/api/tasks/:id", auth, async (req, res) => {
  const { id } = req.params;
  const { title, done, tabId } = req.body;
  const r = await pool.query(
    "UPDATE tasks SET title=COALESCE($1,title), done=COALESCE($2,done), tab_id=COALESCE($3,tab_id) WHERE id=$4 AND user_id=$5 RETURNING *",
    [title, done, tabId, id, req.user.id]
  );
  res.json(r.rows[0]);
});

app.delete("/api/tasks/:id", auth, async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM tasks WHERE id=$1 AND user_id=$2", [
    id,
    req.user.id,
  ]);
  res.status(204).end();
});

/* -------------------- SPA FALLBACK -------------------- */
app.get("/*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function ensureBillingConfigDefaults() {
  const r = await pool.query("SELECT COUNT(*)::int c FROM billing_config");
  if (!r.rows[0].c) {
    await pool.query(
      `INSERT INTO billing_config
      (currency, tab_price_cents, task_pack_price_cents, task_pack_size, entitlement_days, base_tabs, base_tasks_per_tab)
      VALUES ('brl', 200, 200, 6, 30, 1, 6)`
    );
  }
}

async function start() {
  try {
    await runMigrations();
    await ensureBillingConfigDefaults();
    app.listen(port, () => {
      let url = `http://localhost:${port}`;
      let port_web_dev_url = `http://localhost:${port_web_dev}`;
      if (
        process.env.CODESPACE_NAME &&
        process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
      ) {
        url = `https://${port}-${process.env.CODESPACE_NAME}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
      } else if (process.env.GITPOD_WORKSPACE_URL) {
        const host = process.env.GITPOD_WORKSPACE_URL.replace(
          /^https?:\/\//,
          ""
        );
        url = `https://${port}-${host}`;
      }
      console.log(`Server running at ${url}`);
      console.log(`Open ${port_web_dev_url} in your browser.`);
    });
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
}

start();
