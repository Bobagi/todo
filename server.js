const express = require("express");
const path = require("path");
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

// static
app.use(express.static(path.join(__dirname, "public")));
app.use("/service-worker.js", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Rotas
app.use("/api", createAuthRoutes({ pool, generateToken }));
app.use("/api", createBillingRoutes({ auth, stripe }));
app.use("/api", createTabsRoutes({ auth }));
app.use("/api", createTasksRoutes({ auth }));

app.get("/api/compose/services", (req, res) => {
  const projectName =
    process.env.COMPOSE_PROJECT_NAME || path.basename(process.cwd());
  const toPort = (value, fallback = null) => {
    if (value === undefined || value === null || value === "") {
      return fallback;
    }
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : value;
  };

  const services = [
    {
      id: "web",
      label: "Web",
      containerName: `${projectName}-web-1`,
      image: `${projectName}-web:latest`,
      internalPort: 3000,
      externalPort: toPort(process.env.WEB_PORT, 3000),
      protocol: "http",
      note: "Interface principal do app.",
    },
    {
      id: "studio",
      label: "Prisma Studio",
      containerName: `${projectName}-studio-1`,
      image: `${projectName}-studio:latest`,
      internalPort: 5555,
      externalPort: toPort(process.env.PRISMA_STUDIO_PORT, 5555),
      protocol: "http",
      note: "Ferramenta de inspeção do banco de dados.",
    },
    {
      id: "db",
      label: "PostgreSQL",
      containerName: `${projectName}-db-1`,
      image: "postgres:14",
      internalPort: 5432,
      externalPort:
        toPort(
          process.env.POSTGRES_EXTERNAL_PORT || process.env.POSTGRES_PORT,
          null
        ),
      protocol: "tcp",
      note: "Banco acessível apenas internamente por padrão.",
    },
  ];

  res.json(services);
});

// me
app.get("/api/me", auth, async (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    email: req.user.email,
  });
});

// SPA fallback
app.get("/*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

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
