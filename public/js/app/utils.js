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
