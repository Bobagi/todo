import { e, fmtMoney, getExpiryDateString } from "./utils.js";
import { openCheckout, fakeGrant, myEntitlements } from "./api.js";

export function StoreModal({
  token,
  tabs,
  selectedTabId,
  billingCfg,
  storeOpen,
  setStoreOpen,
  storeFocus,
  setStoreFocus,
  storeTaskPackTabId,
  setStoreTaskPackTabId,
  storeReason,
  onAfterChange, // callback pra recarregar tabs/tasks e fechar modal
}) {
  if (!storeOpen) return null;

  const expiry = getExpiryDateString(billingCfg);
  const selectedTab = tabs.find(
    (t) => t.id === (storeTaskPackTabId ?? selectedTabId)
  );

  const ReasonBanner = () => {
    let msg = null;
    if (storeReason === "TASK_LIMIT")
      msg =
        "Parece que você estourou o limite de tarefas desta aba. Compre um pacote para liberar mais tarefas.";
    if (storeReason === "TAB_LIMIT")
      msg =
        "Você atingiu o limite de abas da sua conta. Compre um slot adicional para criar novas abas.";
    return msg
      ? e(
          "div",
          {
            style: {
              background: "#2a2300",
              border: "1px solid #f1c40f66",
              color: "#ffd",
              padding: "8px 10px",
              borderRadius: 8,
              margin: "8px 0 4px",
              fontSize: 13,
            },
          },
          msg
        )
      : null;
  };

  const Info = ({ children }) =>
    e(
      "details",
      {
        style: {
          marginTop: 6,
          background: "#0b0b0b",
          border: "1px dashed #555",
          borderRadius: 8,
          padding: "6px 10px",
          fontSize: 12,
        },
      },
      e("summary", { style: { cursor: "pointer" } }, "❓ Como funciona"),
      e("div", { style: { opacity: 0.85, marginTop: 6 } }, children)
    );

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
      onClick: () => setStoreOpen(false),
    },
    e(
      "div",
      {
        onClick: (ev) => ev.stopPropagation(),
        style: {
          width: "min(760px,96vw)",
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
        { style: { display: "flex", alignItems: "center", gap: 10 } },
        e("h3", { style: { margin: 0 } }, "Store / Upgrades"),
        e(
          "span",
          {
            style: {
              marginLeft: 6,
              fontSize: 12,
              padding: "2px 6px",
              border: "1px solid #f1c40f55",
              borderRadius: 6,
              opacity: 0.8,
            },
            title: "Pagamentos via Stripe (use 4242...)",
          },
          "Stripe"
        ),
        e(
          "button",
          {
            onClick: () => setStoreOpen(false),
            style: { marginLeft: "auto" },
            className: "icon-button",
            title: "Close",
          },
          e("i", { className: "ph-bold ph-x" })
        )
      ),
      e(ReasonBanner),

      // seleção da aba
      e(
        "div",
        { style: { marginTop: 10 } },
        e(
          "label",
          { style: { fontSize: 13, opacity: 0.8 } },
          "Pacote de tarefas será aplicado à aba:"
        ),
        e(
          "div",
          {
            style: { display: "flex", gap: 8, marginTop: 6, flexWrap: "wrap" },
          },
          e(
            "select",
            {
              value: storeTaskPackTabId ?? selectedTabId ?? "",
              onChange: (ev) => setStoreTaskPackTabId(Number(ev.target.value)),
              style: {
                background: "#0c0c0c",
                color: "#fff",
                border: "1px solid #f1c40f55",
                borderRadius: 8,
                padding: "8px 10px",
                minWidth: 180,
              },
            },
            tabs.map((t) => e("option", { key: t.id, value: t.id }, t.name))
          ),
          selectedTab &&
            e(
              "div",
              {
                style: {
                  fontSize: 12,
                  padding: "8px 10px",
                  border: "1px dashed #555",
                  borderRadius: 8,
                  background: "#0c0c0c",
                  opacity: 0.9,
                },
              },
              "Selecionada: ",
              e("b", null, selectedTab.name),
              " • Expira em ",
              e("b", null, expiry)
            )
        )
      ),

      // cards
      e(
        "div",
        {
          style: {
            display: "grid",
            gap: 12,
            gridTemplateColumns: "1fr 1fr",
            marginTop: 12,
          },
        },
        // TAB_SLOT
        e(
          "div",
          {
            style: {
              border:
                storeFocus === "TAB_SLOT"
                  ? "2px solid #ffd700"
                  : "1px solid #f1c40f55",
              borderRadius: 10,
              padding: 14,
              background: "#0c0c0c",
            },
          },
          e("h4", { style: { marginTop: 0 } }, "Aba extra (30 dias)"),
          e(
            "p",
            { style: { marginTop: 0, opacity: 0.85, fontSize: 13 } },
            "Libera +1 slot de aba para sua conta (global). Expira em ",
            e("b", null, expiry),
            "."
          ),
          e(
            "div",
            { style: { fontSize: 26, fontWeight: "bold" } },
            billingCfg
              ? fmtMoney(billingCfg.tab_price_cents, billingCfg.currency)
              : "—"
          ),
          e(
            "div",
            { style: { display: "flex", gap: 8, marginTop: 10 } },
            e(
              "button",
              {
                onClick: () => openCheckout(token, "TAB_SLOT"),
                style: { flex: 1 },
              },
              "Comprar"
            ),
            e(
              "button",
              {
                className: "icon-button",
                title: "DEV: conceder sem Stripe",
                onClick: async () => {
                  const r = await fakeGrant(token, "TAB_SLOT");
                  if (!r.ok) {
                    const d = await r.json().catch(() => ({}));
                    alert(d.error || "Not allowed");
                    return;
                  }
                  setStoreOpen(false);
                  await onAfterChange?.();
                },
              },
              e("i", { className: "ph-bold ph-flask" })
            )
          ),
          e(
            Info,
            null,
            "Cada compra adiciona um slot de aba por ",
            e("b", null, `${billingCfg?.entitlement_days ?? 30} dias`),
            "."
          )
        ),

        // TASK_PACK
        e(
          "div",
          {
            style: {
              border:
                storeFocus === "TASK_PACK"
                  ? "2px solid #ffd700"
                  : "1px solid #f1c40f55",
              borderRadius: 10,
              padding: 14,
              background: "#0c0c0c",
            },
          },
          e(
            "h4",
            { style: { marginTop: 0 } },
            `+${billingCfg?.task_pack_size ?? 6} tarefas (30 dias)`
          ),
          e(
            "p",
            { style: { marginTop: 0, opacity: 0.85, fontSize: 13 } },
            "Válido apenas para a aba selecionada acima. Expira em ",
            e("b", null, expiry),
            "."
          ),
          e(
            "div",
            { style: { fontSize: 26, fontWeight: "bold" } },
            billingCfg
              ? fmtMoney(billingCfg.task_pack_price_cents, billingCfg.currency)
              : "—"
          ),
          e(
            "div",
            { style: { display: "flex", gap: 8, marginTop: 10 } },
            e(
              "button",
              {
                onClick: () =>
                  openCheckout(
                    token,
                    "TASK_PACK",
                    storeTaskPackTabId ?? selectedTabId
                  ),
                style: {
                  flex: 1,
                  opacity: storeTaskPackTabId ?? selectedTabId ? 1 : 0.6,
                },
                disabled: !(storeTaskPackTabId ?? selectedTabId),
                title:
                  storeTaskPackTabId ?? selectedTabId
                    ? ""
                    : "Selecione uma aba acima",
              },
              "Comprar para esta aba"
            ),
            e(
              "button",
              {
                className: "icon-button",
                title: "DEV: conceder sem Stripe",
                onClick: async () => {
                  const tabId = storeTaskPackTabId ?? selectedTabId;
                  if (!tabId) return;
                  const r = await fakeGrant(token, "TASK_PACK", tabId);
                  if (!r.ok) {
                    const d = await r.json().catch(() => ({}));
                    alert(d.error || "Not allowed");
                    return;
                  }
                  setStoreOpen(false);
                  await onAfterChange?.();
                },
                disabled: !(storeTaskPackTabId ?? selectedTabId),
                style: {
                  opacity: storeTaskPackTabId ?? selectedTabId ? 1 : 0.6,
                },
              },
              e("i", { className: "ph-bold ph-flask" })
            )
          ),
          e(
            Info,
            null,
            "O pacote soma ",
            e("b", null, `+${billingCfg?.task_pack_size ?? 6} tarefas`),
            " ao limite da aba escolhida pelo período informado."
          )
        )
      ),

      e(
        "div",
        { style: { marginTop: 12, fontSize: 12, opacity: 0.7 } },
        "Upgrades comprados hoje expiram em ",
        e("b", null, expiry),
        "."
      )
    )
  );
}

