// public/js/app/main.js
import { AboutModal } from "./about.js";
import {
  addTask as apiAddTask,
  createTab as apiCreateTab,
  deleteTab as apiDeleteTab,
  deleteTask as apiDeleteTask,
  fetchTabs as apiFetchTabs,
  fetchTasks as apiFetchTasks,
  renameTab as apiRenameTab,
  toggleTask as apiToggleTask,
  capacity,
  fetchBillingConfig,
  reorderTabs,
  reorderTasks,
  forgotPassword,
  resetPassword,
} from "./api.js";
import { useDragTabs } from "./dragTabs.js";
import { useDragTasks } from "./dragTasks.js";
import { LANGS, lang, setLang, t } from "./i18n.js";
import { InventoryView } from "./inventory.js";
import { StoreModal, UpgradesModal } from "./store.js";
import {
  e,
  getExpiryDateString,
  handleGlowMove,
  passwordStrength,
  TAB_NAME_MAX,
  validateUsername,
  validateEmail,
} from "./utils.js";

const GOOGLE_ON = !!(
  window.__GOOGLE_CLIENT_ID__ && !window.__GOOGLE_CLIENT_ID__.startsWith("%")
);

// Flag-only language picker. A native <select> can't render just an emoji flag
// cleanly (it shows text and its popup is unstyled), so this is a small themed
// popover: the trigger shows only the current flag; the open list shows each
// flag beside its endonym so it stays usable.
//
// Flags are inline-SVG spans (`.flag .flag--<code>`), NOT emoji — Windows' Segoe
// UI Emoji has no flag glyphs and renders "BR"/"ES" letters instead.
const flagEl = (code) =>
  e("span", { className: "flag flag--" + code, "aria-hidden": "true" });

function LangMenu() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef(null);
  const current = LANGS.find((l) => l.code === lang()) || LANGS[0];

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (ev) => {
      if (ref.current && !ref.current.contains(ev.target)) setOpen(false);
    };
    const onKey = (ev) => ev.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return e(
    "div",
    { className: "langmenu", ref },
    e(
      "button",
      {
        className: "langmenu__btn",
        "aria-label": t("common.language"),
        "aria-haspopup": "listbox",
        "aria-expanded": open,
        title: current.label,
        onClick: () => setOpen((o) => !o),
      },
      flagEl(current.code),
      e("i", { className: "ph-bold ph-caret-down langmenu__caret" })
    ),
    open &&
      e(
        "ul",
        { className: "langmenu__list", role: "listbox" },
        LANGS.map((l) =>
          e(
            "li",
            { key: l.code, role: "option", "aria-selected": l.code === current.code },
            e(
              "button",
              {
                className: "langmenu__item" + (l.code === current.code ? " is-on" : ""),
                onClick: () => {
                  setOpen(false);
                  setLang(l.code);
                },
              },
              flagEl(l.code),
              e("span", { className: "langmenu__label" }, l.label)
            )
          )
        )
      )
  );
}

