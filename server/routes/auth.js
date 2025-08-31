const express = require("express");
const bcrypt = require("bcrypt");
const { OAuth2Client } = require("google-auth-library");
const { pool } = require("../pool");

const TOS_VERSION = "v1";
const PRIV_VERSION = "v1";

// validações mínimas
const USER_RE = /^[a-zA-Z0-9_]{3,30}$/;
function isValidUsername(s = "") {
  return USER_RE.test(s);
}
function isStrongPassword(p = "") {
  // 8–72 (bcrypt), 1 minúscula, 1 maiúscula, 1 dígito, 1 especial
  if (typeof p !== "string") return false;
  if (p.length < 8 || p.length > 72) return false;
  const hasLower = /[a-z]/.test(p);
  const hasUpper = /[A-Z]/.test(p);
  const hasDigit = /\d/.test(p);
  const hasSpecial = /[^A-Za-z0-9]/.test(p);
  return hasLower && hasUpper && hasDigit && hasSpecial;
}

function clientIp(req) {
  return (
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.ip || null
  );
}

async function logAccess(userId, eventType, req) {
  try {
    await pool.query(
      "INSERT INTO access_logs(user_id,event_type,ip,user_agent) VALUES($1,$2,$3,$4)",
      [
        userId || null,
        eventType,
        clientIp(req),
        req.headers["user-agent"] || null,
      ]
    );
  } catch {}
}

function createAuthRoutes({ pool, generateToken }) {
  const router = express.Router();
  const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  router.post("/register", async (req, res) => {
    const { username, password, acceptLegal } = req.body || {};
    if (!username || !password)
      return res.status(400).json({ error: "username and password required" });

    if (!isValidUsername(username))
      return res
        .status(400)
        .json({ error: "username must be 3–30 chars (letters, numbers, _)" });

    if (!isStrongPassword(password))
      return res.status(400).json({
        error:
          "password must be 8–72 chars, with upper, lower, digit and special",
      });

    if (!acceptLegal)
      return res.status(400).json({ error: "terms/privacy must be accepted" });

    try {
      const existing = await pool.query(
        "SELECT id FROM users WHERE LOWER(username)=LOWER($1)",
        [username]
      );
      if (existing.rowCount)
        return res.status(400).json({ error: "user exists" });

      const hashed = await bcrypt.hash(password, 10);
      const ins = await pool.query(
        `INSERT INTO users(username,password,tos_version,tos_accepted_at,privacy_version,privacy_accepted_at)
         VALUES($1,$2,$3,now(),$4,now())
         RETURNING id,username`,
        [username, hashed, TOS_VERSION, PRIV_VERSION]
      );

      // primeira aba padrão
      await pool.query(
        "INSERT INTO tabs(name,user_id,position) VALUES($1,$2,1)",
        ["Tasks", ins.rows[0].id]
      );

      await logAccess(ins.rows[0].id, "register", req);
      return res.json({ token: generateToken(ins.rows[0]) });
    } catch (err) {
      if (err.code === "23505")
        return res.status(400).json({ error: "user exists" });
      res.status(500).end();
    }
  });

  router.post("/login", async (req, res) => {
    const { username, password } = req.body || {};
    const r = await pool.query(
      "SELECT * FROM users WHERE LOWER(username)=LOWER($1)",
      [username]
    );
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password || "", user.password || ""))) {
      return res.status(400).json({ error: "invalid credentials" });
    }
    await logAccess(user.id, "login", req);
    res.json({ token: generateToken(user) });
  });

  // (Google login – deixamos aqui preparado, mesmo não estando ativo agora)
  router.post("/google-login", async (req, res) => {
    const { idToken } = req.body || {};
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
          `INSERT INTO users(email,google_id,tos_version,tos_accepted_at,privacy_version,privacy_accepted_at)
           VALUES($1,$2,$3,now(),$4,now()) RETURNING id,email`,
          [email, googleId, TOS_VERSION, PRIV_VERSION]
        );
        user = result.rows[0];
        await pool.query(
          "INSERT INTO tabs(name,user_id,position) VALUES($1,$2,1)",
          ["Tasks", user.id]
        );
      }
      await logAccess(user.id, "login", req);
      res.json({ token: generateToken(user) });
    } catch {
      res.status(400).json({ error: "invalid google token" });
    }
  });

  return router;
}

module.exports = { createAuthRoutes };
