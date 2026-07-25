// Inventory — the behaviours that must never silently break.
//
// Priority order (critical path first): cross-account authorisation, the
// atomicity of the per-user caps, input clamping matched to the column widths,
// and the move/history invariant.
//
// Run: docker compose run --rm --entrypoint npm web test
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resetDatabase,
  startApp,
  newUser,
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

const post = (h, route, body) => call(url, "POST", route, h, body);
const put = (h, route, body) => call(url, "PUT", route, h, body);
const del = (h, route) => call(url, "DELETE", route, h);
const get = (h, route) => call(url, "GET", route, h);

async function seedAccount(prefix) {
  const { headers } = await newUser(url, prefix);
  const home = (await post(headers, "/api/inventory/locations", { name: "Home" }))
    .body;
  const away = (await post(headers, "/api/inventory/locations", { name: "Away" }))
    .body;
  return { headers, home, away };
}

/* ------------------------------------------------------------------ authz */

test("every inventory route rejects an unauthenticated caller", async () => {
  const anon = { "Content-Type": "application/json" };
  const routes = [
    ["GET", "/api/inventory"],
    ["GET", "/api/inventory/moves"],
    ["POST", "/api/inventory/move"],
    ["POST", "/api/inventory/items"],
    ["POST", "/api/inventory/locations"],
  ];
  for (const [method, route] of routes) {
    const r = await call(url, method, route, anon, method === "GET" ? undefined : {});
    assert.equal(r.status, 401, `${method} ${route} should be 401`);
  }
});

test("account B cannot read, move, edit or delete anything owned by A", async () => {
  const a = await seedAccount("idor_a");
  const b = await seedAccount("idor_b");
  const item = (
    await post(a.headers, "/api/inventory/items", {
      name: "A's passport",
      locationId: a.home.id,
    })
  ).body;

  // B must not be able to touch A's item or A's places...
  assert.equal(
    (await post(b.headers, "/api/inventory/move", {
      itemIds: [item.id],
      toLocationId: b.home.id,
    })).status,
    400,
    "B moved A's item"
  );
  // B moving its OWN item into A's place must fail on the destination check.
  // (Sending an empty itemIds would 400 on the "itemIds required" guard first
  // and prove nothing about ownership of the destination.)
  const bItem = (
    await post(b.headers, "/api/inventory/items", {
      name: "B's socks",
      locationId: b.home.id,
    })
  ).body;
  assert.equal(
    (await post(b.headers, "/api/inventory/move", {
      itemIds: [bItem.id],
      toLocationId: a.home.id,
    })).status,
    400,
    "B filed its own item into A's place"
  );
  const bAfter = (await get(b.headers, "/api/inventory")).body;
  assert.equal(
    bAfter.items.find((i) => i.id === bItem.id).location_id,
    b.home.id,
    "B's item must not end up pointing at another account's place"
  );
  assert.equal(
    (await put(b.headers, `/api/inventory/items/${item.id}`, { name: "stolen" })).status,
    404
  );
  assert.equal((await del(b.headers, `/api/inventory/items/${item.id}`)).status, 404);
  assert.equal(
    (await put(b.headers, `/api/inventory/locations/${a.home.id}`, { name: "stolen" }))
      .status,
    404
  );
  assert.equal(
    (await del(b.headers, `/api/inventory/locations/${a.home.id}`)).status,
    404
  );
  assert.equal(
    (await post(b.headers, "/api/inventory/items", {
      name: "trojan",
      locationId: a.home.id,
    })).status,
    400,
    "B filed an item into A's place"
  );

  // ...and B's inventory must not have gained any of it.
  const bInv = (await get(b.headers, "/api/inventory")).body;
  assert.deepEqual(
    bInv.items.map((i) => i.name),
    ["B's socks"],
    "B's inventory gained something from A"
  );

  // A's item is untouched, still named and placed as A left it.
  const aInv = (await get(a.headers, "/api/inventory")).body;
  assert.equal(aInv.items.length, 1);
  assert.equal(aInv.items[0].name, "A's passport");
  assert.equal(aInv.items[0].location_id, a.home.id);
  assert.equal(aInv.locations.find((l) => l.id === a.home.id).name, "Home");
});

test("an owner id in the payload is ignored — the session decides", async () => {
  const a = await seedAccount("spoof_a");
  const b = await seedAccount("spoof_b");
  const created = await post(b.headers, "/api/inventory/items", {
    name: "spoofed",
    user_id: 1,
    userId: 1,
  });
  assert.equal(created.status, 201);

  const aInv = (await get(a.headers, "/api/inventory")).body;
  assert.equal(
    aInv.items.find((i) => i.name === "spoofed"),
    undefined,
    "payload user_id leaked the item into another account"
  );
  const bInv = (await get(b.headers, "/api/inventory")).body;
  assert.ok(bInv.items.find((i) => i.name === "spoofed"));
});

