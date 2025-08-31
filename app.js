const e = React.createElement;
const TAB_NAME_MAX = 30;

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

  const authHeaders = token ? { Authorization: "Bearer " + token } : {};

  // drag state (abas)
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

  // drag state (tasks)
  const [isDraggingTasks, setIsDraggingTasks] = React.useState(false);
  const [draggingTaskId, setDraggingTaskId] = React.useState(null);
  const taskElementRefs = React.useRef({});
  const isDraggingTasksRef = React.useRef(false);
  const draggingTaskIdRef = React.useRef(null);
  const tasksRef = React.useRef([]);

  // foco no login
  const usernameRef = React.useRef(null);

  // FLIP abas
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

  // FLIP tasks
  const setTaskRef = (id) => (el) => {
    taskElementRefs.current[id] = el;
  };
  const runFlipY = (beforeTopById) => {
    requestAnimationFrame(() => {
      Object.keys(beforeTopById).forEach((id) => {
        const el = taskElementRefs.current[id];
        if (!el) return;
        const afterTop = el.getBoundingClientRect().top;
        const dy = beforeTopById[id] - afterTop;
        if (dy !== 0) {
          el.style.transition = "none";
          el.style.transform = `translateY(${dy}px)`;
          requestAnimationFrame(() => {
            el.style.transition = "transform 160ms ease";
            el.style.transform = "translateY(0)";
            setTimeout(() => {
              el.style.transition = "";
              el.style.transform = "";
            }, 190);
          });
        }
      });
    });
  };

  // Stripe
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
    const data = await res.json().catch(() => ({}));
    if (data.url) window.location.href = data.url;
  }
  async function fakeGrant(actionType, tabId) {
    const res = await fetch("/api/billing/fake-grant", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ actionType, tabId }),
    });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(d.error || "Not allowed");
      return;
    }
    // fecha loja e recarrega limites/abas
    setStoreOpen(false);
    await fetchTabs();
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

  // drag handlers (abas)
  const handleTabPointerDown = (tab, ev) => {
    const px = ev.clientX ?? ev.touches?.[0]?.clientX ?? 0;
    const py = ev.clientY ?? ev.touches?.[0]?.clientY ?? 0;
    pointerStartRef.current = { x: px, y: py };
    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
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
    const mx = e.clientX,
      my = e.clientY;
    const dx = Math.abs(mx - pointerStartRef.current.x);
    const dy = Math.abs(my - pointerStartRef.current.y);
    if (dx > 8 || dy > 8) clearTimeout(longPressTimerRef.current);
    if (!isDraggingTabsRef.current) {
      if (dx > 6 || dy > 6) {
        isDraggingTabsRef.current = true;
        setIsDraggingTabs(true);
      } else return;
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
      const data = await res.json().catch(() => []);
      setTabs(Array.isArray(data) ? data : []);
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

  const handleGlowMove = (e) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };

  // drag handlers (tasks)
  const handleTaskPointerDown = (task, ev) => {
    const py = ev.clientY ?? ev.touches?.[0]?.clientY ?? 0;
    pointerStartRef.current = { x: 0, y: py };
    draggingTaskIdRef.current = task.id;
    setDraggingTaskId(task.id);
    window.addEventListener("pointermove", handleTaskPointerMove, {
      passive: true,
    });
    window.addEventListener("pointerup", handleTaskPointerUp);
  };
  const handleTaskPointerMove = (e) => {
    const my = e.clientY;
    const dy = Math.abs(my - pointerStartRef.current.y);
    if (!isDraggingTasksRef.current) {
      if (dy > 6) {
        isDraggingTasksRef.current = true;
        setIsDraggingTasks(true);
      } else return;
    }
    const currentTasks = tasksRef.current;
    const currentId = draggingTaskIdRef.current;
    const currentIndex = currentTasks.findIndex((t) => t.id === currentId);
    if (currentIndex < 0) return;

    const beforeTopById = {};
    currentTasks.forEach((t) => {
      const el = taskElementRefs.current[t.id];
      if (el) beforeTopById[t.id] = el.getBoundingClientRect().top;
    });

    const centers = currentTasks.map((t) => {
      const el = taskElementRefs.current[t.id];
      if (!el) return Number.POSITIVE_INFINITY;
      const r = el.getBoundingClientRect();
      return r.top + r.height / 2;
    });

    let targetIndex = currentIndex;
    for (let i = 0; i < centers.length; i++) {
      if (my < centers[i]) {
        targetIndex = i;
        break;
      }
      targetIndex = i;
    }

    if (targetIndex !== currentIndex) {
      const newTasks = currentTasks.slice();
      const [moved] = newTasks.splice(currentIndex, 1);
      newTasks.splice(targetIndex, 0, moved);
      setTasks(newTasks);
      runFlipY(beforeTopById);
    }
  };
  const submitTaskOrder = async (newTasks) => {
    if (!selectedTabId) return;
    const orderedIds = newTasks.map((t) => t.id);
    const res = await fetch("/api/tasks/reorder", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ orderedIds, tabId: selectedTabId }),
    });
    if (res.ok) {
      const data = await res.json().catch(() => []);
      setTasks(Array.isArray(data) ? data : []);
    }
  };
  const handleTaskPointerUp = async () => {
    window.removeEventListener("pointermove", handleTaskPointerMove);
    window.removeEventListener("pointerup", handleTaskPointerUp);
    if (isDraggingTasksRef.current && draggingTaskIdRef.current != null) {
      await submitTaskOrder(tasksRef.current);
    }
    isDraggingTasksRef.current = false;
    setIsDraggingTasks(false);
    draggingTaskIdRef.current = null;
    setDraggingTaskId(null);
  };

  // API
  const fetchBillingConfig = async () => {
    try {
      const res = await fetch("/api/billing/config", { headers: authHeaders });
      if (res.ok) setBillingCfg(await res.json().catch(() => null));
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
    const data = await res.json().catch(() => []);
    const list = Array.isArray(data) ? data : [];
    setTabs(list);
    if (!selectedTabId && list.length) setSelectedTabId(list[0].id);
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
    const data = await res.json().catch(() => []);
    setTasks(Array.isArray(data) ? data : []);
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
  React.useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  // Autofocus no login/registro
  React.useEffect(() => {
    if (!token && usernameRef.current)
      setTimeout(() => usernameRef.current?.focus(), 0);
  }, [token, isRegister]);

  // trata retorno do Checkout (paid/canceled)
  React.useEffect(() => {
    if (!token) return;
    const url = new URL(window.location.href);
    const paid = url.searchParams.get("paid");
    const canceled = url.searchParams.get("canceled");
    if (paid === "1") {
      alert("Payment successful!");
      setStoreOpen(false);
      // recarrega dados
      fetchTabs();
      fetchTasks();
      // limpa query
      window.history.replaceState(null, "", url.pathname);
    } else if (canceled === "1") {
      window.history.replaceState(null, "", url.pathname);
    }
  }, [token]);

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
      // Abre a loja com contexto
      setStoreTaskPackTabId(selectedTabId);
      setStoreFocus("TASK_PACK");
      setStoreReason("TASK_LIMIT");
      setStoreOpen(true);
      return;
    }
    setTitle("");
    fetchTasks();
  };

  const deleteTask = async (id) => {
    const ok = confirm("Delete this task?");
    if (!ok) return;
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
    const data = await res.json().catch(() => ({}));
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
    const data = await res.json().catch(() => ({}));
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

  // criar aba com pré-checagem de capacidade
  const createTab = async () => {
    const cap = await fetch("/api/tabs/capacity", { headers: authHeaders })
      .then((r) => r.json())
      .catch(() => ({ canCreate: true }));
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
    const res = await fetch("/api/tabs", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ name: newTabName }),
    });
    if (res.status === 402) {
      setStoreFocus("TAB_SLOT");
      setStoreReason("TAB_LIMIT");
      setStoreOpen(true);
      return;
    }
    if (res.ok) {
      await fetchTabs();
    } else {
      const data = await res.json().catch(() => ({}));
      alert(data.error || "Error creating tab");
    }
  };

  // PWA update forçado
  React.useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js").then((reg) => {
        reg.update();
        if (reg.waiting) reg.waiting.postMessage({ type: "SKIP_WAITING" });
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          nw?.addEventListener("statechange", () => {
            if (
              nw.state === "installed" &&
              navigator.serviceWorker.controller
            ) {
              nw.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      });
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        window.location.reload();
      });
    }
  }, []);

  /* ---------- UI helpers ---------- */
  const fmtMoney = (cents, cur) =>
    `${(cents / 100).toLocaleString(undefined, {
      minimumFractionDigits: 2,
    })} ${String(cur).toUpperCase()}`;
  const addDays = (d, days) => new Date(d.getTime() + days * 86400000);
  const expiryDate = () =>
    addDays(
      new Date(),
      billingCfg?.entitlement_days ?? 30
    ).toLocaleDateString();

  const ReasonBanner = () => {
    let msg = null;
    if (storeReason === "TASK_LIMIT") {
      msg =
        "Parece que você estourou o limite de tarefas desta aba. Compre um pacote para liberar mais tarefas.";
    } else if (storeReason === "TAB_LIMIT") {
      msg =
        "Você atingiu o limite de abas da sua conta. Compre um slot adicional para criar novas abas.";
    }
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

  /* ---------- Modais ---------- */
  const selectedTab = tabs.find((t) => t.id === selectedTabId) || null;
  const storeSelectedTab =
    tabs.find((t) => t.id === (storeTaskPackTabId ?? selectedTabId)) || null;

  const Store = () =>
    e(
      "div",
      {
        style: {
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
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
            width: "min(760px, 96vw)",
            background: "#111",
            border: "2px solid #f1c40f",
            borderRadius: 12,
            padding: "1rem",
            color: "#fff",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
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
              title: "Pagamentos pelo Stripe (use cartão de teste 4242...).",
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

        // seleção da aba alvo (pacote de tarefas)
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
              style: {
                display: "flex",
                gap: 8,
                marginTop: 6,
                flexWrap: "wrap",
              },
            },
            e(
              "select",
              {
                value: storeTaskPackTabId ?? selectedTabId ?? "",
                onChange: (ev) =>
                  setStoreTaskPackTabId(Number(ev.target.value)),
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
            storeSelectedTab &&
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
                e("b", null, storeSelectedTab.name),
                " • Expira em ",
                e("b", null, expiryDate())
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
          // slot de aba
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
              e("b", null, expiryDate()),
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
                { onClick: () => openCheckout("TAB_SLOT"), style: { flex: 1 } },
                "Comprar"
              ),
              e(
                "button",
                {
                  className: "icon-button",
                  title: "DEV: conceder sem Stripe",
                  onClick: () => fakeGrant("TAB_SLOT"),
                },
                e("i", { className: "ph-bold ph-flask" })
              )
            ),
            e(
              Info,
              null,
              "Cada compra adiciona um slot de aba por ",
              e("b", null, `${billingCfg?.entitlement_days ?? 30} dias`),
              ". Se você já tem o número máximo permitido, compre mais um para liberar a criação."
            )
          ),
          // pacote de tarefas
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
              e("b", null, expiryDate()),
              "."
            ),
            e(
              "div",
              { style: { fontSize: 26, fontWeight: "bold" } },
              billingCfg
                ? fmtMoney(
                    billingCfg.task_pack_price_cents,
                    billingCfg.currency
                  )
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
                  onClick: () =>
                    fakeGrant("TASK_PACK", storeTaskPackTabId ?? selectedTabId),
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
          e("b", null, expiryDate()),
          "."
        )
      )
    );

  // modal “Meus Upgrades”
  const [upgOpen, setUpgOpen] = React.useState(false);
  const [upgList, setUpgList] = React.useState([]);
  const openUpgrades = async () => {
    const res = await fetch("/api/billing/my-entitlements", {
      headers: authHeaders,
    });
    const data = await res.json().catch(() => []);
    setUpgList(Array.isArray(data) ? data : []);
    setUpgOpen(true);
  };
  const UpgradesModal = () =>
    e(
      "div",
      {
        style: {
          position: "fixed",
          inset: 0,
          background: "rgba(0,0,0,0.6)",
          display: "grid",
          placeItems: "center",
          zIndex: 9999,
          padding: "1rem",
        },
        onClick: () => setUpgOpen(false),
      },
      e(
        "div",
        {
          onClick: (ev) => ev.stopPropagation(),
          style: {
            width: "min(720px, 96vw)",
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
              onClick: () => setUpgOpen(false),
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
          (upgList.length ? upgList : []).map((u) =>
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

  /* ---------- RENDER ---------- */
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
        autoComplete: isRegister ? "new-password" : "current-password",
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
          onClick: openUpgrades,
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
          overflowY: "hidden", // evita barra vertical
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
            onDoubleClick: () => beginRenameTab(tab),
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
          onClick: createTab,
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
    ),

    storeOpen && e(Store),
    upgOpen && e(UpgradesModal)
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
