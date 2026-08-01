const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const { OAuth2Client } = require("google-auth-library");
const { pool } = require("../pool");
const mailer = require("../email");
const { passwordResetEmail } = require("../email_templates");

const TOS_VERSION = "v2";
const PRIV_VERSION = "v2";

// Password-reset tokens: raw token emailed, only the SHA-256 hash stored, valid 1h, single-use.
const RESET_TTL_MS = 60 * 60 * 1000;
const RESET_LOCALES = new Set(["pt", "en"]);
const APP_BASE_URL = (process.env.APP_BASE_URL || "").replace(/\/+$/, "");
const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");

// validações mínimas
const USER_RE = /^[a-zA-Z0-9_]{3,30}$/;
function isValidUsername(s = "") {
  return USER_RE.test(s);
}
// E-mail agora é obrigatório no cadastro por senha (habilita reset/verificação no futuro).
// Checagem pragmática — o mesmo padrão do cliente; este é o gate real (server-side).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isValidEmail(s = "") {
  return typeof s === "string" && s.length >= 3 && s.length <= 255 && EMAIL_RE.test(s);
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

// Constant-time login: the "no such user" (or Google-only account with no password) branch
// must still run a FULL bcrypt compare against a REAL hash — otherwise `||` short-circuits,
// bcrypt never runs, and that path returns ~25× faster, leaking username existence via timing
// (enumeration oracle, rubric class 3). Computed once at module load (cost 10 = same as stored).
const DECOY_HASH = bcrypt.hashSync("timing-decoy-not-a-password", 10);

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
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    if (!username || !password)
      return res.status(400).json({ error: "username and password required" });

    if (!isValidUsername(username))
      return res
        .status(400)
        .json({ error: "username must be 3–30 chars (letters, numbers, _)" });

    if (!isValidEmail(email))
      return res.status(400).json({ error: "a valid email is required" });

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

      const emailTaken = await pool.query(
        "SELECT id FROM users WHERE LOWER(email)=LOWER($1)",
        [email]
      );
      if (emailTaken.rowCount)
        return res.status(400).json({ error: "email already in use" });

      const hashed = await bcrypt.hash(password, 10);
      const ins = await pool.query(
        `INSERT INTO users(username,email,password,tos_version,tos_accepted_at,privacy_version,privacy_accepted_at)
         VALUES($1,$2,$3,$4,now(),$5,now())
         RETURNING id,username,email,token_version`,
        [username, email, hashed, TOS_VERSION, PRIV_VERSION]
      );

      // primeira aba padrão
      await pool.query(
        "INSERT INTO tabs(name,user_id,position) VALUES($1,$2,1)",
        ["Tasks", ins.rows[0].id]
      );

      await logAccess(ins.rows[0].id, "register", req);
      return res.json({ token: generateToken(ins.rows[0]) });
    } catch (err) {
      // 23505 = unique_violation: username OU email já em uso (cobre a race
      // entre o pré-check acima e o INSERT).
      if (err.code === "23505")
        return res.status(400).json({ error: "username or email already in use" });
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
    // Always run exactly one bcrypt compare — against the user's hash, or a decoy when the
    // user is missing / is a Google-only account (password NULL) — so every branch costs the
    // same. Never let `||` short-circuit the KDF (that was the ~25× timing oracle).
    const hash = user && user.password ? user.password : DECOY_HASH;
    const ok = await bcrypt.compare(password || "", hash);
    if (!user || !user.password || !ok) {
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

      // Only trust a Google-verified email, and match STRICTLY by the stable subject
      // (google_id) — never auto-link by email, which would let a Google account log
      // into a same-email local account (account takeover). New google_id => new account.
      if (!payload.email_verified) {
        return res.status(400).json({ error: "google email not verified" });
      }

      const r = await pool.query("SELECT * FROM users WHERE google_id=$1", [
        googleId,
      ]);
      let user = r.rows[0];
      if (!user) {
        const result = await pool.query(
          `INSERT INTO users(email,google_id,tos_version,tos_accepted_at,privacy_version,privacy_accepted_at)
           VALUES($1,$2,$3,now(),$4,now()) RETURNING id,email,token_version`,
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
    } catch (err) {
      // Não vaza detalhe pro cliente, mas não engole em silêncio (higiene de auth).
      console.error("google-login failed:", err && err.message);
      res.status(400).json({ error: "invalid google token" });
    }
  });

  // "Esqueci a senha" — SEMPRE responde 200 (nunca revela se o e-mail existe: anti-enumeração).
  // Só envia link se a conta existe E tem senha (uma conta Google-only não tem o que resetar; ficar
  // em silêncio evita vazar o método de login). Token aleatório; guarda só o hash; invalida os
  // anteriores. Padrão do Porkfolio (RequestPasswordReset).
  router.post("/forgot-password", async (req, res) => {
    const email = typeof req.body?.email === "string" ? req.body.email.trim() : "";
    const locale = RESET_LOCALES.has(req.body?.locale) ? req.body.locale : "en";
    const base = APP_BASE_URL || `${req.protocol}://${req.get("host")}`;
    // Responde 200 ANTES de qualquer trabalho: o tempo de resposta NÃO pode depender de o e-mail
    // existir ou não (senão a diferença de timing vira um oráculo de enumeração — a sweep pegou 6×).
    res.json({ ok: true });
    // Trabalho best-effort, fora do caminho da resposta.
    (async () => {
      try {
        if (!isValidEmail(email)) return;
        const r = await pool.query(
          "SELECT id, email, password FROM users WHERE LOWER(email)=LOWER($1)",
          [email]
        );
        const user = r.rows[0];
        // Só emite link se a conta existe E tem senha (Google-only não tem o que resetar — o
        // silêncio evita vazar o método de login).
        if (!user || !user.password) return;
        await pool.query(
          "UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND purpose='password_reset' AND used_at IS NULL",
          [user.id]
        );
        const raw = crypto.randomBytes(32).toString("hex");
        await pool.query(
          `INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at)
           VALUES($1,'password_reset',$2,now()+ $3::interval)`,
          [user.id, sha256(raw), `${RESET_TTL_MS} milliseconds`]
        );
        const link = `${base}/?reset=${raw}`;
        const msg = passwordResetEmail(locale, link);
        await mailer.send({ to: user.email, subject: msg.subject, text: msg.text, html: msg.html });
      } catch (err) {
        console.error("forgot-password failed:", err && err.message);
      }
    })();
  });

  // Reset com o token do e-mail: token uso-único + não expirado + senha forte. Ao trocar, BUMPA
  // users.token_version → todos os JWTs antigos morrem (expulsa um atacante que já estava dentro).
  router.post("/reset-password", async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    const password = req.body?.password;
    if (!token) return res.status(400).json({ error: "token required" });
    if (!isStrongPassword(password))
      return res.status(400).json({
        error: "password must be 8–72 chars, with upper, lower, digit and special",
      });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const r = await client.query(
        `SELECT id, user_id FROM auth_tokens
          WHERE token_hash=$1 AND purpose='password_reset' AND used_at IS NULL AND expires_at > now()
          FOR UPDATE`,
        [sha256(token)]
      );
      const row = r.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return res.status(400).json({ error: "invalid or expired token" });
      }
      const hashed = await bcrypt.hash(password, 10);
      await client.query(
        "UPDATE users SET password=$1, token_version=token_version+1 WHERE id=$2",
        [hashed, row.user_id]
      );
      await client.query("UPDATE auth_tokens SET used_at=now() WHERE id=$1", [row.id]);
      await client.query("COMMIT");
      await logAccess(row.user_id, "password_reset", req);
      return res.json({ ok: true });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("reset-password failed:", err && err.message);
      return res.status(500).json({ error: "could not reset password" });
    } finally {
      client.release();
    }
  });

  return router;
}

module.exports = { createAuthRoutes };
