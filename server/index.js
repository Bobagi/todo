const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

const pool = new Pool({
  user: process.env.POSTGRES_USER || 'todo',
  host: process.env.POSTGRES_HOST || 'db',
  database: process.env.POSTGRES_DB || 'todo',
  password: process.env.POSTGRES_PASSWORD || 'todo',
});

async function init(retries = 5) {
  for (let i = 0; i < retries; i++) {
    try {
  await pool.query(`CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        done BOOLEAN DEFAULT FALSE
      )`);
      return;
    } catch (err) {
      console.error('Database not ready, retrying...', err.message);
      await new Promise(res => setTimeout(res, 3000));
    }
  }
  throw new Error('Could not connect to database');
}

init().catch(err => {
  console.error(err);
  process.exit(1);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/tasks', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM tasks ORDER BY id DESC');
  res.json(rows);
});

app.post('/api/tasks', async (req, res) => {
  const { title } = req.body;
  if (!title) return res.status(400).json({ error: 'title required' });
  const { rows } = await pool.query('INSERT INTO tasks(title) VALUES($1) RETURNING *', [title]);
  res.status(201).json(rows[0]);
});

app.put('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  const { title, done } = req.body;
  const { rows } = await pool.query(
    'UPDATE tasks SET title=COALESCE($1,title), done=COALESCE($2,done) WHERE id=$3 RETURNING *',
    [title, done, id]
  );
  res.json(rows[0]);
});

app.delete('/api/tasks/:id', async (req, res) => {
  const { id } = req.params;
  await pool.query('DELETE FROM tasks WHERE id=$1', [id]);
  res.status(204).end();
});

// Serve index.html for any other GET request so the PWA works with client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(port, () => {
  let url = `http://localhost:${port}`;
  if (process.env.CODESPACE_NAME && process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN) {
    url = `https://${port}-${process.env.CODESPACE_NAME}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}`;
  } else if (process.env.GITPOD_WORKSPACE_URL) {
    const host = process.env.GITPOD_WORKSPACE_URL.replace(/^https?:\/\//, '');
    url = `https://${port}-${host}`;
  }
  console.log(`Server running at ${url}`);
  console.log(`Open ${url} in your browser.`);
});
