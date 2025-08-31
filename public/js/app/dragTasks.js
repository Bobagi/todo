export function useDragTasks(tasks, setTasks, submitTaskOrder) {
  const [isDraggingTasks, setIsDraggingTasks] = React.useState(false);
  const [draggingTaskId, setDraggingTaskId] = React.useState(null);

  const taskElementRefs = React.useRef({});
  const isDraggingTasksRef = React.useRef(false);
  const draggingTaskIdRef = React.useRef(null);
  const tasksRef = React.useRef([]);
  const pointerStartRef = React.useRef({ x: 0, y: 0 });

  React.useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

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

  return { isDraggingTasks, draggingTaskId, setTaskRef, handleTaskPointerDown };
}