function App() {
  const [tasks, setTasks] = React.useState([]);
  const [tabs, setTabs] = React.useState([]);
  const [selectedTabId, setSelectedTabId] = React.useState(null);
  const [title, setTitle] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [token, setToken] = React.useState(localStorage.getItem("token"));
  const [isRegister, setIsRegister] = React.useState(false);
  const [acceptLegal, setAcceptLegal] = React.useState(false);
  const [forgotMode, setForgotMode] = React.useState(false);
  const [resetToken, setResetToken] = React.useState(null);
  const [editingTaskId, setEditingTaskId] = React.useState(null);
  const [editingTitle, setEditingTitle] = React.useState("");

  const [billingCfg, setBillingCfg] = React.useState(null);

  // "tasks" | "inventory" — the chosen view survives reloads so the app opens
  // where you left it (the inventory is checked mid-packing, not from scratch).
  const [view, setView] = React.useState(
    () => localStorage.getItem("view") || "tasks"
  );
  React.useEffect(() => localStorage.setItem("view", view), [view]);

  // Store
  const [storeOpen, setStoreOpen] = React.useState(false);
  const [storeFocus, setStoreFocus] = React.useState(null);
  const [storeTaskPackTabId, setStoreTaskPackTabId] = React.useState(null);
  const [storeReason, setStoreReason] = React.useState("MANUAL");

  // Upgrades
  const [upgOpen, setUpgOpen] = React.useState(false);

  // About
  const [aboutOpen, setAboutOpen] = React.useState(false);
  React.useEffect(() => {
    const open = () => setAboutOpen(true);
    window.addEventListener("open-about-modal", open);
    return () => window.removeEventListener("open-about-modal", open);
  }, []);

  // ---- toasts + themed dialogs (replace native alert/prompt/confirm) ----
  const toastId = React.useRef(0);
  const [toasts, setToasts] = React.useState([]);
  function toast(msg, kind) {
    const id = ++toastId.current;
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }
  const [dialog, setDialog] = React.useState(null);
  const [dialogValue, setDialogValue] = React.useState("");
  function askPrompt(titleTxt, message, defaultValue = "", maxLength = TAB_NAME_MAX) {
    setDialogValue(defaultValue);
    return new Promise((resolve) =>
      setDialog({ titleTxt, message, input: true, maxLength, confirmLabel: t("common.save"), resolve })
    );
  }
  function askConfirm(titleTxt, message, confirmLabel = t("common.delete")) {
    return new Promise((resolve) =>
      setDialog({ titleTxt, message, input: false, confirmLabel, danger: true, resolve })
    );
  }
  function closeDialog(ok) {
    const d = dialog;
    setDialog(null);
    if (!d) return;
    d.resolve(ok ? (d.input ? dialogValue.trim() : true) : d.input ? null : false);
  }
  React.useEffect(() => {
    if (!dialog) return;
    const onKey = (ev) => {
      if (ev.key === "Escape") closeDialog(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dialog, dialogValue]);

  // Auth refs
  const usernameRef = React.useRef(null);
  const googleBtnRef = React.useRef(null);

  // Long-press tab menu
  const [tabMenuTargetId, setTabMenuTargetId] = React.useState(null);
  const [tabMenuPos, setTabMenuPos] = React.useState({ x: 0, y: 0 });

  // DnD tabs (with long-press)
  const { isDraggingTabs, draggingTabId, setTabRef, handleTabPointerDown } =
    useDragTabs(
      tabs,
      setTabs,
      async (ordered) => {
        const data = await reorderTabs(
          token,
          ordered.map((t) => t.id)
        ).catch(() => tabs);
        setTabs(Array.isArray(data) ? data : tabs);
      },
      {
        onLongPress: (tab, pos) => {
          setTabMenuTargetId(tab.id);
          setTabMenuPos(pos);
        },
      }
    );

  // DnD tasks
  const { isDraggingTasks, draggingTaskId, setTaskRef, handleTaskPointerDown } =
    useDragTasks(tasks, setTasks, async (ordered) => {
      if (!selectedTabId) return;
      const data = await reorderTasks(
        token,
        selectedTabId,
        ordered.map((t) => t.id)
      ).catch(() => tasks);
      setTasks(Array.isArray(data) ? data : tasks);
    });

  // API helpers
  const loadBilling = async () =>
    setBillingCfg(await fetchBillingConfig(token));

  const fetchTabs = async () => {
    const list = await apiFetchTabs(token).catch((err) => {
      if (err.message === "unauth") {
        setToken(null);
        localStorage.removeItem("token");
        return [];
      }
      return [];
    });
    setTabs(Array.isArray(list) ? list : []);
    if (!selectedTabId && list.length) setSelectedTabId(list[0].id);
  };

  const fetchTasks = async () => {
    const list = await apiFetchTasks(token, selectedTabId).catch((err) => {
      if (err.message === "unauth") {
        setToken(null);
        localStorage.removeItem("token");
        return [];
      }
      return [];
    });
    setTasks(Array.isArray(list) ? list : []);
  };

  // effects
  React.useEffect(() => {
    if (!token) return;
    loadBilling();
    fetchTabs();
  }, [token]);

  React.useEffect(() => {
    if (!token) return;
    fetchTasks();
  }, [token, selectedTabId]);

  React.useEffect(() => {
    if (!token && usernameRef.current)
      setTimeout(() => usernameRef.current?.focus(), 0);
  }, [token, isRegister]);

  // checkout return
  React.useEffect(() => {
    if (!token) return;
    const url = new URL(window.location.href);
    const paid = url.searchParams.get("paid");
    const canceled = url.searchParams.get("canceled");
    if (paid === "1") {
      toast(t("task.paid"));
      setStoreOpen(false);
      fetchTabs();
      fetchTasks();
      window.history.replaceState(null, "", url.pathname);
    } else if (canceled === "1") {
      window.history.replaceState(null, "", url.pathname);
    }
  }, [token]);

  // actions
  async function createTab() {
    const cap = await capacity(token).catch(() => ({ canCreate: true }));
    if (!cap.canCreate) {
      setStoreFocus("TAB_SLOT");
      setStoreReason("TAB_LIMIT");
      setStoreOpen(true);
      return;
    }
    const name = await askPrompt(t("tab.new"), t("tab.nameIt", { max: TAB_NAME_MAX }));
    if (!name) return;
    const res = await apiCreateTab(token, name.slice(0, TAB_NAME_MAX));
    if (res.status === 402) {
      setStoreFocus("TAB_SLOT");
      setStoreReason("TAB_LIMIT");
      setStoreOpen(true);
      return;
    }
    if (res.ok) {
      fetchTabs();
      toast(t("tab.created"));
    } else {
      const d = await res.json().catch(() => ({}));
      toast(d.error || t("tab.errCreate"), "error");
    }
  }

  async function beginRenameTab(tab) {
    const current = tab.name || "";
    const newName = await askPrompt(t("tab.rename"), t("tab.upTo", { max: TAB_NAME_MAX }), current);
    if (newName == null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === current) return;
    if (trimmed.length > TAB_NAME_MAX) {
      toast(t("tab.tooLong", { max: TAB_NAME_MAX }), "error");
      return;
    }
    const res = await apiRenameTab(token, tab.id, trimmed);
    if (res.ok) fetchTabs();
    else {
      const d = await res.json().catch(() => ({}));
      toast(d.error || t("tab.errRename"), "error");
    }
  }

  async function onDeleteTab(tabId) {
    const ok = await askConfirm(t("tab.deleteQ"), t("tab.deleteMsg"), t("tab.delete"));
    if (!ok) return;
    const res = await apiDeleteTab(token, tabId);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || t("tab.errDelete"), "error");
      return;
    }
    if (selectedTabId === tabId) setSelectedTabId(null);
    await fetchTabs();
    toast(t("tab.deleted"));
  }

  async function addTask() {
    if (!title.trim()) return;
    const res = await apiAddTask(token, title, selectedTabId);
    if (res.status === 402) {
      setStoreTaskPackTabId(selectedTabId);
      setStoreFocus("TASK_PACK");
      setStoreReason("TASK_LIMIT");
      setStoreOpen(true);
      return;
    }
    setTitle("");
    fetchTasks();
  }

  async function deleteTask(id) {
    const ok = await askConfirm(t("task.deleteQ"), t("task.deleteMsg"));
    if (!ok) return;
    await apiDeleteTask(token, id);
    fetchTasks();
  }

  async function saveTaskTitle() {
    await fetch(`/api/tasks/${editingTaskId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({ title: editingTitle }),
    });
    setEditingTaskId(null);
    fetchTasks();
  }

  async function toggleDone(task) {
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t))
    );
    try {
      await apiToggleTask(token, task.id, !task.done);
    } catch {
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, done: task.done } : t))
      );
    }
  }

  async function handleAuth() {
    const endpoint = isRegister ? "/api/register" : "/api/login";

    if (isRegister) {
      if (!validateUsername(username)) {
        toast(t("auth.badUsername"), "error");
        return;
      }
      if (!validateEmail(email)) {
        toast(t("auth.badEmail"), "error");
        return;
      }
      const s = passwordStrength(password);
      if (!s.ok) {
        toast(t("auth.badPassword"), "error");
        return;
      }
      if (password !== confirmPassword) {
        toast(t("auth.mismatch"), "error");
        return;
      }
      if (!acceptLegal) {
        toast(t("auth.mustAccept"), "error");
        return;
      }
    }

    const body = isRegister
      ? { username, email, password, acceptLegal: true }
      : { username, password };

    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      localStorage.setItem("token", d.token);
      setToken(d.token);
      setUsername("");
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setAcceptLegal(false);
    } else toast(d.error || t("common.oops"), "error");
  }

  // A reset link (emailed as ?reset=<token>) opens the "choose a new password" view.
  React.useEffect(() => {
    const rt = new URL(window.location.href).searchParams.get("reset");
    if (rt) setResetToken(rt);
  }, []);

  function clearResetQuery() {
    const url = new URL(window.location.href);
    url.searchParams.delete("reset");
    window.history.replaceState({}, "", url.pathname + url.search);
  }

  async function handleForgot() {
    if (!validateEmail(email)) {
      toast(t("auth.badEmail"), "error");
      return;
    }
    // Always the same outcome regardless of whether the email exists (anti-enumeration).
    await forgotPassword(email, lang()).catch(() => {});
    toast(t("auth.resetSent"));
    setForgotMode(false);
    setEmail("");
  }

  async function handleReset() {
    if (!passwordStrength(password).ok) {
      toast(t("auth.badPassword"), "error");
      return;
    }
    if (password !== confirmPassword) {
      toast(t("auth.mismatch"), "error");
      return;
    }
    const r = await resetPassword(resetToken, password);
    if (r.ok) {
      toast(t("auth.resetOk"));
      setResetToken(null);
      clearResetQuery();
      setPassword("");
      setConfirmPassword("");
    } else {
      toast(t("auth.resetBadToken"), "error");
    }
  }

  const handleCredentialResponse = async (response) => {
    const r = await fetch("/api/google-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: response.credential }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      localStorage.setItem("token", d.token);
      setToken(d.token);
      // NÃO chamar fetchTabs() aqui: o `token` do closure ainda é o antigo (null),
      // então a chamada iria sem Authorization → 401 → o catch de fetchTabs limpa o
      // token recém-salvo e volta pro login. O useEffect([token]) já recarrega abas/
      // billing com o token novo (mesmo caminho do login por e-mail/senha).
    } else toast(d.error || t("auth.googleFailed"), "error");
  };

  // Render the real Google button once GIS is ready and a client id was injected.
  // If GOOGLE_CLIENT_ID is unset the button is skipped (no broken button, no errors).
  React.useEffect(() => {
    if (token || !GOOGLE_ON) return;
    let tries = 0;
    const iv = setInterval(() => {
      const gid = window.google?.accounts?.id;
      if (gid && googleBtnRef.current) {
        clearInterval(iv);
        googleBtnRef.current.replaceChildren();
        gid.initialize({
          client_id: window.__GOOGLE_CLIENT_ID__,
          callback: handleCredentialResponse,
        });
        gid.renderButton(googleBtnRef.current, {
          theme: "filled_black",
          size: "large",
          text: "continue_with",
          shape: "pill",
          width: 320,
          // Without this Google picks its own locale and the button ends up in a
          // different language than the page it sits on.
          locale: lang(),
        });
      } else if (++tries > 40) {
        clearInterval(iv);
      }
    }, 200);
    return () => clearInterval(iv);
  }, [token, isRegister]);

  function logout() {
    localStorage.removeItem("token");
    setToken(null);
    setTasks([]);
    setTabs([]);
    setSelectedTabId(null);
    setIsRegister(false);
    setPassword("");
    setConfirmPassword("");
  }

  const passInfo = passwordStrength(password);
  const segCount =
    passInfo.score >= 4 ? 3 : passInfo.score >= 2 ? 2 : passInfo.score >= 1 ? 1 : 0;

  // Same picker on the auth screen and in the app bar.
  const langPicker = e(LangMenu, {});

  // ---- shared overlays (toasts + dialog) ----
  const overlays = e(
    React.Fragment,
    null,
    toasts.length
      ? e(
          "div",
          { className: "toasts" },
          toasts.map((t) =>
            e(
              "div",
              {
                key: t.id,
                className: "toast" + (t.kind === "error" ? " toast--error" : ""),
              },
              t.msg
            )
          )
        )
      : null,
    dialog
      ? e(
          "div",
          { className: "modal-backdrop", onClick: () => closeDialog(false) },
          e(
            "div",
            { className: "modal", onClick: (ev) => ev.stopPropagation() },
            e("h3", { className: "modal__title" }, dialog.titleTxt),
            dialog.message
              ? e("p", { className: "modal__msg" }, dialog.message)
              : null,
            dialog.input
              ? e("input", {
                  autoFocus: true,
                  value: dialogValue,
                  maxLength: dialog.maxLength ?? TAB_NAME_MAX,
                  onChange: (ev) => setDialogValue(ev.target.value),
                  onKeyDown: (ev) => {
                    if (ev.key === "Enter") closeDialog(true);
                  },
                })
              : null,
            e(
              "div",
              { className: "modal__actions" },
              e(
                "button",
                { className: "btn btn--ghost", onClick: () => closeDialog(false) },
                t("common.cancel")
              ),
              e(
                "button",
                {
                  className: "btn " + (dialog.danger ? "btn--danger" : "btn--primary"),
                  onClick: () => closeDialog(true),
                },
                dialog.confirmLabel
              )
            )
          )
        )
      : null
  );

  // ================= AUTH =================
  if (!token) {
    const brandHeader = e(
      "div",
      { className: "auth__brand" },
      e("i", { className: "ph-bold ph-check-circle mark" }),
      e("span", { className: "auth__wordmark" }, "To do"),
      e("div", { className: "auth__brandlang" }, langPicker)
    );

    // Choose-a-new-password view (arrived via the emailed reset link).
    if (resetToken) {
      return e(
        React.Fragment,
        null,
        e(
          "div",
          { className: "authwrap" },
          brandHeader,
          e("h2", { className: "auth__title" }, t("auth.resetTitle")),
          e("input", {
            type: "password",
            maxLength: 72,
            placeholder: t("auth.newPassword"),
            autoComplete: "new-password",
            value: password,
            onChange: (ev) => setPassword(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === "Enter") handleReset();
            },
            className: "auth-input",
          }),
          e(
            "div",
            { className: "pw-meter" },
            e("span", { className: segCount >= 1 ? "on" : "" }),
            e("span", { className: segCount >= 2 ? "on" : "" }),
            e("span", { className: segCount >= 3 ? "on" : "" })
          ),
          e("input", {
            type: "password",
            placeholder: t("auth.confirmPassword"),
            value: confirmPassword,
            onChange: (ev) => setConfirmPassword(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === "Enter") handleReset();
            },
            className: "auth-input",
          }),
          e(
            "button",
            { onClick: handleReset, className: "btn btn--primary" },
            t("auth.resetBtn")
          ),
          e(
            "button",
            {
              onClick: () => {
                setResetToken(null);
                clearResetQuery();
              },
              className: "btn btn--ghost",
            },
            t("auth.backToLogin")
          )
        ),
        overlays
      );
    }

    // Request-a-reset-link view.
    if (forgotMode) {
      return e(
        React.Fragment,
        null,
        e(
          "div",
          { className: "authwrap" },
          brandHeader,
          e("h2", { className: "auth__title" }, t("auth.forgotTitle")),
          e("p", { className: "auth__hint" }, t("auth.forgotHint")),
          e("input", {
            type: "email",
            maxLength: 255,
            placeholder: t("auth.email"),
            autoComplete: "email",
            value: email,
            onChange: (ev) => setEmail(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === "Enter") handleForgot();
            },
            className: "auth-input",
          }),
          e(
            "button",
            { onClick: handleForgot, className: "btn btn--primary" },
            t("auth.sendResetLink")
          ),
          e(
            "button",
            { onClick: () => setForgotMode(false), className: "btn btn--ghost" },
            t("auth.backToLogin")
          )
        ),
        overlays
      );
    }

    return e(
      React.Fragment,
      null,
      e(
        "div",
        { className: "authwrap" },
        e(
          "div",
          { className: "auth__brand" },
          e("i", { className: "ph-bold ph-check-circle mark" }),
          e("span", { className: "auth__wordmark" }, "To do"),
          // sits on the same baseline as the wordmark, flush to the card's right
          // edge — no more box floating in dead space above the title
          e("div", { className: "auth__brandlang" }, langPicker)
        ),
        e(
          "h2",
          { className: "auth__title" },
          isRegister
            ? t("auth.createAccount")
            : e(
                React.Fragment,
                null,
                t("auth.welcome") + " ",
                e("span", { className: "accent" }, t("auth.welcomeAccent"))
              )
        ),
        e("input", {
          placeholder: t("auth.username"),
          maxLength: 50,
          value: username,
          ref: usernameRef,
          autoComplete: "username",
          onChange: (ev) => setUsername(ev.target.value),
          onKeyDown: (ev) => {
            if (ev.key === "Enter") handleAuth();
          },
          className: "auth-input",
        }),
        isRegister &&
          e("input", {
            type: "email",
            placeholder: t("auth.email"),
            maxLength: 255,
            value: email,
            autoComplete: "email",
            onChange: (ev) => setEmail(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === "Enter") handleAuth();
            },
            className: "auth-input",
          }),
        e("input", {
          type: "password",
          maxLength: 72,
          placeholder: t("auth.password"),
          autoComplete: isRegister ? "new-password" : "current-password",
          value: password,
          onChange: (ev) => setPassword(ev.target.value),
          onKeyDown: (ev) => {
            if (ev.key === "Enter") handleAuth();
          },
          className: "auth-input",
        }),
        !isRegister &&
          e(
            "button",
            {
              type: "button",
              className: "auth__forgot",
              onClick: () => setForgotMode(true),
            },
            t("auth.forgot")
          ),
        isRegister &&
          e(
            "div",
            { className: "pw-meter" },
            e("span", { className: segCount >= 1 ? "on" : "" }),
            e("span", { className: segCount >= 2 ? "on" : "" }),
            e("span", { className: segCount >= 3 ? "on" : "" })
          ),
        isRegister &&
          e(
            "div",
            { className: "pw-hint" },
            t("auth.strength"),
            e("b", null, t("pw." + passInfo.label)),
            passInfo.ok
              ? ""
              : t("auth.missing", {
                  reasons: passInfo.reasons.map((r) => t("pw." + r)).join(", "),
                })
          ),
        isRegister &&
          e("input", {
            type: "password",
            placeholder: t("auth.confirmPassword"),
            value: confirmPassword,
            onChange: (ev) => setConfirmPassword(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === "Enter") handleAuth();
            },
            className: "auth-input",
          }),
        isRegister &&
          e(
            "label",
            { className: "auth__legal" },
            e("input", {
              type: "checkbox",
              checked: acceptLegal,
              onChange: (e2) => setAcceptLegal(e2.target.checked),
            }),
            e(
              "span",
              null,
              t("auth.agreePre"),
              e("a", { href: "/legal/terms.html", target: "_blank" }, t("auth.terms")),
              t("auth.agreeMid"),
              e("a", { href: "/legal/privacy.html", target: "_blank" }, t("auth.privacy")),
              "."
            )
          ),
        e(
          "button",
          { onClick: handleAuth, className: "btn btn--primary" },
          isRegister ? t("auth.createAccount") : t("auth.signIn")
        ),
        GOOGLE_ON &&
          e("div", { className: "auth__sep" }, t("common.or")),
        GOOGLE_ON &&
          e("div", { className: "auth__google", ref: googleBtnRef }),
        e(
          "button",
          {
            onClick: () => setIsRegister(!isRegister),
            className: "btn btn--ghost",
          },
          isRegister ? t("auth.haveAccount") : t("auth.newHere")
        )
      ),
      overlays
    );
  }

  // ================= APP =================
  const taskArr = Array.isArray(tasks) ? tasks : [];
  return e(
    React.Fragment,
    null,
    e(
      "div",
      { className: "app" },

      // header / marquee
      e(
        "div",
        { className: "appbar" },
        e(
          "div",
          { className: "appbar__brand" },
          e("img", { src: "/icon.png", alt: "", className: "appbar__logo" }),
          e("h1", { className: "appbar__title" }, "To do")
        ),
        e(
          "div",
          { className: "appbar__actions" },
          !window.matchMedia("(display-mode: standalone)").matches &&
            e(
              "button",
              {
                id: "install-btn",
                className: "iconbtn iconbtn--label",
                title: t("app.installApp"),
              },
              e("i", { className: "ph-bold ph-download-simple" }),
              e("span", { className: "label" }, t("app.install"))
            ),
          e(
            "button",
            {
              onClick: () => {
                setStoreTaskPackTabId(selectedTabId);
                setStoreFocus(null);
                setStoreReason("MANUAL");
                setStoreOpen(true);
              },
              className: "iconbtn",
              title: t("app.store"),
            },
            e("i", { className: "ph-bold ph-coins" })
          ),
          e(
            "button",
            {
              onClick: () => setUpgOpen(true),
              className: "iconbtn",
              title: t("app.upgrades"),
            },
            e("i", { className: "ph-bold ph-list-bullets" })
          ),
          e(
            "button",
            { onClick: logout, className: "iconbtn iconbtn--danger", title: t("app.logout") },
            e("i", { className: "ph-bold ph-sign-out" })
          )
        )
      ),

      // view switch + language, on their own row: the app bar is already five
      // controls wide on a phone and the picker was overlapping the wordmark.
      e(
        "div",
        { className: "viewbar" },
      e(
        "div",
        { className: "viewswitch", role: "tablist" },
        e(
          "button",
          {
            className: "viewswitch__btn" + (view === "tasks" ? " is-on" : ""),
            role: "tab",
            "aria-selected": view === "tasks",
            onClick: () => setView("tasks"),
          },
          e("i", { className: "ph-bold ph-check-square" }),
          " " + t("app.tasks")
        ),
        e(
          "button",
          {
            className: "viewswitch__btn" + (view === "inventory" ? " is-on" : ""),
            role: "tab",
            "aria-selected": view === "inventory",
            onClick: () => setView("inventory"),
          },
          e("i", { className: "ph-bold ph-suitcase-rolling" }),
          " " + t("app.inventory")
        )
      ),
        langPicker
      ),

      view === "inventory" &&
        e(InventoryView, {
          token,
          toast,
          askPrompt,
          askConfirm,
          onUnauth: logout,
        }),

      // tabs
      view === "tasks" &&
      e(
        "div",
        { className: "tabs-track" },
        tabs.map((tab) =>
          e(
            "button",
            {
              key: tab.id,
              className: "tab" + (selectedTabId === tab.id ? " tab--active" : ""),
              ref: setTabRef(tab.id),
              onPointerDown: (ev) => handleTabPointerDown(tab, ev),
              onDoubleClick: () => beginRenameTab(tab),
              onClick: () => setSelectedTabId(tab.id),
              onMouseMove: handleGlowMove,
              style:
                draggingTabId === tab.id
                  ? { transform: "scale(0.98)", opacity: 0.9 }
                  : undefined,
              title: tab.name,
            },
            tab.name
          )
        ),
        e(
          "button",
          {
            className: "tab tab--new",
            onClick: createTab,
            onMouseMove: handleGlowMove,
            title: t("tab.new"),
          },
          e("i", { className: "ph-bold ph-plus" }),
          " " + t("tab.new")
        )
      ),

      // long-press tab menu
      view === "tasks" &&
        tabMenuTargetId &&
        e(
          "div",
          { className: "tabmenu", onClick: () => setTabMenuTargetId(null) },
          e(
            "div",
            {
              className: "tabmenu__card",
              style: {
                top: tabMenuPos.y + window.scrollY,
                left: tabMenuPos.x,
              },
              onClick: (ev) => ev.stopPropagation(),
            },
            e(
              "button",
              {
                className: "iconbtn",
                title: t("tab.rename"),
                onClick: () => {
                  const tab = tabs.find((t) => t.id === tabMenuTargetId);
                  setTabMenuTargetId(null);
                  if (tab) beginRenameTab(tab);
                },
              },
              e("i", { className: "ph-bold ph-pencil-simple" })
            ),
            e(
              "button",
              {
                className: "iconbtn iconbtn--danger",
                title: t("tab.delete"),
                onClick: () => {
                  const id = tabMenuTargetId;
                  setTabMenuTargetId(null);
                  onDeleteTab(id);
                },
              },
              e("i", { className: "ph-bold ph-trash" })
            ),
            e(
              "button",
              {
                className: "iconbtn",
                title: t("tab.buyTasks", { n: billingCfg?.task_pack_size ?? 6 }),
                onClick: () => {
                  setStoreTaskPackTabId(tabMenuTargetId);
                  setTabMenuTargetId(null);
                  setStoreFocus("TASK_PACK");
                  setStoreReason("MANUAL");
                  setStoreOpen(true);
                },
              },
              e("i", { className: "ph-bold ph-plus-circle" })
            )
          )
        ),

      // composer (new task)
      view === "tasks" &&
      e(
        "div",
        { className: "composer" },
        e("input", {
          className: "composer__input",
          value: title,
          maxLength: 200,
          onChange: (ev) => setTitle(ev.target.value),
          onKeyDown: (ev) => {
            if (ev.key === "Enter") addTask();
          },
          placeholder: t("task.add"),
        }),
        e(
          "button",
          {
            onClick: addTask,
            title: t("task.addTitle"),
            className: "btn btn--primary composer__add",
            disabled: !selectedTabId,
          },
          e("i", { className: "ph-bold ph-plus" })
        )
      ),

      // task list OR empty state
      view === "tasks" &&
        (taskArr.length
        ? e(
            "ul",
            { className: "tasklist" },
            taskArr.map((task) =>
              e(
                "li",
                {
                  key: task.id,
                  className: "task" + (task.done ? " task--done" : ""),
                  ref: setTaskRef(task.id),
                  onPointerDown: (ev) => handleTaskPointerDown(task, ev),
                  style: {
                    touchAction: "none",
                    cursor: isDraggingTasks ? "grabbing" : "grab",
                    opacity: draggingTaskId === task.id ? 0.85 : 1,
                  },
                  title: t("task.drag"),
                },
                // neon checkbox (signature — unchanged markup)
                e(
                  "label",
                  { className: "neon-checkbox" },
                  e("input", {
                    type: "checkbox",
                    checked: !!task.done,
                    onChange: () => toggleDone(task),
                  }),
                  e("div", { className: "neon-checkbox__frame" }, [
                    e("div", { className: "neon-checkbox__box" }, [
                      e(
                        "div",
                        { className: "neon-checkbox__check-container" },
                        e(
                          "svg",
                          { viewBox: "0 0 24 24", className: "neon-checkbox__check" },
                          e("path", { d: "M3,12.5l7,7L21,5" })
                        )
                      ),
                      e("div", { className: "neon-checkbox__glow" }),
                      e("div", { className: "neon-checkbox__borders" }, [
                        e("span"),
                        e("span"),
                        e("span"),
                        e("span"),
                      ]),
                    ]),
                    e("div", { className: "neon-checkbox__effects" }, [
                      e(
                        "div",
                        { className: "neon-checkbox__particles" },
                        Array.from({ length: 12 }, () => e("span"))
                      ),
                      e("div", { className: "neon-checkbox__rings" }, [
                        e("div", { className: "ring" }),
                        e("div", { className: "ring" }),
                        e("div", { className: "ring" }),
                      ]),
                      e("div", { className: "neon-checkbox__sparks" }, [
                        e("span"),
                        e("span"),
                        e("span"),
                        e("span"),
                      ]),
                    ]),
                  ])
                ),
                // title / inline edit
                e(
                  "div",
                  { className: "task__body" },
                  editingTaskId === task.id
                    ? e(
                        "div",
                        { className: "task__edit" },
                        e("input", {
                          type: "text",
                          value: editingTitle,
                          autoFocus: true,
                          onChange: (ev) => setEditingTitle(ev.target.value),
                          onBlur: () => setEditingTaskId(null),
                          onKeyDown: (ev) => {
                            if (ev.key === "Enter") saveTaskTitle();
                            if (ev.key === "Escape") setEditingTaskId(null);
                          },
                        }),
                        e(
                          "button",
                          {
                            className: "iconbtn",
                            title: t("common.save"),
                            onMouseDown: (ev) => ev.preventDefault(),
                            onClick: saveTaskTitle,
                          },
                          e("i", { className: "ph-bold ph-check" })
                        )
                      )
                    : e(
                        "span",
                        {
                          className: "task__title",
                          onClick: () => {
                            setEditingTaskId(task.id);
                            setEditingTitle(task.title);
                          },
                        },
                        task.title
                      )
                ),
                // delete
                e(
                  "button",
                  {
                    onClick: () => deleteTask(task.id),
                    title: t("task.delete"),
                    className: "iconbtn iconbtn--danger",
                  },
                  e("i", { className: "ph-bold ph-trash" })
                )
              )
            )
          )
        : e(
            "div",
            { className: "empty" },
            e("i", { className: "ph-bold ph-check-circle empty__mark" }),
            e("div", { className: "empty__title" }, t("task.empty")),
            e(
              "div",
              { className: "empty__hint" },
              selectedTabId ? t("task.emptyHint") : t("task.emptyNoTab")
            )
          ))
    ),

    e(StoreModal, {
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
      onAfterChange: async () => {
        await fetchTabs();
        await fetchTasks();
      },
    }),
    e(UpgradesModal, { token, open: upgOpen, setOpen: setUpgOpen }),
    e(AboutModal, { open: aboutOpen, setOpen: setAboutOpen, billingCfg }),
    overlays
  );
}

ReactDOM.render(React.createElement(App), document.getElementById("root"));