/* ------------------------------------------------- atomicity of the caps */

test("the 12-place cap holds under 40 concurrent creates", async () => {
  const { headers } = await newUser(url, "race_loc");

  // Real concurrency: one process, all requests in flight together. A shell
  // loop of backgrounded curls does NOT overlap enough and would pass even
  // against the racy check-then-act this test exists to catch.
  const statuses = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      post(headers, "/api/inventory/locations", { name: `L${i}` }).then((r) => r.status)
    )
  );

  const inv = (await get(headers, "/api/inventory")).body;
  assert.equal(inv.locations.length, 12, "concurrent creates burst through the cap");
  assert.equal(statuses.filter((s) => s === 201).length, 12);
  assert.equal(statuses.filter((s) => s === 400).length, 28);
});

test("the 500-item cap holds under a concurrent burst", async () => {
  const { headers } = await newUser(url, "race_item");
  const home = (await post(headers, "/api/inventory/locations", { name: "Home" })).body;
  const me = (await get(headers, "/api/me")).body;

  // Seed to 480 — deliberately BELOW the cap. Seeding to exactly 500 makes the
  // burst return 400s for being full, which masks whether the cap is atomic.
  const db = adminClient(TEST_DB);
  await db.connect();
  await db.query(
    `INSERT INTO inv_items(user_id, name, category, location_id)
     SELECT $1, 'seed' || g, 'other', $2 FROM generate_series(1, 480) g`,
    [me.id, home.id]
  );
  await db.end();

  const before = (await get(headers, "/api/inventory")).body.items.length;
  assert.equal(before, 480);

  const statuses = await Promise.all(
    Array.from({ length: 40 }, (_, i) =>
      post(headers, "/api/inventory/items", {
        name: `burst${i}`,
        locationId: home.id,
      }).then((r) => r.status)
    )
  );

  const after = (await get(headers, "/api/inventory")).body.items.length;
  assert.equal(after, 500, "concurrent creates burst through the item cap");
  assert.equal(statuses.filter((s) => s === 201).length, 20);
});

/* ------------------------------------------------------ input validation */

test("oversized text is clamped to the column width instead of erroring", async () => {
  const { headers } = await newUser(url, "clamp");
  const huge = "A".repeat(5000);

  const place = await post(headers, "/api/inventory/locations", { name: huge });
  assert.equal(place.status, 201);
  assert.equal(place.body.name.length, 40, "place name must match varchar(40)");

  const item = await post(headers, "/api/inventory/items", {
    name: huge,
    notes: huge,
  });
  assert.equal(item.status, 201);
  assert.equal(item.body.name.length, 80, "item name must match varchar(80)");
  assert.equal(item.body.notes.length, 200, "notes must match varchar(200)");
});

test("quantity and category are bounded to safe values", async () => {
  const { headers } = await newUser(url, "bounds");
  await post(headers, "/api/inventory/locations", { name: "Home" });

  const cases = [
    [{ name: "a", qty: 3 }, 3],
    [{ name: "b", qty: 1000 }, 999], // clamped to the cap, not reset
    [{ name: "c", qty: -5 }, 1],
    [{ name: "d", qty: 0 }, 1],
    [{ name: "e", qty: 1.5 }, 1],
    [{ name: "f", qty: "12" }, 12],
  ];
  for (const [payload, expected] of cases) {
    const r = await post(headers, "/api/inventory/items", payload);
    assert.equal(r.body.qty, expected, `qty ${payload.qty} => ${expected}`);
  }

  const bogus = await post(headers, "/api/inventory/items", {
    name: "g",
    category: "../../etc/passwd",
  });
  assert.equal(bogus.body.category, "other", "category must come from the allowlist");
});

