// Transactional email — config-driven and NO-OP when SMTP is not configured, so the app boots and
// runs without email (password-reset just doesn't deliver). Mirrors the Porkfolio Sender pattern.
// Never log the token or the message body.
const nodemailer = require("nodemailer");

let transport = null;
let enabled = false;

const host = process.env.SMTP_HOST;
const user = process.env.SMTP_USERNAME;
const pass = process.env.SMTP_PASSWORD;

if (host && user && pass) {
  transport = nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT || 587) === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user, pass },
  });
  enabled = true;
  console.log(`Email enabled (SMTP ${host} as ${process.env.SMTP_FROM || user})`);
} else {
  console.log("Email disabled (SMTP_* not set) — transactional mail is a no-op");
}

const fromAddress = process.env.SMTP_FROM || user || "no-reply@localhost";
const fromName = process.env.SMTP_FROM_NAME || "To do";

function isEnabled() {
  return enabled;
}

/** Send a message. When SMTP is unset this logs (subject + recipient only) and resolves. */
async function send({ to, subject, text, html }) {
  if (!to) throw new Error("email recipient is empty");
  if (!enabled) {
    console.log(`email (not sent — SMTP off): to=${to} subject=${JSON.stringify(subject)}`);
    return;
  }
  await transport.sendMail({
    from: `"${fromName}" <${fromAddress}>`,
    to,
    subject,
    text,
    html,
    headers: { "Auto-Submitted": "auto-generated" },
  });
}

module.exports = { send, isEnabled };
