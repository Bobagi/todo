import { t } from "./i18n.js";
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
        e("h3", { style: { margin: 0 } }, t("about.title")),
        e(
          "button",
          {
            className: "icon-button",
            style: { marginLeft: "auto" },
            onClick: () => setOpen(false),
            title: t("common.close"),
          },
          e("i", { className: "ph-bold ph-x" })
        )
      ),
      e(
        "div",
        { className: "about-kv" },
        e("div", { className: "k" }, t("about.version")),
        e("div", { className: "v" }, appVersion),

        e("div", { className: "k" }, t("about.sw")),
        e("div", { className: "v" }, swVersion),

        e("div", { className: "k" }, t("about.limits")),
        e(
          "div",
          { className: "v" },
          billingCfg
            ? t("about.limitsValue", {
                tabs: billingCfg.base_tabs,
                tasks: billingCfg.base_tasks_per_tab,
              })
            : "—"
        )
      ),
      e(
        "div",
        { style: { marginTop: 10, fontSize: 13, opacity: 0.9 } },
        t("about.legal"),
        e(
          "a",
          { href: "/legal/terms.html", target: "_blank" },
          t("auth.terms")
        ),
        " • ",
        e(
          "a",
          { href: "/legal/privacy.html", target: "_blank" },
          t("auth.privacy")
        )
      )
    )
  );
}
