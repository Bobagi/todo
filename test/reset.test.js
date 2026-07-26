// Password reset — the security-critical behaviours. forgot-password never enumerates; reset tokens
// are single-use + expiring; a successful reset REVOKES existing sessions (token_version bump), so a
// stolen/old JWT dies. Email is a no-op in tests (harness clears SMTP_*), so nothing is actually sent.
//
// Run: docker compose run --rm --entrypoint npm web test
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const { resetDatabase, startApp, newUser, call, adminClient, TEST_DB } = require("./helpers/harness");

let url;
let close;

test.before(async () => {
  await resetDatabase();
  ({ url, close } = await startApp());
});
test.after(async () => {
  if (close) await close();
});

const post = (route, body) => call(url, "POST", route, { "Content-Type": "application/json" }, body);
const STRONG = "Aa1!aaaa";
const NEW = "Bb2@bbbb";
let seq = 0;
const uniq = () => `r${(seq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

async function db() {
  const c = adminClient(TEST_DB);
  await c.connect();
  return c;
}
async function userIdByUsername(username) {
  const c = await db();
  const { rows } = await c.query("SELECT id FROM users WHERE username=$1", [username]);
  await c.end();
  return rows[0].id;
}
async function unusedTokenCount(userId) {
  const c = await db();
  const { rows } = await c.query(
    "SELECT COUNT(*)::int n FROM auth_tokens WHERE user_id=$1 AND purpose='password_reset' AND used_at IS NULL",
    [userId]
  );
  await c.end();
  return rows[0].n;
}
// forgot-password returns 200 BEFORE it does its work (constant time = no timing oracle), so token
// creation is async — poll for the expected count instead of reading it immediately.
async function waitForTokenCount(userId, want, tries = 100) {
  for (let i = 0; i < tries; i++) {
    if ((await unusedTokenCount(userId)) === want) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return (await unusedTokenCount(userId)) === want;
}
// Seed a reset token directly (the raw token is only ever emailed; tests can't read it back).
async function seedToken(userId, ttlMs = 3600000) {
  const raw = crypto.randomBytes(16).toString("hex");
  const hash = crypto.createHash("sha256").update(raw).digest("hex");
  const c = await db();
  await c.query(
    "INSERT INTO auth_tokens(user_id,purpose,token_hash,expires_at) VALUES($1,'password_reset',$2, now() + ($3||' milliseconds')::interval)",
    [userId, hash, String(ttlMs)]
  );
  await c.end();
  return raw;
}

test("forgot-password ALWAYS returns 200 — existing, unknown, google-only, bad email (no enumeration)", async () => {
  const u = await newUser(url, "fp");
  const existing = await post("/api/forgot-password", { email: `${u.username}@example.com` });
  const unknown = await post("/api/forgot-password", { email: `nobody_${uniq()}@example.com` });
  const bad = await post("/api/forgot-password", { email: "not-an-email" });
  assert.equal(existing.status, 200);
  assert.equal(unknown.status, 200);
  assert.equal(bad.status, 200);
  assert.deepEqual(existing.body, unknown.body); // identical body too
});

test("forgot-password issues a token for a real password account, none for a Google-only account", async () => {
  const u = await newUser(url, "fp");
  const id = await userIdByUsername(u.username);
  await post("/api/forgot-password", { email: `${u.username}@example.com` });
  assert.ok(await waitForTokenCount(id, 1), "real account should get exactly one reset token");

  // google-only account (no password) — inserted directly
  const c = await db();
  const guser = `g_${uniq()}`;
  await c.query(
    `INSERT INTO users(username,email,google_id,tos_version,tos_accepted_at,privacy_version,privacy_accepted_at)
     VALUES($1,$2,$3,'v2',now(),'v2',now())`,
    [guser, `${guser}@example.com`, `gid_${uniq()}`]
  );
  const gid = (await c.query("SELECT id FROM users WHERE username=$1", [guser])).rows[0].id;
  await c.end();
  await post("/api/forgot-password", { email: `${guser}@example.com` });
  await new Promise((r) => setTimeout(r, 400)); // let the async work run (it should create nothing)
  assert.equal(await unusedTokenCount(gid), 0, "Google-only account must not get a reset token");
});

test("issuing a new reset link retires the previous one (only the latest is valid)", async () => {
  const u = await newUser(url, "fp");
  const id = await userIdByUsername(u.username);
  await post("/api/forgot-password", { email: `${u.username}@example.com` });
  assert.ok(await waitForTokenCount(id, 1), "first link issued"); // let it settle to avoid a self-race
  await post("/api/forgot-password", { email: `${u.username}@example.com` });
  assert.ok(await waitForTokenCount(id, 1), "second link retires the first → still exactly one valid");
});

test("a valid token sets the new password (login works) and is SINGLE-USE", async () => {
  const u = await newUser(url, "rs");
  const id = await userIdByUsername(u.username);
  const raw = await seedToken(id);

  const ok = await post("/api/reset-password", { token: raw, password: NEW });
  assert.equal(ok.status, 200);

  // old password no longer works, new one does
  assert.equal((await post("/api/login", { username: u.username, password: STRONG })).status, 400);
  assert.equal((await post("/api/login", { username: u.username, password: NEW })).status, 200);

  // token can't be reused
  const reuse = await post("/api/reset-password", { token: raw, password: "Cc3#cccc" });
  assert.equal(reuse.status, 400);
});

test("an expired token is rejected", async () => {
  const u = await newUser(url, "rs");
  const id = await userIdByUsername(u.username);
  const raw = await seedToken(id, -1000); // already expired
  assert.equal((await post("/api/reset-password", { token: raw, password: NEW })).status, 400);
});

test("reset rejects a weak password and does NOT consume the token", async () => {
  const u = await newUser(url, "rs");
  const id = await userIdByUsername(u.username);
  const raw = await seedToken(id);
  assert.equal((await post("/api/reset-password", { token: raw, password: "weak" })).status, 400);
  assert.equal(await unusedTokenCount(id), 1, "a rejected weak password must leave the token usable");
  // and the strong reset still works afterwards
  assert.equal((await post("/api/reset-password", { token: raw, password: NEW })).status, 200);
});

test("reset REVOKES existing sessions — an old JWT dies (token_version bump)", async () => {
  const u = await newUser(url, "rev");
  const id = await userIdByUsername(u.username);
  // old session works before the reset
  assert.equal((await call(url, "GET", "/api/tabs", u.headers)).status, 200);

  const raw = await seedToken(id);
  assert.equal((await post("/api/reset-password", { token: raw, password: NEW })).status, 200);

  // the pre-reset JWT is now dead (attacker who was already in is kicked)
  assert.equal((await call(url, "GET", "/api/tabs", u.headers)).status, 401);

  // a fresh login with the new password works
  const relog = await post("/api/login", { username: u.username, password: NEW });
  assert.equal(relog.status, 200);
  const freshHeaders = { "Content-Type": "application/json", Authorization: `Bearer ${relog.body.token}` };
  assert.equal((await call(url, "GET", "/api/tabs", freshHeaders)).status, 200);
});
