const e = React.createElement;

function App() {
  const [tasks, setTasks] = React.useState([]);
  const [title, setTitle] = React.useState([]);

  const fetchTasks = async () => {
    const res = await fetch("/api/tasks");
    const data = await res.json();
    setTasks(data);
  };

  React.useEffect(() => {
    fetchTasks();
  }, []);

  const addTask = async () => {
    if (!title.trim()) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setTitle("");
    fetchTasks();
  };

  const deleteTask = async (id) => {
    await fetch("/api/tasks/" + id, { method: "DELETE" });
    fetchTasks();
  };

  const toggleDone = async (task) => {
    await fetch("/api/tasks/" + task.id, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: !task.done }),
    });
    fetchTasks();
  };

  return e(
    "div",
    null,
    e(
      "div",
      { style: { display: "flex", alignItems: "center", gap: "0.75rem" } },
      e("img", {
        src: "icon.png",
        alt: "Logo",
        style: { height: "1.8em" },
      }),
      e("h1", { style: { margin: 0 } }, "TaskFlow"),
      !window.matchMedia("(display-mode: standalone)").matches &&
        e(
          "button",
          { id: "install-btn", style: { marginLeft: "auto" } },
          "Install app"
        )
    ),
    e(
      "div",
      {
        style: {
          color: "#888",
          fontSize: "0.9em",
          marginTop: "0.25rem",
          marginBottom: "0.75rem",
          justifySelf: "center",
        },
      },
      "Organize. Simplify. Dominate."
    ),
    e("input", {
      value: title,
      onChange: (e) => setTitle(e.target.value),
      placeholder: "New task",
    }),
    e("button", { onClick: addTask }, "Add"),
    e(
      "ul",
      null,
      tasks.map((task) =>
        e(
          "li",
          { key: task.id },
          e(
            "label",
            null,
            e("input", {
              type: "checkbox",
              checked: task.done,
              onChange: () => toggleDone(task),
            }),
            " ",
            e("span", null, task.title)
          ),
          " ",
          e("button", { onClick: () => deleteTask(task.id) }, "x")
        )
      )
    )
  );
}

ReactDOM.render(e(App), document.getElementById("root"));

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
