const path = require("path");
const fs = require("fs").promises;
const { pool } = require("./pool");

async function runMigrations() {
  await pool.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations (id SERIAL PRIMARY KEY, name TEXT UNIQUE, applied_at TIMESTAMPTZ DEFAULT now())"
  );
  const dir = path.join(__dirname, "..", "migrations"); // opcional; pode nem existir
  try {
    await fs.mkdir(dir, { recursive: true });
  } catch {}
  const files = (await fs.readdir(dir))
    .filter((f) => f.endsWith(".sql"))
    .sort();
  for (const f of files) {
    const seen = await pool.query(
      "SELECT 1 FROM schema_migrations WHERE name=$1",
      [f]
    );
    if (seen.rowCount) continue;
    const sql = await fs.readFile(path.join(dir, f), "utf-8");
    await pool.query(sql);
    await pool.query("INSERT INTO schema_migrations(name) VALUES($1)", [f]);
  }
}

module.exports = { runMigrations };
