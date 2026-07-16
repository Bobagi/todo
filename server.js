const express = require("express");
const path = require("path");
const fs = require("fs");
const cors = require("cors");
const Stripe = require("stripe");
require("dotenv").config();

const { pool } = require("./server/pool");
const { auth, generateToken } = require("./server/auth");
const { runMigrations } = require("./server/migrations"); // opcional
const { ensureBillingConfigDefaults } = require("./server/billing/config");
const { createAuthRoutes } = require("./server/routes/auth");
const { createBillingRoutes } = require("./server/routes/billing");
const { createTabsRoutes } = require("./server/routes/tabs");
const { createTasksRoutes } = require("./server/routes/tasks");
const { stripeWebhookRouter } = require("./server/billing/webhook");

const stripe = Stripe(process.env.STRIPE_SECRET_KEY || "", {
  apiVersion: "2023-10-16",
});

const app = express();
const port = 3000;
const port_web_dev = process.env.WEB_PORT || 3000;

app.use(cors());

// Webhook Stripe precisa vir ANTES do express.json para manter o raw body
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookRouter(stripe)
);

// JSON depois do webhook
app.use(express.json());

// index.html is served with the (public) Google client id injected from env — a Google
// client id is exposed in the browser by design, so this is not a secret. Serving it here
// (instead of the raw static file) is what makes the "Sign in with Google" button real.
const INDEX_HTML = fs.readFileSync(
  path.join(__dirname, "public", "index.html"),
  "utf8"
);
function sendIndex(req, res) {
  // Defense-in-depth: only inject a well-formed Google client id so a malformed env value
  // can never break out of the JS string / <script> context. Bad value => empty (feature off).
  const raw = process.env.GOOGLE_CLIENT_ID || "";
  const clientId = /^[\w-]+\.apps\.googleusercontent\.com$/.test(raw) ? raw : "";
  res.type("html").send(INDEX_HTML.replace(/%GOOGLE_CLIENT_ID%/g, clientId));
}
app.get(["/", "/index.html"], sendIndex);

// static (index:false so "/" and "/index.html" don't bypass the injection above)
app.use(express.static(path.join(__dirname, "public"), { index: false }));
app.use("/service-worker.js", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Rotas
app.use("/api", createAuthRoutes({ pool, generateToken }));
app.use("/api", createBillingRoutes({ auth, stripe }));
app.use("/api", createTabsRoutes({ auth }));
app.use("/api", createTasksRoutes({ auth }));

// me
app.get("/api/me", auth, async (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    email: req.user.email,
  });
});

// SPA fallback
app.get("/*", sendIndex);

async function start() {
  try {
    await runMigrations(); // não faz nada se não houver /migrations
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
