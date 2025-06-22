const express = require("express");
const path = require("path");
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
// const port = process.env.WEB_PORT || 3000;

const pool = new Pool({
  user: process.env.POSTGRES_USER || "todo",
  host: process.env.POSTGRES_HOST || "db",
  database: process.env.POSTGRES_DB || "todo",
  password: process.env.POSTGRES_PASSWORD || "todo",
});

async function init(retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password TEXT,
        google_id TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        done BOOLEAN DEFAULT FALSE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE
      )`);
      return;
    } catch (err) {
      console.error("Database not ready, retrying...", err.message);
      await new Promise((res) => setTimeout(res, 3000));
    }
  }
  throw new Error("Could not connect to database");
}

init().catch((err) => {
  console.error(err);
  process.exit(1);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));
app.use("/service-worker.js", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

function generateToken(user) {
  return jwt.sign({ id: user.id, email: user.email }, jwtSecret, {
    expiresIn: "7d",
  });
}

function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "no token" });
  const token = authHeader.split(" ")[1];
  try {
    req.user = jwt.verify(token, jwtSecret);
    next();
  } catch (err) {
    return res.status(401).json({ error: "invalid token" });
  }
}

app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "email and password required" });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      "INSERT INTO users(email,password) VALUES($1,$2) RETURNING id,email",
      [email, hashed]
    );
    return res.json({ token: generateToken(rows[0]) });
  } catch (err) {
    if (err.code === "23505")
      return res.status(400).json({ error: "user exists" });
    console.error(err);
    res.status(500).end();
  }
});

app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await pool.query("SELECT * FROM users WHERE email=$1", [
    email,
  ]);
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
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "invalid google token" });
  }
});

app.get("/api/me", auth, async (req, res) => {
  res.json({ id: req.user.id, email: req.user.email });
});

app.get("/api/tasks", auth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT * FROM tasks WHERE user_id=$1 ORDER BY id DESC",
    [req.user.id]
  );
  res.json(rows);
});

app.post("/api/tasks", auth, async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: "title required" });
  const { rows } = await pool.query(
    "INSERT INTO tasks(title,user_id) VALUES($1,$2) RETURNING *",
    [title, req.user.id]
  );
  res.status(201).json(rows[0]);
});

app.put("/api/tasks/:id", auth, async (req, res) => {
  const { id } = req.params;
  const { title, done } = req.body;
  const { rows } = await pool.query(
    "UPDATE tasks SET title=COALESCE($1,title), done=COALESCE($2,done) WHERE id=$3 AND user_id=$4 RETURNING *",
    [title, done, id, req.user.id]
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

app.listen(port, () => {
  let url = `http://localhost:${port}`;
  let port_web_dev_url = `http://localhost:${port_web_dev}`;
  if (
    process.env.CODESPACE_NAME &&
    process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN
  ) {
    url = `https://${port}-${process.env.CODESPACE_NAME}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
  } else if (process.env.GITPOD_WORKSPACE_URL) {
    const host = process.env.GITPOD_WORKSPACE_URL.replace(/^https?:\/\//, "");
    url = `https://${port}-${host}`;
  }
  console.log(`Server running at ${url}`);
  console.log(`Open ${port_web_dev_url} in your browser.`);
});
