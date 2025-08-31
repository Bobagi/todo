const jwt = require("jsonwebtoken");
const jwtSecret = process.env.JWT_SECRET || "secret";

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

module.exports = { generateToken, auth };
