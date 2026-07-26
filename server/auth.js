const jwt = require("jsonwebtoken");
const { pool } = require("./pool");

// Fail-closed: never silently fall back to a guessable secret (that would make every JWT forgeable
// if the env failed to load). The prod .env has a strong 64-char secret; refuse to boot without one.
const jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 16 || jwtSecret === "secret") {
  throw new Error("JWT_SECRET is missing or too weak — refusing to start (tokens would be forgeable).");
}

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      email: user.email,
      // token_version pins the JWT to a revocable generation (see auth() below).
      tv: user.token_version ?? 0,
    },
    jwtSecret,
    { expiresIn: "7d" }
  );
}

// A stateless JWT can't be revoked by deleting a server-side session, so the token carries the
// token_version it was minted with and we re-check it against the DB on every authed request. A
// password reset bumps users.token_version, which instantly invalidates every older token (and a
// missing row = deleted user = 401). Cost: one indexed primary-key lookup per request.
async function auth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "no token" });
  const token = authHeader.split(" ")[1];
  let payload;
  try {
    payload = jwt.verify(token, jwtSecret);
  } catch {
    return res.status(401).json({ error: "invalid token" });
  }
  try {
    const r = await pool.query("SELECT token_version FROM users WHERE id=$1", [payload.id]);
    if (!r.rowCount || r.rows[0].token_version !== (payload.tv ?? 0)) {
      return res.status(401).json({ error: "invalid token" });
    }
  } catch {
    return res.status(500).json({ error: "auth check failed" });
  }
  req.user = payload;
  next();
}

module.exports = { generateToken, auth };
