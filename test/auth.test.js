// Registration now REQUIRES an email (Google login stays email-driven; the
// password signup used to leave email NULL). These lock the new contract:
// email is mandatory + validated + unique, stored on the row, and login is
// still by username (email is not a login identifier).
//
// Run: docker compose run --rm --entrypoint npm web test
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resetDatabase,
  startApp,
  call,
  adminClient,
  TEST_DB,
} = require("./helpers/harness");

let url;
let close;

test.before(async () => {
  await resetDatabase();
  ({ url, close } = await startApp());
});

test.after(async () => {
  if (close) await close();
});

const register = (body) => call(url, "POST", "/api/register", { "Content-Type": "application/json" }, body);
const login = (body) => call(url, "POST", "/api/login", { "Content-Type": "application/json" }, body);

const GOOD_PW = "Aa1!aaaa";
let seq = 0;
const uniq = () => `e${(seq++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;

test("register WITHOUT email is rejected (400)", async () => {
  const u = uniq();
  const r = await register({ username: u, password: GOOD_PW, acceptLegal: true });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /email/i);
});

test("register with a MALFORMED email is rejected (400)", async () => {
  for (const bad of ["nope", "a@b", "a@b.", "@x.com", "x@ .com", "  "]) {
    const r = await register({
      username: uniq(),
      email: bad,
      password: GOOD_PW,
      acceptLegal: true,
    });
    assert.equal(r.status, 400, `expected 400 for email="${bad}"`);
  }
});

test("register with a VALID email succeeds, stores it, and login by username works", async () => {
  const u = uniq();
  const email = `${u}@example.com`;
  const r = await register({ username: u, email, password: GOOD_PW, acceptLegal: true });
  assert.equal(r.status, 200);
  assert.ok(r.body.token, "expected a token");

  // the email is actually persisted on the row
  const db = adminClient(TEST_DB);
  await db.connect();
  const { rows } = await db.query(
    "SELECT email FROM users WHERE LOWER(username)=LOWER($1)",
    [u]
  );
  await db.end();
  assert.equal(rows[0].email, email);

  // login is still by username + password (email is NOT a login identifier)
  const ok = await login({ username: u, password: GOOD_PW });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.token);

  const byEmail = await login({ username: email, password: GOOD_PW });
  assert.equal(byEmail.status, 400, "email must not authenticate as a username");
});

test("email must be UNIQUE across accounts (400 on reuse)", async () => {
  const email = `${uniq()}@example.com`;
  const first = await register({ username: uniq(), email, password: GOOD_PW, acceptLegal: true });
  assert.equal(first.status, 200);

  const dup = await register({
    username: uniq(),
    email: email.toUpperCase(), // case-insensitive collision
    password: GOOD_PW,
    acceptLegal: true,
  });
  assert.equal(dup.status, 400);
  assert.match(dup.body.error, /email|use/i);
});

test("login: nonexistent user and wrong password return the SAME 400 body (no enumeration)", async () => {
  const u = uniq();
  await register({ username: u, email: `${u}@example.com`, password: GOOD_PW, acceptLegal: true });

  const wrongPw = await login({ username: u, password: "Wrongxx9!" });
  const ghost = await login({ username: `nope_${uniq()}`, password: "Wrongxx9!" });

  assert.equal(wrongPw.status, 400);
  assert.equal(ghost.status, 400);
  // identical body — the branch difference must not surface to the client
  assert.deepEqual(wrongPw.body, ghost.body);
  // (constant-TIME is proven by the live security-sweep; unit timing asserts are flaky)
});

test("a Google-only account (no password) cannot be logged into by password", async () => {
  const db = adminClient(TEST_DB);
  await db.connect();
  const uname = `g_${uniq()}`;
  await db.query(
    `INSERT INTO users(username,email,google_id,tos_version,tos_accepted_at,privacy_version,privacy_accepted_at)
     VALUES($1,$2,$3,'v1',now(),'v1',now())`,
    [uname, `${uname}@example.com`, `gid_${uniq()}`]
  );
  await db.end();
  // empty/any password must not authenticate a password-less account
  assert.equal((await login({ username: uname, password: "" })).status, 400);
  assert.equal((await login({ username: uname, password: "anything9!" })).status, 400);
});

test("the other signup gates still hold (username, password, terms)", async () => {
  const email = () => `${uniq()}@example.com`;
  // bad username
  assert.equal(
    (await register({ username: "ab", email: email(), password: GOOD_PW, acceptLegal: true })).status,
    400
  );
  // weak password
  assert.equal(
    (await register({ username: uniq(), email: email(), password: "weak", acceptLegal: true })).status,
    400
  );
  // terms not accepted
  assert.equal(
    (await register({ username: uniq(), email: email(), password: GOOD_PW, acceptLegal: false })).status,
    400
  );
});
