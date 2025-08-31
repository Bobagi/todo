// public/js/app/dragTabs.js
// DnD das abas (FLIP) + long-press com callback para abrir menu contextual.

export function useDragTabs(tabs, setTabs, submitTabOrder, options = {}) {
  const onLongPress = options.onLongPress || null;

  const [isDraggingTabs, setIsDraggingTabs] = React.useState(false);
  const [draggingTabId, setDraggingTabId] = React.useState(null);

  const tabElementRefs = React.useRef({});
  const longPressTimerRef = React.useRef(null);
  const pointerStartRef = React.useRef({ x: 0, y: 0 });
  const isDraggingTabsRef = React.useRef(false);
  const draggingTabIdRef = React.useRef(null);
  const tabsRef = React.useRef([]);

  React.useEffect(() => {
    tabsRef.current = Array.isArray(tabs) ? tabs : [];
  }, [tabs]);

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

  const handleTabPointerDown = (tab, ev) => {
    const px = ev.clientX ?? ev.touches?.[0]?.clientX ?? 0;
    const py = ev.clientY ?? ev.touches?.[0]?.clientY ?? 0;
    pointerStartRef.current = { x: px, y: py };

    clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      // disparo do menu no long-press
      if (typeof onLongPress === "function") {
        const el = tabElementRefs.current[tab.id];
        const r = el?.getBoundingClientRect();
        const pos = { x: r ? r.left : px, y: r ? r.bottom : py };
        onLongPress(tab, pos);
      }
      // cancela qualquer drag
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

  const handleTabPointerUp = async () => {
    clearTimeout(longPressTimerRef.current);
    window.removeEventListener("pointermove", handleTabPointerMove);
    window.removeEventListener("pointerup", handleTabPointerUp);

    if (isDraggingTabsRef.current && draggingTabIdRef.current != null) {
      try {
        await submitTabOrder(tabsRef.current);
      } catch {}
    }
    isDraggingTabsRef.current = false;
    setIsDraggingTabs(false);
    draggingTabIdRef.current = null;
    setDraggingTabId(null);
  };

  return { isDraggingTabs, draggingTabId, setTabRef, handleTabPointerDown };
}
