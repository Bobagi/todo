// public/js/app/main.js
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
  TAB_NAME_MAX,
} from "./utils.js";

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
  const [editingTaskId, setEditingTaskId] = React.useState(null);
  const [editingTitle, setEditingTitle] = React.useState("");

  const [billingCfg, setBillingCfg] = React.useState(null);

  // Loja
  const [storeOpen, setStoreOpen] = React.useState(false);
  const [storeFocus, setStoreFocus] = React.useState(null); // 'TASK_PACK' | 'TAB_SLOT' | null
  const [storeTaskPackTabId, setStoreTaskPackTabId] = React.useState(null);
  const [storeReason, setStoreReason] = React.useState("MANUAL"); // MANUAL | TASK_LIMIT | TAB_LIMIT

  // Upgrades
  const [upgOpen, setUpgOpen] = React.useState(false);

  // Auth refs
  const usernameRef = React.useRef(null);

  // ---- MENU DE LONG-PRESS DAS ABAS ----
  const [tabMenuTargetId, setTabMenuTargetId] = React.useState(null);
  const [tabMenuPos, setTabMenuPos] = React.useState({ x: 0, y: 0 });

  // ---- DnD das ABAS (com long-press) ----
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

  // ---- DnD das TAREFAS ----
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

  // ---- API helpers ----
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

  // ---- efeitos ----
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

  // retorno do Stripe Checkout
  React.useEffect(() => {
    if (!token) return;
    const url = new URL(window.location.href);
    const paid = url.searchParams.get("paid");
    const canceled = url.searchParams.get("canceled");
    if (paid === "1") {
      alert("Payment successful!");
      setStoreOpen(false);
      fetchTabs();
      fetchTasks();
      window.history.replaceState(null, "", url.pathname);
    } else if (canceled === "1") {
      window.history.replaceState(null, "", url.pathname);
    }
  }, [token]);

  // ---- ações ----
  async function createTab() {
    const cap = await capacity(token).catch(() => ({ canCreate: true }));
    if (!cap.canCreate) {
      setStoreFocus("TAB_SLOT");
      setStoreReason("TAB_LIMIT");
      setStoreOpen(true);
      return;
    }
    let newTabName = prompt(`New tab name (max ${TAB_NAME_MAX} chars)`);
    if (!newTabName) return;
    newTabName = newTabName.trim().slice(0, TAB_NAME_MAX);
    if (!newTabName) return;
    const res = await apiCreateTab(token, newTabName);
    if (res.status === 402) {
      setStoreFocus("TAB_SLOT");
      setStoreReason("TAB_LIMIT");
      setStoreOpen(true);
      return;
    }
    if (res.ok) fetchTabs();
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Error creating tab");
    }
  }

  async function beginRenameTab(tab) {
    const current = tab.name || "";
    const newName = prompt(`Rename tab (max ${TAB_NAME_MAX} chars)`, current);
    if (!newName) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === current) return;
    if (trimmed.length > TAB_NAME_MAX) {
      alert(`Tab name must be up to ${TAB_NAME_MAX} characters.`);
      return;
    }
    const res = await apiRenameTab(token, tab.id, trimmed);
    if (res.ok) fetchTabs();
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Rename failed");
    }
  }

  async function onDeleteTab(tabId) {
    const ok = confirm("Delete this tab and all its tasks?");
    if (!ok) return;
    const res = await apiDeleteTab(token, tabId);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Could not delete tab.");
      return;
    }
    if (selectedTabId === tabId) setSelectedTabId(null);
    await fetchTabs();
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
    const ok = confirm("Delete this task?");
    if (!ok) return;
    await apiDeleteTask(token, id);
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
    const r = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const d = await r.json().catch(() => ({}));
    if (r.ok) {
      localStorage.setItem("token", d.token);
      setToken(d.token);
      setUsername("");
      setPassword("");
    } else alert(d.error || "Auth error");
  }

  window.handleCredentialResponse = async (response) => {
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
    } else alert(d.error || "Google auth error");
  };

  function logout() {
    localStorage.removeItem("token");
    setToken(null);
    setTasks([]);
    setTabs([]);
    setSelectedTabId(null);
  }

  const billingExpiry = getExpiryDateString(billingCfg);

  // ---- RENDER ----
  if (!token) {
    return e(
      "div",
      { style: { maxWidth: "400px", margin: "2rem auto" } },
      e("h2", null, isRegister ? "Create account" : "Login"),
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
        maxLength: 50,
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
      e(
        "button",
        { onClick: handleAuth, className: "auth-button" },
        isRegister ? "Create new account" : "Login"
      ),
      e(
        "button",
        { onClick: () => setIsRegister(!isRegister), className: "auth-button" },
        isRegister ? "Have an account? Login" : "No account? Register"
      ),
      e(
        "div",
        { style: { marginTop: "1rem" } },
        e("div", {
          id: "g_id_onload",
          "data-client_id": "GOOGLE_CLIENT_ID",
          "data-callback": "handleCredentialResponse",
        }),
        e("div", {
          className: "g_id_signin auth-button",
          "data-type": "standard",
        })
      )
    );
  }

  return e(
    "div",
    null,

    // header
    e(
      "div",
      { style: { display: "flex", alignItems: "center", gap: ".75rem" } },
      e("img", { src: "/icon.png", alt: "Logo", style: { height: "1.8em" } }),
      e("h1", { style: { margin: 0 } }, "To do"),
      !window.matchMedia("(display-mode: standalone)").matches &&
        e(
          "button",
          {
            id: "install-btn",
            style: {
              marginLeft: ".5rem",
              display: "flex",
              alignItems: "center",
              gap: ".25rem",
            },
          },
          e("i", { className: "ph-bold ph-download-simple" }),
          "Install app"
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
          className: "icon-button",
          title: "Store / Upgrade",
          style: { marginLeft: "auto" },
        },
        e("i", { className: "ph-bold ph-coins" })
      ),
      e(
        "button",
        {
          onClick: () => setUpgOpen(true),
          className: "icon-button",
          title: "Meus Upgrades",
        },
        e("i", { className: "ph-bold ph-list-bullets" })
      ),
      e(
        "button",
        { onClick: logout, className: "icon-button", title: "Logout" },
        e("i", { className: "ph-bold ph-sign-out" })
      )
    ),

    // tabs
    e(
      "div",
      {
        className: "tabs-track",
        style: {
          display: "flex",
          alignItems: "flex-end",
          gap: ".25rem",
          flexWrap: "nowrap",
          overflowX: "auto",
          overflowY: "hidden",
          WebkitOverflowScrolling: "touch",
          width: "100%",
          maxWidth: "400px",
          padding: ".25rem .25rem 0",
          borderBottom: "2px solid #f1c40f22",
          margin: ".25rem 0 .75rem",
        },
      },
      tabs.map((tab) =>
        e(
          "button",
          {
            key: tab.id,
            className: "tab-button",
            ref: setTabRef(tab.id),
            onPointerDown: (ev) => handleTabPointerDown(tab, ev),
            onDoubleClick: () => beginRenameTab(tab),
            onClick: () => setSelectedTabId(tab.id),
            onMouseMove: handleGlowMove,
            style: {
              flex: "0 0 auto",
              position: "relative",
              padding: ".5rem .95rem",
              borderTopLeftRadius: "10px",
              borderTopRightRadius: "10px",
              border:
                selectedTabId === tab.id
                  ? "2px solid #f1c40f"
                  : "2px solid #f1c40f55",
              borderBottom:
                selectedTabId === tab.id
                  ? "2px solid #0d0d0d"
                  : "2px solid #f1c40f22",
              background: selectedTabId === tab.id ? "#f1c40f" : "#0d0d0d",
              color: selectedTabId === tab.id ? "#0d0d0d" : "#f1c40f",
              marginBottom: selectedTabId === tab.id ? "-2px" : "0",
              boxShadow:
                selectedTabId === tab.id
                  ? "0 -2px 10px rgba(241,196,15,0.25)"
                  : "none",
              transform: draggingTabId === tab.id ? "scale(0.98)" : "none",
              opacity: draggingTabId === tab.id ? 0.9 : 1,
              cursor: "pointer",
              whiteSpace: "nowrap",
              userSelect: "none",
            },
            title: tab.name,
          },
          tab.name
        )
      ),
      e(
        "button",
        {
          className: "new-tab-button",
          onClick: createTab,
          onMouseMove: handleGlowMove,
          style: {
            flex: "0 0 auto",
            padding: ".5rem .85rem",
            borderTopLeftRadius: "10px",
            borderTopRightRadius: "10px",
            border: "2px dashed #f1c40f88",
            background: "#0d0d0d",
            color: "#f1c40f",
            whiteSpace: "nowrap",
            cursor: "pointer",
          },
          title: "New tab",
        },
        e("i", { className: "ph-bold ph-plus" }),
        " New tab"
      )
    ),

    // overlay do menu de long-press
    tabMenuTargetId &&
      e(
        "div",
        {
          style: { position: "fixed", inset: 0, zIndex: 9998 },
          onClick: () => setTabMenuTargetId(null),
        },
        e(
          "div",
          {
            style: {
              position: "absolute",
              top: tabMenuPos.y + window.scrollY,
              left: tabMenuPos.x,
              background: "#0d0d0d",
              border: "2px solid #f1c40f",
              borderRadius: "8px",
              padding: ".4rem",
              display: "flex",
              gap: ".35rem",
              boxShadow: "0 6px 18px rgba(0,0,0,.4)",
            },
            onClick: (ev) => ev.stopPropagation(),
          },
          e(
            "button",
            {
              className: "icon-button",
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
              className: "icon-button",
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
              className: "icon-button",
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

    // barra de adicionar tarefa
    e(
      "div",
      { className: "footer" },
      e("input", {
        value: title,
        maxLength: 200,
        onChange: (ev) => setTitle(ev.target.value),
        onKeyDown: (ev) => {
          if (ev.key === "Enter") addTask();
        },
        placeholder: "New task",
        style: { flexGrow: 1, boxSizing: "border-box", minWidth: 0 },
      }),
      e(
        "button",
        {
          onClick: addTask,
          title: "Add task",
          style: { fontSize: "1.25em", padding: ".4em" },
          disabled: !selectedTabId,
        },
        e("i", {
          className: "ph-bold ph-plus",
          style: { verticalAlign: "middle" },
        })
      )
    ),

    // lista de tarefas
    e(
      "ul",
      null,
      (Array.isArray(tasks) ? tasks : []).map((task) =>
        e(
          "li",
          {
            key: task.id,
            ref: setTaskRef(task.id),
            onPointerDown: (ev) => handleTaskPointerDown(task, ev),
            style: {
              display: "flex",
              alignItems: "center",
              width: "100%",
              padding: "2%",
              userSelect: isDraggingTasks ? "none" : "auto",
              touchAction: "none",
              cursor: isDraggingTasks ? "grabbing" : "grab",
            },
            title: "Drag to reorder",
          },
          // checkbox
          e(
            "div",
            { style: { display: "flex", justifyContent: "center" } },
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
                      {
                        viewBox: "0 0 24 24",
                        className: "neon-checkbox__check",
                      },
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
            )
          ),
          // título / edição inline
          e(
            "div",
            {
              style: {
                wordBreak: "break-word",
                width: "100%",
                paddingLeft: "10px",
                paddingRight: "10px",
              },
            },
            editingTaskId === task.id
              ? e(
                  "div",
                  { style: { display: "flex", gap: ".5rem", width: "100%" } },
                  e("input", {
                    type: "text",
                    value: editingTitle,
                    autoFocus: true,
                    onChange: (ev) => setEditingTitle(ev.target.value),
                    onBlur: () => setEditingTaskId(null),
                    onKeyDown: async (ev) => {
                      if (ev.key === "Enter") {
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
                      if (ev.key === "Escape") setEditingTaskId(null);
                    },
                    className: "auth-input",
                    style: { flexGrow: 1 },
                  }),
                  e(
                    "button",
                    {
                      onClick: async () => {
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
                      },
                      style: {
                        fontSize: "1.2em",
                        background: "#28a745",
                        color: "#fff",
                        border: "none",
                        borderRadius: "4px",
                        padding: ".5em",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      },
                    },
                    e("i", { className: "ph-bold ph-check-circle" })
                  )
                )
              : e(
                  "span",
                  {
                    style: {
                      textDecoration: task.done ? "line-through" : "none",
                      color: task.done ? "#888" : "#fff",
                      cursor: "pointer",
                    },
                    onClick: () => {
                      setEditingTaskId(task.id);
                      setEditingTitle(task.title);
                    },
                  },
                  task.title
                )
          ),
          // excluir
          e(
            "div",
            { style: { display: "flex", justifyContent: "center" } },
            e(
              "button",
              {
                onClick: () => deleteTask(task.id),
                title: "Delete",
                style: {
                  fontSize: "1.2em",
                  background: "#FFD700",
                  color: "#000",
                  border: "none",
                  borderRadius: "4px",
                  padding: ".5em",
                  cursor: "pointer",
                },
              },
              e("i", {
                className: "ph-bold ph-trash",
                style: { verticalAlign: "middle" },
              })
            )
          )
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
    e(UpgradesModal, { token, open: upgOpen, setOpen: setUpgOpen })
  );
}

ReactDOM.render(React.createElement(App), document.getElementById("root"));
