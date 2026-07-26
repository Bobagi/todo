// Server-side email copy for password reset. The app UI is i18n in 6 languages, but transactional
// email is kept to PT + EN (fallback EN) — the two primary audiences — to stay maintainable.
// The link is the only dynamic part and is inserted as an href/text (no user-controlled HTML).

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

const COPY = {
  pt: {
    subject: "Redefinir sua senha — To do",
    heading: "Redefinir senha",
    line1: "Recebemos um pedido para redefinir a senha da sua conta no To do.",
    button: "Redefinir senha",
    line2: "Se você não pediu isso, pode ignorar este e-mail — sua senha continua a mesma.",
    expiry: "Este link expira em 1 hora e só pode ser usado uma vez.",
    fallback: "Se o botão não funcionar, copie e cole este endereço no navegador:",
  },
  en: {
    subject: "Reset your password — To do",
    heading: "Reset password",
    line1: "We received a request to reset the password for your To do account.",
    button: "Reset password",
    line2: "If you didn't ask for this, you can ignore this email — your password stays the same.",
    expiry: "This link expires in 1 hour and can only be used once.",
    fallback: "If the button doesn't work, copy and paste this address into your browser:",
  },
};

function passwordResetEmail(locale, link) {
  const c = COPY[locale] || COPY.en;
  const text = `${c.heading}\n\n${c.line1}\n\n${c.button}: ${link}\n\n${c.expiry}\n\n${c.line2}`;
  const html = `<!doctype html><html><body style="font-family:system-ui,Segoe UI,Arial,sans-serif;background:#0f1115;color:#e8e8ea;padding:24px">
  <div style="max-width:480px;margin:0 auto;background:#171a21;border:1px solid #2a2f3a;border-radius:14px;padding:28px">
    <h1 style="margin:0 0 12px;font-size:20px;color:#ffd166">${esc(c.heading)}</h1>
    <p style="margin:0 0 16px;line-height:1.5">${esc(c.line1)}</p>
    <p style="margin:0 0 20px"><a href="${esc(link)}" style="display:inline-block;background:#ffd166;color:#111;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:10px">${esc(c.button)}</a></p>
    <p style="margin:0 0 8px;font-size:13px;color:#a7adba">${esc(c.expiry)}</p>
    <p style="margin:0 0 16px;font-size:13px;color:#a7adba">${esc(c.line2)}</p>
    <p style="margin:0;font-size:12px;color:#7c828e">${esc(c.fallback)}<br><span style="color:#a7adba">${esc(link)}</span></p>
  </div></body></html>`;
  return { subject: c.subject, text, html };
}

module.exports = { passwordResetEmail };