test("malformed input is a 400, never a 500", async () => {
  const { headers } = await newUser(url, "bad");
  const bad = [
    ["/api/inventory/items", { name: "" }],
    ["/api/inventory/items", { name: { a: 1 } }],
    ["/api/inventory/locations", { name: "   " }],
    ["/api/inventory/move", { itemIds: "1" }],
    ["/api/inventory/move", { itemIds: [] }],
    ["/api/inventory/move", { itemIds: ["1' OR 1=1--"] }],
    ["/api/inventory/move", { itemIds: [[1, 2]] }],
    ["/api/inventory/move", { itemIds: [1], toLocationId: "1 OR 1=1" }],
    ["/api/inventory/move", { itemIds: Array(5000).fill(1) }],
  ];
  for (const [route, payload] of bad) {
    const r = await post(headers, route, payload);
    assert.equal(r.status, 400, `${route} ${JSON.stringify(payload)} => ${r.status}`);
  }

  // A body that isn't JSON at all is the caller's error too.
  const res = await fetch(`${url}/api/inventory/items`, {
    method: "POST",
    headers,
    body: "not json",
  });
  assert.equal(res.status, 400);
});

test("a hostile string is stored as literal text, not executed as SQL", async () => {
  const { headers } = await newUser(url, "sqli");
  await post(headers, "/api/inventory/locations", { name: "Home" });
  const evil = "x' OR 1=1 --; DROP TABLE inv_items;";
  const created = await post(headers, "/api/inventory/items", { name: evil });
  assert.equal(created.status, 201);
  assert.equal(created.body.name, evil);

  // The table still exists and still answers.
  const inv = await get(headers, "/api/inventory");
  assert.equal(inv.status, 200);
  assert.equal(inv.body.items.length, 1);
});

/* ------------------------------------------------------ move and history */

test("moving records history and moving again is a no-op", async () => {
  const { headers, home, away } = await seedAccount("move");
  const shirt = (
    await post(headers, "/api/inventory/items", { name: "Shirt", locationId: home.id })
  ).body;
  const socks = (
    await post(headers, "/api/inventory/items", { name: "Socks", locationId: home.id })
  ).body;

  const first = await post(headers, "/api/inventory/move", {
    itemIds: [shirt.id, socks.id],
    toLocationId: away.id,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.moved, 2);

  const inv = (await get(headers, "/api/inventory")).body;
  assert.ok(inv.items.every((i) => i.location_id === away.id));

  // Same destination again: nothing moves and no phantom history is written.
  const again = await post(headers, "/api/inventory/move", {
    itemIds: [shirt.id, socks.id],
    toLocationId: away.id,
  });
  assert.equal(again.body.moved, 0);

  const history = (await get(headers, "/api/inventory/moves")).body;
  assert.equal(history.length, 2, "a no-op move must not add history rows");
  assert.equal(history[0].from_name, "Home");
  assert.equal(history[0].to_name, "Away");
});

test("history survives deleting the item it refers to", async () => {
  const { headers, home, away } = await seedAccount("hist");
  const item = (
    await post(headers, "/api/inventory/items", { name: "Towel", locationId: home.id })
  ).body;
  await post(headers, "/api/inventory/move", {
    itemIds: [item.id],
    toLocationId: away.id,
  });
  assert.equal((await del(headers, `/api/inventory/items/${item.id}`)).status, 204);

  const history = (await get(headers, "/api/inventory/moves")).body;
  assert.equal(history.length, 1);
  assert.equal(history[0].item_name, "Towel", "the name must be denormalised");
});

test("deleting a place keeps its items, marked as unknown", async () => {
  const { headers, home } = await seedAccount("delloc");
  await post(headers, "/api/inventory/items", { name: "Cap", locationId: home.id });

  const removed = await del(headers, `/api/inventory/locations/${home.id}`);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.orphaned, 1);

  const inv = (await get(headers, "/api/inventory")).body;
  assert.equal(inv.items.length, 1, "items must survive their place being deleted");
  assert.equal(inv.items[0].location_id, null);
});

test("place names are unique per account but not across accounts", async () => {
  const a = await seedAccount("uniq_a");
  const b = await seedAccount("uniq_b");
  // Same account, same name in a different case => rejected.
  assert.equal(
    (await post(a.headers, "/api/inventory/locations", { name: "hOmE" })).status,
    409
  );
  // Another account may of course also have a "Home".
  assert.equal(
    (await post(b.headers, "/api/inventory/locations", { name: "Home 2" })).status,
    201
  );
});

test("the item location can only be changed through /move, so history can't be bypassed", async () => {
  const { headers, home, away } = await seedAccount("nobypass");
  const item = (
    await post(headers, "/api/inventory/items", { name: "Jacket", locationId: home.id })
  ).body;

  await put(headers, `/api/inventory/items/${item.id}`, {
    name: "Jacket",
    location_id: away.id,
    locationId: away.id,
  });

  const inv = (await get(headers, "/api/inventory")).body;
  assert.equal(inv.items[0].location_id, home.id, "PUT must not relocate an item");
  assert.equal((await get(headers, "/api/inventory/moves")).body.length, 0);
});
