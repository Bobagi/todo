const { Pool } = require("pg");

const pool = new Pool({
  user: process.env.POSTGRES_USER || "todo",
  host: process.env.POSTGRES_HOST || "db",
  database: process.env.POSTGRES_DB || "todo",
  password: process.env.POSTGRES_PASSWORD || "todo",
});

module.exports = { pool };