export function UpgradesModal({ token, open, setOpen }) {
  const [list, setList] = React.useState([]);

  React.useEffect(() => {
    if (!open) return;
    (async () => {
      const data = await myEntitlements(token).catch(() => []);
      setList(Array.isArray(data) ? data : []);
    })();
  }, [open, token]);

  if (!open) return null;

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
        },
      },
      e(
        "div",
        { style: { display: "flex", alignItems: "center" } },
        e("h3", { style: { margin: 0 } }, "Meus Upgrades"),
        e(
          "button",
          {
            className: "icon-button",
            style: { marginLeft: "auto" },
            onClick: () => setOpen(false),
          },
          e("i", { className: "ph-bold ph-x" })
        )
      ),
      e(
        "div",
        { style: { marginTop: 8, fontSize: 13, opacity: 0.8 } },
        "Veja abaixo tudo que você já adquiriu e quando expira."
      ),
      e(
        "div",
        { style: { marginTop: 10, maxHeight: "60vh", overflow: "auto" } },
        (list.length ? list : []).map((u) =>
          e(
            "div",
            {
              key: `${u.type}-${u.tab_id}-${u.expires_at}-${Math.random()}`,
              style: {
                border: "1px solid #444",
                borderRadius: 8,
                padding: "8px 10px",
                marginBottom: 8,
                background: "#0c0c0c",
              },
            },
            e(
              "div",
              null,
              e(
                "b",
                null,
                u.type === "TAB_SLOT"
                  ? "Aba extra"
                  : `Pacote de tarefas (+${u.amount})`
              )
            ),
            e(
              "div",
              { style: { fontSize: 12, opacity: 0.9 } },
              u.tab_name ? `Aba: ${u.tab_name}` : "Global",
              " • Expira em ",
              new Date(u.expires_at).toLocaleString(),
              " • ",
              u.is_active ? "Ativo ✅" : "Expirado ❌"
            )
          )
        )
      )
    )
  );
}
