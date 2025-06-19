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
    e("h1", null, "Todo List"),
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

// Esconde o botão se já está em modo standalone
if (window.matchMedia("(display-mode: standalone)").matches) {
  installBtn.style.display = "none";
}

window.addEventListener("beforeinstallprompt", (e) => {
  deferredPrompt = e;
  installBtn.style.display = "inline-block"; // Garante que o botão apareça se permitido
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
