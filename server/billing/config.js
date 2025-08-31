const { pool } = require("../pool");

async function readBillingConfig() {
  const r = await pool.query("SELECT * FROM billing_config LIMIT 1");
  return r.rows[0];
}

async function readBillingConfigOrDefaults() {
  let cfg = await readBillingConfig();
  if (!cfg) {
    cfg = {
      currency: "brl",
      tab_price_cents: 200,
      task_pack_price_cents: 200,
      task_pack_size: 6,
      entitlement_days: 30,
      base_tabs: 1,
      base_tasks_per_tab: 6,
    };
  }
  return cfg;
}

async function ensureBillingConfigDefaults() {
  const r = await pool.query("SELECT COUNT(*)::int c FROM billing_config");
  if (!r.rows[0].c) {
    await pool.query(
      `INSERT INTO billing_config
         (currency, tab_price_cents, task_pack_price_cents, task_pack_size, entitlement_days, base_tabs, base_tasks_per_tab)
       VALUES ('brl', 200, 200, 6, 30, 1, 6)`
    );
  }
}

module.exports = {
  readBillingConfig,
  readBillingConfigOrDefaults,
  ensureBillingConfigDefaults,
};
