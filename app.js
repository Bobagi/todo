const e = React.createElement;

function App() {
  const [tasks, setTasks] = React.useState([]);
  const [title, setTitle] = React.useState("");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [token, setToken] = React.useState(localStorage.getItem("token"));
  const [isRegister, setIsRegister] = React.useState(false);

  const authHeaders = token ? { Authorization: "Bearer " + token } : {};

  const fetchTasks = async () => {
    if (!token) return;
    const res = await fetch("/api/tasks", { headers: authHeaders });
    if (res.status === 401) {
      setToken(null);
      localStorage.removeItem("token");
      return;
    }
    const data = await res.json();
    setTasks(data);
  };

  React.useEffect(() => {
    fetchTasks();
  }, [token]);

  const addTask = async () => {
    if (!title.trim()) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders },
      body: JSON.stringify({ title }),
    });
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
      fetchTasks();
    } else {
      alert(data.error || "Google auth error");
    }
  };

  const logout = () => {
    localStorage.removeItem("token");
    setToken(null);
    setTasks([]);
  };

  if (!token) {
    return e(
      "div",
      { style: { maxWidth: "400px", margin: "2rem auto" } },
      e("h2", null, isRegister ? "Register" : "Login"),
      e("input", {
        placeholder: "Username",
        value: username,
        onChange: (e) => setUsername(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") {
            console.log("Auth triggered by Enter");
            handleAuth();
          }
        },
        className: "auth-input",
      }),
      e("input", {
        type: "password",
        placeholder: "Password",
        value: password,
        onChange: (e) => setPassword(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") {
            console.log("Auth triggered by Enter");
            handleAuth();
          }
        },
        className: "auth-input",
      }),
      e(
        "button",
        { onClick: handleAuth, className: "auth-button" },
        isRegister ? "Register" : "Login"
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
          { id: "install-btn", style: { marginLeft: "0.5rem" } },
          "Install app"
        ),
      e("button", { onClick: logout, style: { marginLeft: "auto" } }, "Logout")
    ),
    e(
      "div",
      {
        style: {
          color: "#888",
          fontSize: "0.9em",
          marginTop: "0.25rem",
          marginBottom: "0.75rem",
        },
      },
      "Organize. Simplify. Dominate."
    ),
    e(
      "div",
      {
        className: "footer",
      },
      e("input", {
        value: title,
        onChange: (e) => setTitle(e.target.value),
        onKeyDown: (e) => {
          if (e.key === "Enter") {
            console.log("Adding task via Enter");
            addTask();
          }
        },
        placeholder: "New task",
        style: {
          flexGrow: 1,
          boxSizing: "border-box",
          minWidth: 0,
        },
      }),
      e(
        "button",
        {
          onClick: addTask,
          title: "Add task",
          style: { fontSize: "1.25em", padding: "0.4em" },
        },
        e("i", { className: "ph-bold ph-plus" })
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
            {
              style: {
                display: "flex",
                justifyContent: "center",
              },
            },
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
            e(
              "span",
              {
                style: {
                  textDecoration: task.done ? "line-through" : "none",
                  color: task.done ? "#888" : "#fff",
                },
              },
              task.title
            )
          ),
          e(
            "div",
            {
              style: {
                display: "flex",
                justifyContent: "center",
              },
            },
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
              e("i", { className: "ph-bold ph-trash" })
            )
          )
        )
      )
    )
  );
}

ReactDOM.render(e(App), document.getElementById("root"));

// PWA install logic
let deferredPrompt;
const installBtn = document.getElementById("install-btn");

if (window.matchMedia("(display-mode: standalone)").matches) {
  installBtn.style.display = "none";
}

window.addEventListener("beforeinstallprompt", (e) => {
  deferredPrompt = e;
  installBtn.style.display = "inline-block";
});

window.addEventListener("appinstalled", () => {
  installBtn.style.display = "none";
});

installBtn?.addEventListener("click", async () => {
  if (!deferredPrompt) return;
  await deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
  installBtn.style.display = "none";
});
