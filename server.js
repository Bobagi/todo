const express = require("express");
const path = require("path");
const fs = require("fs").promises;
const { Pool } = require("pg");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { OAuth2Client } = require("google-auth-library");
require("dotenv").config();

const jwtSecret = process.env.JWT_SECRET || "secret";
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

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
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/service-worker.js", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

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

async function runMigrations() {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id SERIAL PRIMARY KEY, name TEXT UNIQUE, applied_at TIMESTAMPTZ DEFAULT now())"
  );
  const migrationsDirPath = path.join(__dirname, "migrations");
  await fs.mkdir(migrationsDirPath, { recursive: true });
  const migrationFileNames = (await fs.readdir(migrationsDirPath))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const migrationFileName of migrationFileNames) {
    const { rows } = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE name=$1",
      [migrationFileName]
    );
    if (rows.length) continue;
    const migrationSql = await fs.readFile(
      path.join(migrationsDirPath, migrationFileName),
      "utf-8"
    );
    await pool.query(migrationSql);
    await pool.query("INSERT INTO schema_migrations(name) VALUES($1)", [
      migrationFileName,
    ]);
  }
}

app.post("/api/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: "username and password required" });
  try {
    const { rows: existing } = await pool.query(
      "SELECT id FROM users WHERE LOWER(username)=LOWER($1)",
      [username]
    );
    if (existing.length) return res.status(400).json({ error: "user exists" });
    const hashed = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      "INSERT INTO users(username,password) VALUES($1,$2) RETURNING id,username",
      [username, hashed]
    );
    return res.json({ token: generateToken(rows[0]) });
  } catch (err) {
    if (err.code === "23505")
      return res.status(400).json({ error: "user exists" });
    res.status(500).end();
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const { rows } = await pool.query(
    "SELECT * FROM users WHERE LOWER(username)=LOWER($1)",
    [username]
  );
  const user = rows[0];
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
    let user;
    const { rows } = await pool.query(
      "SELECT * FROM users WHERE google_id=$1 OR email=$2",
      [googleId, email]
    );
    user = rows[0];
    if (!user) {
      const result = await pool.query(
        "INSERT INTO users(email,google_id) VALUES($1,$2) RETURNING id,email",
        [email, googleId]
      );
      user = result.rows[0];
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

app.get("/api/tabs", auth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name FROM tabs WHERE user_id=$1 ORDER BY id ASC",
    [req.user.id]
  );
  res.json(rows);
});

app.post("/api/tabs", auth, async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim())
    return res.status(400).json({ error: "name required" });
  try {
    const { rows } = await pool.query(
      "INSERT INTO tabs(name,user_id) VALUES($1,$2) RETURNING id,name",
      [name.trim(), req.user.id]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(400).json({ error: "tab exists" });
    res.status(500).end();
  }
});

app.put("/api/tabs/:id", auth, async (req, res) => {
  const { id } = req.params;
  const { name } = req.body;
  if (!name || !name.trim())
    return res.status(400).json({ error: "name required" });
  try {
    const { rows } = await pool.query(
      "UPDATE tabs SET name=$1 WHERE id=$2 AND user_id=$3 RETURNING id,name",
      [name.trim(), id, req.user.id]
    );
    res.json(rows[0]);
  } catch (err) {
    if (err.code === "23505")
      return res.status(400).json({ error: "tab exists" });
    res.status(500).end();
  }
});

app.delete("/api/tabs/:id", auth, async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM tabs WHERE id=$1 AND user_id=$2", [
    id,
    req.user.id,
  ]);
  res.status(204).end();
});

app.get("/api/tasks", auth, async (req, res) => {
  const tabId = req.query.tabId ? parseInt(req.query.tabId, 10) : null;
  if (tabId) {
    const { rows } = await pool.query(
      "SELECT * FROM tasks WHERE user_id=$1 AND tab_id=$2 ORDER BY id DESC",
      [req.user.id, tabId]
    );
    return res.json(rows);
  }
  const { rows } = await pool.query(
    "SELECT * FROM tasks WHERE user_id=$1 ORDER BY id DESC",
    [req.user.id]
  );
  res.json(rows);
});

async function getDefaultTabId(userId) {
  const { rows } = await pool.query(
    "SELECT id FROM tabs WHERE user_id=$1 ORDER BY id ASC LIMIT 1",
    [userId]
  );
  return rows[0]?.id || null;
}

app.post("/api/tasks", auth, async (req, res) => {
  const { title, tabId } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  const effectiveTabId = tabId || (await getDefaultTabId(req.user.id));
  const { rows } = await pool.query(
    "INSERT INTO tasks(title,user_id,tab_id) VALUES($1,$2,$3) RETURNING *",
    [title, req.user.id, effectiveTabId]
  );
  res.status(201).json(rows[0]);
});

app.put("/api/tasks/:id", auth, async (req, res) => {
  const { id } = req.params;
  const { title, done, tabId } = req.body;
  const { rows } = await pool.query(
    "UPDATE tasks SET title=COALESCE($1,title), done=COALESCE($2,done), tab_id=COALESCE($3,tab_id) WHERE id=$4 AND user_id=$5 RETURNING *",
    [title, done, tabId, id, req.user.id]
  );
  res.json(rows[0]);
});

app.delete("/api/tasks/:id", auth, async (req, res) => {
  const { id } = req.params;
  await pool.query("DELETE FROM tasks WHERE id=$1 AND user_id=$2", [
    id,
    req.user.id,
  ]);
  res.status(204).end();
});

app.get("/*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

async function start() {
  try {
    await runMigrations();
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
