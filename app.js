const e = React.createElement;

const TAB_NAME_MAX = 30; // limite de caracteres para nome de aba

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

  const authHeaders = token ? { Authorization: "Bearer " + token } : {};

  // drag state
  const [isDraggingTabs, setIsDraggingTabs] = React.useState(false);
  const [draggingTabId, setDraggingTabId] = React.useState(null);
  const tabElementRefs = React.useRef({});
  const longPressTimerRef = React.useRef(null);
  const pointerStartRef = React.useRef({ x: 0, y: 0 });
  const isDraggingTabsRef = React.useRef(false);
  const draggingTabIdRef = React.useRef(null);
  const tabsRef = React.useRef([]);
  const [tabMenuTargetId, setTabMenuTargetId] = React.useState(null);
  const [tabMenuPos, setTabMenuPos] = React.useState({ x: 0, y: 0 });

  // animação FLIP
  const setTabRef = (id) => (el) => {
    tabElementRefs.current[id] = el;
  };

  const runFlip = (beforeLeftById) => {
    requestAnimationFrame(() => {
      Object.keys(beforeLeftById).forEach((id) => {
        const el = tabElementRefs.current[id];
        if (!el) return;
        const afterLeft = el.getBoundingClientRect().left;
        const dx = beforeLeftById[id] - afterLeft;
        if (dx !== 0) {
          el.style.transition = "none";
          el.style.transform = `translateX(${dx}px)`;
          requestAnimationFrame(() => {
            el.style.transition = "transform 160ms ease";
            el.style.transform = "translateX(0)";
            setTimeout(() => {
              el.style.transition = "";
              el.style.transform = "";
            }, 190);
          });
        }
      });
    });
  };

  // monetização
  async function openCheckout(actionType, tabId) {
    const res = await fetch("/api/billing/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ actionType, tabId }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Payment error");
      return;
    }
    const data = await res.json();
    if (data.url) {
      window.location.href = data.url;
    }
  }

  // rename
  const beginRenameTab = async (tab) => {
    const current = tab.name || "";
    const newName = prompt(`Rename tab (max ${TAB_NAME_MAX} chars)`, current);
    if (!newName) return;
    const trimmed = newName.trim();
    if (!trimmed || trimmed === current) return;
    if (trimmed.length > TAB_NAME_MAX) {
      alert(`Tab name must be up to ${TAB_NAME_MAX} characters.`);
      return;
    }
    const res = await fetch(`/api/tabs/${tab.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ name: trimmed }),
    });
    if (res.ok) fetchTabs();
    else {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Rename failed");
    }
  };

  // drag handlers
  const handleTabPointerDown = (tab, e) => {
    const px = e.clientX ?? e.touches?.[0]?.clientX ?? 0;
    const py = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
    pointerStartRef.current = { x: px, y: py };
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      // abre menu
      const el = tabElementRefs.current[tab.id];
      const r = el?.getBoundingClientRect();
      setTabMenuTargetId(tab.id);
      setTabMenuPos({ x: r ? r.left : px, y: r ? r.bottom : py });
      draggingTabIdRef.current = null;
      setDraggingTabId(null);
      isDraggingTabsRef.current = false;
      setIsDraggingTabs(false);
      window.removeEventListener("pointermove", handleTabPointerMove);
      window.removeEventListener("pointerup", handleTabPointerUp);
    }, 600);
    draggingTabIdRef.current = tab.id;
    setDraggingTabId(tab.id);
    window.addEventListener("pointermove", handleTabPointerMove);
    window.addEventListener("pointerup", handleTabPointerUp);
  };

  const handleTabPointerMove = (e) => {
    const mx = e.clientX;
    const my = e.clientY;
    const dx = Math.abs(mx - pointerStartRef.current.x);
    const dy = Math.abs(my - pointerStartRef.current.y);
    if (dx > 8 || dy > 8) clearTimeout(longPressTimerRef.current);
    if (!isDraggingTabsRef.current) {
      if (dx > 6 || dy > 6) {
        isDraggingTabsRef.current = true;
        setIsDraggingTabs(true);
      } else {
        return;
      }
    }
    const currentTabs = tabsRef.current;
    const currentId = draggingTabIdRef.current;
    const currentIndex = currentTabs.findIndex((t) => t.id === currentId);
    if (currentIndex < 0) return;

    const beforeLeftById = {};
    currentTabs.forEach((t) => {
      const el = tabElementRefs.current[t.id];
      if (el) beforeLeftById[t.id] = el.getBoundingClientRect().left;
    });

    const centers = currentTabs.map((t) => {
      const el = tabElementRefs.current[t.id];
      if (!el) return Number.POSITIVE_INFINITY;
      const r = el.getBoundingClientRect();
      return r.left + r.width / 2;
    });
    let targetIndex = currentIndex;
    for (let i = 0; i < centers.length; i++) {
      if (mx < centers[i]) {
        targetIndex = i;
        break;
      }
      targetIndex = i;
    }
    if (targetIndex !== currentIndex) {
      const newTabs = currentTabs.slice();
      const [moved] = newTabs.splice(currentIndex, 1);
      newTabs.splice(targetIndex, 0, moved);
      setTabs(newTabs);
      runFlip(beforeLeftById);
    }
  };

  const submitTabOrder = async (newTabs) => {
    const orderedIds = newTabs.map((t) => t.id);
    const res = await fetch("/api/tabs/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ orderedIds }),
    });
    if (res.ok) {
      const data = await res.json();
      setTabs(data);
    }
  };

  const handleTabPointerUp = async () => {
    clearTimeout(longPressTimerRef.current);
    window.removeEventListener("pointermove", handleTabPointerMove);
    window.removeEventListener("pointerup", handleTabPointerUp);
    if (isDraggingTabsRef.current && draggingTabIdRef.current != null) {
      await submitTabOrder(tabsRef.current);
    }
    isDraggingTabsRef.current = false;
    setIsDraggingTabs(false);
    draggingTabIdRef.current = null;
    setDraggingTabId(null);
  };

  const handleTabDoubleClick = (tab) => beginRenameTab(tab);

  const handleGlowMove = (e) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  // API
  const fetchBillingConfig = async () => {
    try {
      const res = await fetch("/api/billing/config", { headers: authHeaders });
      if (res.ok) setBillingCfg(await res.json());
    } catch {}
  };

  const fetchTabs = async () => {
    if (!token) return;
    const res = await fetch("/api/tabs", { headers: authHeaders });
    if (res.status === 401) {
      setToken(null);
      localStorage.removeItem("token");
      return;
    }
    const data = await res.json();
    setTabs(data);
    if (!selectedTabId && data.length) setSelectedTabId(data[0].id);
  };

  const fetchTasks = async () => {
    if (!token) return;
    const queryString = selectedTabId ? `?tabId=${selectedTabId}` : "";
    const res = await fetch("/api/tasks" + queryString, {
      headers: authHeaders,
    });
    if (res.status === 401) {
      setToken(null);
      localStorage.removeItem("token");
      return;
    }
    const data = await res.json();
    setTasks(data);
  };

  React.useEffect(() => {
    if (!token) return;
    fetchBillingConfig();
    fetchTabs();
  }, [token]);

  React.useEffect(() => {
    if (!token) return;
    fetchTasks();
  }, [token, selectedTabId]);

  React.useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const deleteTab = async (tabId) => {
    const ok = confirm("Delete this tab and all its tasks?");
    if (!ok) return;
    const res = await fetch(`/api/tabs/${tabId}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error || "Could not delete tab.");
      return;
    }
    if (selectedTabId === tabId) setSelectedTabId(null);
    setTabMenuTargetId(null);
    await fetchTabs();
  };

  const addTask = async () => {
    if (!title.trim()) return;
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ title, tabId: selectedTabId }),
    });
    if (res.status === 402) {
      const n = billingCfg?.task_pack_size ?? 6;
      const go = confirm(
        `Task limit reached for this tab. Buy +${n} tasks (30 days)?`
      );
      if (go) await openCheckout("TASK_PACK", selectedTabId);
      return;
    }
    setTitle("");
    fetchTasks();
  };

  const deleteTask = async (id) => {
    await fetch("/api/tasks/" + id, { method: "DELETE", headers: authHeaders });
    fetchTasks();
  };

  const toggleDone = async (task) => {
    setTasks((prev) =>
      prev.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t))
    );
    try {
      await fetch(`/api/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ done: !task.done }),
      });
    } catch {
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, done: task.done } : t))
      );
    }
  };

  const handleAuth = async () => {
    const endpoint = isRegister ? "/api/register" : "/api/login";
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem("token", data.token);
      setToken(data.token);
      setUsername("");
      setPassword("");
    } else {
      alert(data.error || "Auth error");
    }
  };

  window.handleCredentialResponse = async (response) => {
    const res = await fetch("/api/google-login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken: response.credential }),
    });
    const data = await res.json();
    if (res.ok) {
      localStorage.setItem("token", data.token);
      setToken(data.token);
      fetchTabs();
    } else {
      alert(data.error || "Google auth error");
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    setToken(null);
    setTasks([]);
    setTabs([]);
    setSelectedTabId(null);
  };

  const createTab = async () => {
    let newTabName = prompt(`New tab name (max ${TAB_NAME_MAX} chars)`);
    if (!newTabName) return;
    newTabName = newTabName.trim().slice(0, TAB_NAME_MAX);
    if (!newTabName) return;
    const res = await fetch("/api/tabs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ name: newTabName }),
    });
    if (res.status === 402) {
      const go = confirm("Tab limit reached. Buy an additional tab (30 days)?");
      if (go) await openCheckout("TAB_SLOT");
      return;
    }
    if (res.ok) {
      await fetchTabs();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Error creating tab");
    }
  };

  // --- PWA: força atualização imediata ---
  React.useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js").then((reg) => {
        // força update check
        reg.update();

        // puxa o SW novo imediatamente
        if (reg.waiting) {
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        }
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (newWorker) {
            newWorker.addEventListener("statechange", () => {
              if (
                newWorker.state === "installed" &&
                navigator.serviceWorker.controller
              ) {
                newWorker.postMessage({ type: "SKIP_WAITING" });
              }
            });
          }
        });
      });

      // recarrega quando o novo SW assume o controle
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
      });
    }
  }, []);

  if (!token) {
    return e(
      "div",
      { style: { maxWidth: "400px", margin: "2rem auto" } },
      e("h2", null, isRegister ? "Create account" : "Login"),
      e("input", {
        placeholder: "Username",
        maxLength: 50,
        value: username,
        onChange: (e) => setUsername(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") handleAuth();
        },
        className: "auth-input",
      }),
      e("input", {
        type: "password",
        maxLength: 50,
        placeholder: "Password",
        value: password,
        onChange: (e) => setPassword(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") handleAuth();
        },
        className: "auth-input",
      }),
      isRegister &&
        e("input", {
          type: "password",
          placeholder: "Confirm password",
          value: confirmPassword,
          onChange: (e) => setConfirmPassword(e.target.value),
          onKeyDown: (e) => {
            if (e.key === "Enter") handleAuth();
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
    e(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "0.75rem" } },
      e("img", { src: "icon.png", alt: "Logo", style: { height: "1.8em" } }),
      e("h1", { style: { margin: 0 } }, "To do"),
      !window.matchMedia("(display-mode: standalone)").matches &&
        e(
          "button",
          {
            id: "install-btn",
            style: {
              marginLeft: "0.5rem",
              display: "flex",
              alignItems: "center",
              gap: "0.25rem",
            },
          },
          e("i", { className: "ph-bold ph-download-simple" }),
          "Install app"
        ),
      e(
        "button",
        {
          onClick: logout,
          style: { marginLeft: "auto", display: "flex", alignItems: "center" },
        },
        e("i", { className: "ph-bold ph-sign-out" })
      )
    ),
    e(
      "div",
      {
        className: "tabs-track",
        style: {
          display: "flex",
          alignItems: "flex-end",
          gap: "0.25rem",
          flexWrap: "nowrap",
          overflowX: "auto",
          WebkitOverflowScrolling: "touch",
          width: "100%",
          maxWidth: "400px",
          padding: "0.25rem 0.25rem 0",
          borderBottom: "2px solid #f1c40f22",
          margin: "0.25rem 0 0.75rem",
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
            onDoubleClick: () => handleTabDoubleClick(tab),
            onClick: () => setSelectedTabId(tab.id),
            onMouseMove: handleGlowMove,
            style: {
              flex: "0 0 auto",
              position: "relative",
              padding: "0.5rem 0.95rem",
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
          onClick: async () => {
            // tenta criar, se bater limite, oferece compra
            let newTabName = prompt(`New tab name (max ${TAB_NAME_MAX} chars)`);
            if (!newTabName) return;
            newTabName = newTabName.trim().slice(0, TAB_NAME_MAX);
            if (!newTabName) return;
            const res = await fetch("/api/tabs", {
              method: "POST",
              headers: { "Content-Type": "application/json", ...authHeaders },
              body: JSON.stringify({ name: newTabName }),
            });
            if (res.status === 402) {
              const go = confirm(
                "Tab limit reached. Buy an additional tab (30 days)?"
              );
              if (go) await openCheckout("TAB_SLOT");
              return;
            }
            if (res.ok) await fetchTabs();
            else {
              const d = await res.json().catch(() => ({}));
              alert(d.error || "Error creating tab");
            }
          },
          onMouseMove: handleGlowMove,
          style: {
            flex: "0 0 auto",
            padding: "0.5rem 0.85rem",
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
    tabMenuTargetId &&
      e(
        "div",
        {
          style: { position: "fixed", inset: 0, zIndex: 9999 },
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
              padding: "0.4rem",
              display: "flex",
              gap: "0.35rem",
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
              onClick: () => deleteTab(tabMenuTargetId),
            },
            e("i", { className: "ph-bold ph-trash" })
          ),
          e(
            "button",
            {
              className: "icon-button",
              title: `Buy +${billingCfg?.task_pack_size ?? 6} tasks`,
              onClick: () => {
                openCheckout("TASK_PACK", tabMenuTargetId);
                setTabMenuTargetId(null);
              },
            },
            e("i", { className: "ph-bold ph-plus-circle" })
          )
        )
      ),
    e(
      "div",
      { className: "footer" },
      e("input", {
        value: title,
        maxLength: 200,
        onChange: (e) => setTitle(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") addTask();
        },
        placeholder: "New task",
        style: { flexGrow: 1, boxSizing: "border-box", minWidth: 0 },
      }),
      e(
        "button",
        {
          onClick: addTask,
          title: "Add task",
          style: { fontSize: "1.25em", padding: "0.4em" },
          disabled: !selectedTabId,
        },
        e("i", {
          className: "ph-bold ph-plus",
          style: { verticalAlign: "middle" },
        })
      )
    ),
    e(
      "ul",
      null,
      tasks.map((task) =>
        e(
          "li",
          {
            key: task.id,
            style: {
              display: "flex",
              alignItems: "center",
              width: "100%",
              padding: "2%",
            },
          },
          e(
            "div",
            { style: { display: "flex", justifyContent: "center" } },
            e(
              "label",
              { className: "neon-checkbox" },
              e("input", {
                type: "checkbox",
                checked: task.done,
                onChange: () => toggleDone(task),
              }),
              e("div", { className: "neon-checkbox__frame" }, [
                e("div", { className: "neon-checkbox__box" }, [
                  e("div", { className: "neon-checkbox__check-container" }, [
                    e(
                      "svg",
                      {
                        viewBox: "0 0 24 24",
                        className: "neon-checkbox__check",
                      },
                      e("path", { d: "M3,12.5l7,7L21,5" })
                    ),
                  ]),
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
                  { style: { display: "flex", gap: "0.5rem", width: "100%" } },
                  e("input", {
                    type: "text",
                    value: editingTitle,
                    autoFocus: true,
                    onChange: (e) => setEditingTitle(e.target.value),
                    onBlur: () => setEditingTaskId(null),
                    onKeyDown: async (e) => {
                      if (e.key === "Enter") {
                        await fetch(`/api/tasks/${editingTaskId}`, {
                          method: "PUT",
                          headers: {
                            "Content-Type": "application/json",
                            ...authHeaders,
                          },
                          body: JSON.stringify({ title: editingTitle }),
                        });
                        setEditingTaskId(null);
                        fetchTasks();
                        return;
                      }
                      if (e.key === "Escape") setEditingTaskId(null);
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
                            ...authHeaders,
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
                        padding: "0.5em",
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
                  padding: "0.5em",
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
    )
  );
}

ReactDOM.render(e(App), document.getElementById("root"));

let deferredPrompt;
const installBtn = document.getElementById("install-btn");

if (window.matchMedia("(display-mode: standalone)").matches) {
  if (installBtn) installBtn.style.display = "none";
}

window.addEventListener("beforeinstallprompt", (e) => {
  deferredPrompt = e;
  if (installBtn) installBtn.style.display = "inline-block";
});

window.addEventListener("appinstalled", () => {
  if (installBtn) installBtn.style.display = "none";
});

installBtn?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  await deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.style.display = "none";
});
