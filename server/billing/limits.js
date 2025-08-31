const { pool } = require("../pool");
const { readBillingConfigOrDefaults } = require("./config");

async function getActiveSum(userId, type, tabId) {
  if (tabId) {
    const r = await pool.query(
      "SELECT COALESCE(SUM(amount),0) s FROM entitlements WHERE user_id=$1 AND type=$2 AND tab_id=$3 AND expires_at>now()",
      [userId, type, tabId]
    );
    return parseInt(r.rows[0].s || 0, 10);
  } else {
    const r = await pool.query(
      "SELECT COALESCE(SUM(amount),0) s FROM entitlements WHERE user_id=$1 AND type=$2 AND tab_id IS NULL AND expires_at>now()",
      [userId, type]
    );
    return parseInt(r.rows[0].s || 0, 10);
  }
}

async function getAllowedTabSlots(userId) {
  const cfg = await readBillingConfigOrDefaults();
  const extra = await getActiveSum(userId, "TAB_SLOT", null);
  return (cfg.base_tabs || 1) + extra;
}
async function getAllowedTasksForTab(userId, tabId) {
  const cfg = await readBillingConfigOrDefaults();
  const extra = await getActiveSum(userId, "TASK_PACK", tabId);
  return (cfg.base_tasks_per_tab || 6) + extra;
}

module.exports = { getAllowedTabSlots, getAllowedTasksForTab, getActiveSum };
