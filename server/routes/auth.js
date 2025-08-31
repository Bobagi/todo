const express = require("express");
const bcrypt = require("bcrypt");
const { OAuth2Client } = require("google-auth-library");

function createAuthRoutes({ pool, generateToken }) {
  const router = express.Router();
  const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

  router.post("/register", async (req, res) => {
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

  router.post("/login", async (req, res) => {
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

  router.post("/google-login", async (req, res) => {
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

  return router;
}

module.exports = { createAuthRoutes };
