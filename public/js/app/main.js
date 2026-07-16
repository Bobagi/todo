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
} from "./api.js";
import { useDragTabs } from "./dragTabs.js";
import { useDragTasks } from "./dragTasks.js";
import { StoreModal, UpgradesModal } from "./store.js";
import {
  e,
  getExpiryDateString,
  handleGlowMove,
  passwordStrength,
  TAB_NAME_MAX,
  validateUsername,
} from "./utils.js";

const GOOGLE_ON = !!(
  window.__GOOGLE_CLIENT_ID__ && !window.__GOOGLE_CLIENT_ID__.startsWith("%")
);

function App() {
  const [tasks, setTasks] = React.useState([]);
  const [tabs, setTabs] = React.useState([]);
  const [selectedTabId, setSelectedTabId] = React.useState(null);
  const [title, setTitle] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [token, setToken] = React.useState(localStorage.getItem("token"));
  const [isRegister, setIsRegister] = React.useState(false);
  const [acceptLegal, setAcceptLegal] = React.useState(false);
  const [editingTaskId, setEditingTaskId] = React.useState(null);
  const [editingTitle, setEditingTitle] = React.useState("");

  const [billingCfg, setBillingCfg] = React.useState(null);

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
  function askPrompt(titleTxt, message, defaultValue = "") {
    setDialogValue(defaultValue);
    return new Promise((resolve) =>
      setDialog({ titleTxt, message, input: true, confirmLabel: "Save", resolve })
    );
  }
  function askConfirm(titleTxt, message, confirmLabel = "Delete") {
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
      toast("Payment successful");
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
    const name = await askPrompt("New tab", `Name your tab (max ${TAB_NAME_MAX} characters).`);
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
      toast("Tab created");
    } else {
      const d = await res.json().catch(() => ({}));
      toast(d.error || "Couldn't create the tab", "error");
    }
  }

  async function beginRenameTab(tab) {
    const current = tab.name || "";
    const newName = await askPrompt("Rename tab", `Up to ${TAB_NAME_MAX} characters.`, current);
    if (newName == null) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === current) return;
    if (trimmed.length > TAB_NAME_MAX) {
      toast(`Tab name must be ${TAB_NAME_MAX} characters or fewer`, "error");
      return;
    }
    const res = await apiRenameTab(token, tab.id, trimmed);
    if (res.ok) fetchTabs();
    else {
      const d = await res.json().catch(() => ({}));
      toast(d.error || "Couldn't rename the tab", "error");
    }
  }

  async function onDeleteTab(tabId) {
    const ok = await askConfirm(
      "Delete tab?",
      "This deletes the tab and every task in it. This can't be undone.",
      "Delete tab"
    );
    if (!ok) return;
    const res = await apiDeleteTab(token, tabId);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || "Couldn't delete the tab", "error");
      return;
    }
    if (selectedTabId === tabId) setSelectedTabId(null);
    await fetchTabs();
    toast("Tab deleted");
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
    const ok = await askConfirm("Delete task?", "This can't be undone.");
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
        toast("Username must be 3–30 characters (letters, numbers, _)", "error");
        return;
      }
      const s = passwordStrength(password);
      if (!s.ok) {
        toast("Password needs upper- and lowercase, a number, and a symbol (min 8)", "error");
        return;
      }
      if (password !== confirmPassword) {
        toast("Passwords don't match", "error");
        return;
      }
      if (!acceptLegal) {
        toast("Please accept the Terms and Privacy Policy", "error");
        return;
      }
    }

    const body = isRegister
      ? { username, password, acceptLegal: true }
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
      setPassword("");
      setConfirmPassword("");
      setAcceptLegal(false);
    } else toast(d.error || "Something went wrong. Try again.", "error");
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
      fetchTabs();
    } else toast(d.error || "Google sign-in failed", "error");
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
                  maxLength: TAB_NAME_MAX,
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
                "Cancel"
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
          e("span", { className: "auth__wordmark" }, "To do")
        ),
        e(
          "h2",
          { className: "auth__title" },
          isRegister ? "Create account" : e(React.Fragment, null, "Welcome ", e("span", { className: "accent" }, "back"))
        ),
        e("input", {
          placeholder: "Username",
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
        e("input", {
          type: "password",
          maxLength: 72,
          placeholder: "Password",
          autoComplete: isRegister ? "new-password" : "current-password",
          value: password,
          onChange: (ev) => setPassword(ev.target.value),
          onKeyDown: (ev) => {
            if (ev.key === "Enter") handleAuth();
          },
          className: "auth-input",
        }),
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
            "Strength: ",
            e("b", null, passInfo.label),
            passInfo.ok ? "" : ` — missing ${passInfo.reasons.join(", ")}`
          ),
        isRegister &&
          e("input", {
            type: "password",
            placeholder: "Confirm password",
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
              "I agree to the ",
              e("a", { href: "/legal/terms.html", target: "_blank" }, "Terms"),
              " and ",
              e("a", { href: "/legal/privacy.html", target: "_blank" }, "Privacy Policy"),
              "."
            )
          ),
        e(
          "button",
          { onClick: handleAuth, className: "btn btn--primary" },
          isRegister ? "Create account" : "Sign in"
        ),
        GOOGLE_ON &&
          e("div", { className: "auth__sep" }, "or"),
        GOOGLE_ON &&
          e("div", { className: "auth__google", ref: googleBtnRef }),
        e(
          "button",
          {
            onClick: () => setIsRegister(!isRegister),
            className: "btn btn--ghost",
          },
          isRegister ? "Have an account? Sign in" : "New here? Create account"
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
                title: "Install app",
              },
              e("i", { className: "ph-bold ph-download-simple" }),
              e("span", { className: "label" }, "Install")
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
              title: "Store",
            },
            e("i", { className: "ph-bold ph-coins" })
          ),
          e(
            "button",
            {
              onClick: () => setUpgOpen(true),
              className: "iconbtn",
              title: "My upgrades",
            },
            e("i", { className: "ph-bold ph-list-bullets" })
          ),
          e(
            "button",
            { onClick: logout, className: "iconbtn iconbtn--danger", title: "Log out" },
            e("i", { className: "ph-bold ph-sign-out" })
          )
        )
      ),

      // tabs
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
            title: "New tab",
          },
          e("i", { className: "ph-bold ph-plus" }),
          " New tab"
        )
      ),

      // long-press tab menu
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
                title: "Rename tab",
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
                title: "Delete tab",
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
                title: `Buy +${billingCfg?.task_pack_size ?? 6} tasks`,
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
          placeholder: "Add a task…",
        }),
        e(
          "button",
          {
            onClick: addTask,
            title: "Add task",
            className: "btn btn--primary composer__add",
            disabled: !selectedTabId,
          },
          e("i", { className: "ph-bold ph-plus" })
        )
      ),

      // task list OR empty state
      taskArr.length
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
                  title: "Drag to reorder",
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
                            title: "Save",
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
                    title: "Delete task",
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
            e("div", { className: "empty__title" }, "No tasks yet"),
            e(
              "div",
              { className: "empty__hint" },
              selectedTabId
                ? "Add your first one below."
                : "Create a tab to get started."
            )
          )
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
