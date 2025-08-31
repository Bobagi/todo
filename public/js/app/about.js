import { e } from "./utils.js";

export function AboutModal({ open, setOpen, billingCfg }) {
  if (!open) return null;

  const appVersion = window.__APP_VERSION__ || "0.1.0";
  const swVersion = window.__SW_VERSION__ || "v6";

  return e(
    "div",
    {
      style: {
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.6)",
        display: "grid",
        placeItems: "center",
        zIndex: 9999,
        padding: "1rem",
      },
      onClick: () => setOpen(false),
    },
    e(
      "div",
      {
        onClick: (ev) => ev.stopPropagation(),
        style: {
          width: "min(720px,96vw)",
          background: "#111",
          border: "2px solid #f1c40f",
          borderRadius: 12,
          padding: "1rem",
          color: "#fff",
          boxShadow: "0 10px 30px rgba(0,0,0,.5)",
        },
      },
      e(
        "div",
        { style: { display: "flex", alignItems: "center", gap: 8 } },
        e("h3", { style: { margin: 0 } }, "About"),
        e(
          "button",
          {
            className: "icon-button",
            style: { marginLeft: "auto" },
            onClick: () => setOpen(false),
            title: "Close",
          },
          e("i", { className: "ph-bold ph-x" })
        )
      ),
      e(
        "div",
        { className: "about-kv" },
        e("div", { className: "k" }, "App version:"),
        e("div", { className: "v" }, appVersion),

        e("div", { className: "k" }, "SW cache:"),
        e("div", { className: "v" }, swVersion),

        e("div", { className: "k" }, "Default limits:"),
        e(
          "div",
          { className: "v" },
          billingCfg
            ? `tabs = ${billingCfg.base_tabs}, tasks/aba = ${billingCfg.base_tasks_per_tab}`
            : "—"
        )
      ),
      e(
        "div",
        { style: { marginTop: 10, fontSize: 13, opacity: 0.9 } },
        "Legal: ",
        e(
          "a",
          { href: "/legal/terms.html", target: "_blank" },
          "Termos de Uso"
        ),
        " • ",
        e(
          "a",
          { href: "/legal/privacy.html", target: "_blank" },
          "Política de Privacidade"
        )
      )
    )
  );
}
