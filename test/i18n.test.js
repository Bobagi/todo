// i18n — the failure mode is silent: a key added to one language and forgotten
// in the others just renders English (or the raw key) to that user. These tests
// make that a red build instead of a bug someone notices in production.
//
// Run: docker compose run --rm --entrypoint npm web test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SRC = path.join(__dirname, "..", "public", "js", "app", "i18n.js");

/**
 * i18n.js is a browser ES module. Rather than transpile it, strip the `export`
 * keywords and evaluate it with a minimal browser-ish sandbox, so the tests
 * assert against the REAL dictionaries the app ships — not a copy.
 */
function loadI18n({ languages, saved } = {}) {
  const code = fs.readFileSync(SRC, "utf8").replace(/^export /gm, "");
  const store = new Map(saved ? [["lang", saved]] : []);
  const sandbox = {
    navigator: { languages: languages || [], language: (languages || [])[0] || "" },
    localStorage: {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, v),
    },
    document: { documentElement: {} },
    location: { reload() {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(code + "\n;({ SUPPORTED, LANGS, t, lang, detectLang, _dicts });", sandbox);
  return vm.runInContext("({ SUPPORTED, LANGS, t, lang, detectLang, _dicts })", sandbox);
}

test("every language defines exactly the same keys", () => {
  const { SUPPORTED, _dicts } = loadI18n();
  const reference = Object.keys(_dicts.en).sort();
  for (const code of SUPPORTED) {
    const keys = Object.keys(_dicts[code]).sort();
    const missing = reference.filter((k) => !keys.includes(k));
    const extra = keys.filter((k) => !reference.includes(k));
    assert.deepEqual(missing, [], `${code} is missing keys`);
    assert.deepEqual(extra, [], `${code} has keys no other language has`);
  }
});

test("no translation is left empty or identical to its own key", () => {
  const { SUPPORTED, _dicts } = loadI18n();
  for (const code of SUPPORTED) {
    for (const [key, value] of Object.entries(_dicts[code])) {
      assert.equal(typeof value, "string", `${code}.${key} must be a string`);
      assert.ok(value.trim().length > 0, `${code}.${key} is empty`);
      assert.notEqual(value, key, `${code}.${key} is just the key`);
    }
  }
});

test("placeholders survive translation in every language", () => {
  const { SUPPORTED, _dicts } = loadI18n();
  const vars = (s) => (s.match(/\{[a-zA-Z]+\}/g) || []).sort();
  for (const [key, english] of Object.entries(_dicts.en)) {
    for (const code of SUPPORTED) {
      assert.deepEqual(
        vars(_dicts[code][key]),
        vars(english),
        `${code}.${key} does not carry the same {placeholders} as English`
      );
    }
  }
});

test("the language is detected from the browser, and an explicit choice wins", () => {
  const cases = [
    { languages: ["pt-BR", "en-US"], expect: "pt" },
    { languages: ["es-419", "en"], expect: "es" },
    { languages: ["en-GB"], expect: "en" },
    { languages: ["fr-CA"], expect: "fr" },
    { languages: ["de-AT"], expect: "de" },
    { languages: ["it-IT"], expect: "it" },
    // unsupported first, supported second — must not fall straight to default
    { languages: ["ru-RU", "es-ES"], expect: "es" },
    // nothing supported at all → English
    { languages: ["ru-RU", "ja-JP"], expect: "en" },
    { languages: [], expect: "en" },
    // a saved choice beats the browser
    { languages: ["pt-BR"], saved: "de", expect: "de" },
    // a saved junk value is ignored
    { languages: ["pt-BR"], saved: "xx", expect: "pt" },
  ];
  for (const c of cases) {
    const { detectLang } = loadI18n(c);
    assert.equal(
      detectLang(
        { languages: c.languages, language: c.languages[0] || "" },
        {
          getItem: () => c.saved || null,
          setItem() {},
        }
      ),
      c.expect,
      `languages=${JSON.stringify(c.languages)} saved=${c.saved}`
    );
  }
});

test("t() interpolates and falls back to English for a missing key", () => {
  const { t, _dicts } = loadI18n({ languages: ["pt-BR"] });
  assert.equal(t("inv.moved", { n: 3, place: "Casa da Ana" }), "3 itens → Casa da Ana");
  assert.equal(t("this.key.does.not.exist"), "this.key.does.not.exist");
  // sanity: the Portuguese dict really is in use
  assert.equal(t("app.tasks"), _dicts.pt["app.tasks"]);
});

test("every t() key used in the app exists in the dictionaries", () => {
  const { _dicts } = loadI18n();
  const appDir = path.join(__dirname, "..", "public", "js", "app");
  const used = new Set();
  for (const file of fs.readdirSync(appDir)) {
    if (!file.endsWith(".js") || file === "i18n.js") continue;
    const src = fs.readFileSync(path.join(appDir, file), "utf8");
    // only fully-literal calls: t("a.b") — a concatenated key like t("pw." + x)
    // is covered by the passwordStrength test below, which exercises it for real
    for (const m of src.matchAll(/\bt\(\s*"([^"]+)"\s*[,)]/g)) used.add(m[1]);
  }
  assert.ok(used.size > 50, `expected the app to use many keys, found ${used.size}`);
  const unknown = [...used].filter((k) => !(k in _dicts.en));
  assert.deepEqual(unknown, [], "the app calls t() with keys that do not exist");
});

test("every slug passwordStrength can emit has a dictionary key", () => {
  const { _dicts } = loadI18n();
  const utils = fs.readFileSync(
    path.join(__dirname, "..", "public", "js", "app", "utils.js"),
    "utf8"
  ).replace(/^export /gm, "");
  const sandbox = { React: {} };
  vm.createContext(sandbox);
  vm.runInContext(utils + "\n;({ passwordStrength });", sandbox);
  const { passwordStrength } = vm.runInContext("({ passwordStrength })", sandbox);

  // Samples chosen to make every reason and every label fire at least once.
  const samples = ["", "a", "abcdefgh", "Abcdefgh", "Abcdefg1", "Abcdefg1!", "AB1!aaaa"];
  const seen = new Set();
  for (const pw of samples) {
    const s = passwordStrength(pw);
    seen.add("pw." + s.label);
    for (const r of s.reasons) seen.add("pw." + r);
  }
  assert.ok(seen.size >= 8, `expected the samples to exercise every slug, got ${[...seen]}`);
  const unknown = [...seen].filter((k) => !(k in _dicts.en));
  assert.deepEqual(unknown, [], "passwordStrength emits slugs with no translation");
});

test("every category the API can send has a translated label", () => {
  const { SUPPORTED, _dicts } = loadI18n();
  // The server is the source of truth for which categories exist — read it, so
  // adding one there without translating it turns this red.
  const route = fs.readFileSync(
    path.join(__dirname, "..", "server", "routes", "inventory.js"),
    "utf8"
  );
  const keys = [...route.matchAll(/\{\s*key:\s*"([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(keys.length >= 10, `expected the category list, found ${keys.length}`);
  for (const code of SUPPORTED) {
    const missing = keys.filter((k) => !(`cat.${k}` in _dicts[code]));
    assert.deepEqual(missing, [], `${code} has no label for these categories`);
  }
});
