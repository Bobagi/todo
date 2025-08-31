export const e = React.createElement;
export const TAB_NAME_MAX = 30;

export const fmtMoney = (cents, cur) =>
  `${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
  })} ${String(cur).toUpperCase()}`;

export const addDays = (d, days) => new Date(d.getTime() + days * 86400000);

export const getExpiryDateString = (billingCfg) =>
  addDays(new Date(), billingCfg?.entitlement_days ?? 30).toLocaleDateString();

export const handleGlowMove = (e) => {
  const el = e.currentTarget;
  const r = el.getBoundingClientRect();
  el.style.setProperty("--mx", `${e.clientX - r.left}px`);
  el.style.setProperty("--my", `${e.clientY - r.top}px`);
};

/**
 * Username: 3–30 chars, letters/numbers/_ only.
 */
export function validateUsername(u) {
  return /^[A-Za-z0-9_]{3,30}$/.test(u || "");
}

/**
 * Password strength:
 * - Requirements for OK bar:
 *   at least 3 of the 4 classes AND length >= 8
 * - Strong when ALL requirements are met (upper, lower, number, symbol, length>=8)
 * Returns: { ok, score, label, reasons[] }
 * score 0..4 (used by the 3-segment meter in main.js)
 */
export function passwordStrength(pw = "") {
  const s = String(pw);
  const len = s.length;
  const hasUpper = /[A-Z]/.test(s);
  const hasLower = /[a-z]/.test(s);
  const hasNumber = /\d/.test(s);
  const hasSymbol = /[^A-Za-z0-9]/.test(s);

  const reasons = [];
  if (len < 8) reasons.push("min 8 chars");
  if (!hasUpper) reasons.push("uppercase");
  if (!hasLower) reasons.push("lowercase");
  if (!hasNumber) reasons.push("number");
  if (!hasSymbol) reasons.push("symbol");

  // base score components
  let score = 0;
  if (len >= 8) score += 1;
  if (hasUpper && hasLower) score += 1;
  if (hasNumber) score += 1;
  if (hasSymbol) score += 1;

  const classes = [hasUpper, hasLower, hasNumber, hasSymbol].filter(
    Boolean
  ).length;
  const okPartial = len >= 8 && classes >= 3;
  const okFull = len >= 8 && hasUpper && hasLower && hasNumber && hasSymbol;

  const label = okFull ? "Strong" : okPartial ? "OK" : "Weak";

  return {
    ok: okFull,
    score, // 0..4 (main.js converte em 0..3 segmentos)
    label,
    reasons,
  };
}
