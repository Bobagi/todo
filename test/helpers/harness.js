// Test harness: builds a THROWAWAY database, applies the real migrations to it,
// and boots the real Express app against it on an ephemeral port.
//
// The production database is never touched: POSTGRES_DB is overridden before
// anything requires server/pool.js (dotenv does not override an env var that is
// already set, so this wins over .env).
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");

const TEST_DB = process.env.TEST_DB || "todo_test";
process.env.POSTGRES_DB = TEST_DB;

const ROOT = path.join(__dirname, "..", "..");

function adminClient(database) {
  return new Client({
    user: process.env.POSTGRES_USER || "todo",
    host: process.env.POSTGRES_HOST || "db",
    password: process.env.POSTGRES_PASSWORD || "todo",
    database,
  });
}

/** Drop + recreate the test database and replay every migration in order. */
async function resetDatabase() {
  const admin = adminClient("postgres");
  await admin.connect();
  await admin.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()`,
    [TEST_DB]
  );
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB}`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();

  const dir = path.join(ROOT, "prisma", "migrations");
  const migrations = fs.readdirSync(dir).sort();
  const db = adminClient(TEST_DB);
  await db.connect();
  for (const m of migrations) {
    const file = path.join(dir, m, "migration.sql");
    if (fs.existsSync(file)) await db.query(fs.readFileSync(file, "utf8"));
  }
  await db.end();
}

/** Boot the real app; returns { url, close }. */
async function startApp() {
  const { app } = require(path.join(ROOT, "server.js"));
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address();
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => server.close(resolve)).then(() =>
        require(path.join(ROOT, "server", "pool.js")).pool.end()
      ),
  };
}

/** Register a fresh user and return its auth headers. */
async function newUser(url, prefix = "u") {
  const username = `${prefix}${Math.random().toString(36).slice(2, 10)}`;
  const res = await fetch(`${url}/api/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password: "Aa1!aaaa", acceptLegal: true }),
  });
  const body = await res.json();
  if (!body.token) throw new Error(`register failed: ${JSON.stringify(body)}`);
  return {
    username,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${body.token}`,
    },
  };
}

/** Small fetch wrapper returning { status, body }. */
async function call(url, method, route, headers, payload) {
  const res = await fetch(url + route, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

module.exports = { resetDatabase, startApp, newUser, call, adminClient, TEST_DB };
