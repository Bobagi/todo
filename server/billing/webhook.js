const { pool } = require("../pool");
const { readBillingConfigOrDefaults } = require("./config");

function stripeWebhookRouter(stripe) {
  return async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch {
      return res.status(400).send("invalid signature");
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const metadata = session.metadata || {};
        const userId = parseInt(metadata.userId || "0", 10);
        const actionType = metadata.actionType || "";
        const tabId = metadata.tabId ? parseInt(metadata.tabId, 10) : null;
        const paymentIntentId = session.payment_intent;
        const amountCents = session.amount_total || 0;
        const currency = session.currency || "brl";

        const exists = await pool.query(
          "SELECT 1 FROM payments WHERE stripe_payment_intent_id=$1",
          [paymentIntentId]
        );
        if (!exists.rowCount && userId) {
          await pool.query(
            "INSERT INTO payments(user_id,stripe_payment_intent_id,amount_cents,currency,action_type,tab_id,quantity) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              userId,
              paymentIntentId,
              amountCents,
              currency,
              actionType,
              tabId,
              null,
            ]
          );

          const cfg = await readBillingConfigOrDefaults();
          const expiresSql = `now() + interval '${cfg.entitlement_days} days'`;

          if (actionType === "TAB_SLOT") {
            await pool.query(
              `INSERT INTO entitlements(user_id,type,tab_id,amount,expires_at) VALUES($1,'TAB_SLOT',NULL,1,${expiresSql})`,
              [userId]
            );
          }
          if (actionType === "TASK_PACK" && tabId) {
            await pool.query(
              `INSERT INTO entitlements(user_id,type,tab_id,amount,expires_at) VALUES($1,'TASK_PACK',$2,$3,${expiresSql})`,
              [userId, tabId, cfg.task_pack_size || 6]
            );
          }
        }
      }
    } catch (err) {
      console.error("webhook error:", err);
      return res.status(500).end();
    }
    res.json({ received: true });
  };
}

module.exports = { stripeWebhookRouter };
