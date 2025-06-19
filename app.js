const e = React.createElement;

function App() {
  const [tasks, setTasks] = React.useState([]);
  const [title, setTitle] = React.useState('');

  const fetchTasks = async () => {
    const res = await fetch('/api/tasks');
    const data = await res.json();
    setTasks(data);
  };

  React.useEffect(() => { fetchTasks(); }, []);

  const addTask = async () => {
    await fetch('/api/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    });
    setTitle('');
    fetchTasks();
  };

  const deleteTask = async (id) => {
    await fetch('/api/tasks/' + id, { method: 'DELETE' });
    fetchTasks();
  };

  const toggleDone = async (task) => {
    await fetch('/api/tasks/' + task.id, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: !task.done })
    });
    fetchTasks();
  };

  return e('div', null,
    e('h1', null, 'Todo List'),
    e('input', {
      value: title,
      onChange: e => setTitle(e.target.value),
      placeholder: 'New task'
    }),
    e('button', { onClick: addTask }, 'Add'),
    e('ul', null,
      tasks.map(task =>
        e('li', { key: task.id },
          e('label', null,
            e('input', {
              type: 'checkbox',
              checked: task.done,
              onChange: () => toggleDone(task)
            }),
            ' ',
            task.title
          ),
          ' ',
          e('button', { onClick: () => deleteTask(task.id) }, 'x')
        )
      )
    )
  );
}

ReactDOM.render(e(App), document.getElementById('root'));

let deferredPrompt;
const installBtn = document.getElementById('install-btn');

window.addEventListener('beforeinstallprompt', e => {
  // e.preventDefault();
  deferredPrompt = e;
});

installBtn?.addEventListener('click', async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
});
