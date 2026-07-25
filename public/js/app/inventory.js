// public/js/app/inventory.js
// Inventory — "which of my things are at which place".
//
// One item lives at exactly one place. Moving items is the central gesture:
// tick the ones going in the suitcase, tap the destination, done. Every move is
// written to the history, so "what did I take last time?" has an answer.
import {
  addItem as apiAddItem,
  createLocation as apiCreateLocation,
  deleteItem as apiDeleteItem,
  deleteLocation as apiDeleteLocation,
  fetchInventory,
  fetchMoves,
  moveItems,
  renameLocation as apiRenameLocation,
  updateItem as apiUpdateItem,
} from "./api.js";
import { t } from "./i18n.js";
import { e, handleGlowMove } from "./utils.js";

const ITEM_NAME_MAX = 80;
const PLACE_NAME_MAX = 40;
const NOTES_MAX = 200;
const QTY_MAX = 999;

const ALL = "all";
const UNKNOWN = "unknown";

/** "2 days ago" style, in the few steps that actually matter here. */
function whenText(iso) {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86400000);
  if (days <= 0) return t("inv.today");
  if (days === 1) return t("inv.yesterday");
  if (days < 30) return t("inv.daysAgo", { n: days });
  return then.toLocaleDateString();
}

export function InventoryView({ token, toast, askPrompt, askConfirm, onUnauth }) {
  const [data, setData] = React.useState(null);
  const [place, setPlace] = React.useState(ALL);
  const [sel, setSel] = React.useState(() => new Set());
  const [name, setName] = React.useState("");
  const [cat, setCat] = React.useState("top");
  const [editingId, setEditingId] = React.useState(null);
  const [draft, setDraft] = React.useState({ name: "", category: "other", qty: 1, notes: "" });
  const [placesOpen, setPlacesOpen] = React.useState(false);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [history, setHistory] = React.useState([]);

  const locations = data?.locations || [];
  const items = data?.items || [];
  const categories = data?.categories || [];

  const load = React.useCallback(async () => {
    const d = await fetchInventory(token).catch((err) => {
      if (err.message === "unauth") onUnauth?.();
      return null;
    });
    if (d) setData(d);
  }, [token, onUnauth]);

  React.useEffect(() => {
    load();
  }, [load]);

  // The API owns WHICH categories exist (key + icon); the label is translated
  // here, so a new language never needs a server change.
  const catOf = (key) => {
    const c = categories.find((x) => x.key === key);
    return { icon: c?.icon || "ph-package", label: c ? t("cat." + c.key) : "—" };
  };
  const placeName = (id) =>
    locations.find((l) => l.id === id)?.name || t("inv.unknownPlace");

  const countFor = (key) =>
    key === ALL
      ? items.length
      : key === UNKNOWN
      ? items.filter((i) => i.location_id === null).length
      : items.filter((i) => i.location_id === key).length;

  const shown = items.filter((i) =>
    place === ALL ? true : place === UNKNOWN ? i.location_id === null : i.location_id === place
  );

  function switchPlace(key) {
    setPlace(key);
    setSel(new Set()); // you can only move what you can see
    setEditingId(null);
  }

  function toggleSel(id) {
    setSel((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  // Select-all is scoped to what's on screen (the current place filter), because
  // you can only move what you can see — the same rule switchPlace enforces.
  const selectedShown = shown.reduce((n, i) => n + (sel.has(i.id) ? 1 : 0), 0);
  const allShownSelected = shown.length > 0 && selectedShown === shown.length;
  const someShownSelected = selectedShown > 0;

  function toggleSelectAll() {
    setSel((prev) => {
      const next = new Set(prev);
      if (allShownSelected) shown.forEach((i) => next.delete(i.id));
      else shown.forEach((i) => next.add(i.id));
      return next;
    });
  }

  // ---- actions -----------------------------------------------------------
  async function addNewItem() {
    const clean = name.trim();
    if (!clean) return;
    if (!locations.length) {
      toast(t("inv.placeFirst"), "error");
      return;
    }
    const locationId = typeof place === "number" ? place : locations[0].id;
    const res = await apiAddItem(token, { name: clean, category: cat, locationId });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || t("inv.errAdd"), "error");
      return;
    }
    setName("");
    load();
  }

  async function saveDraft() {
    const clean = draft.name.trim();
    if (!clean) {
      setEditingId(null);
      return;
    }
    const res = await apiUpdateItem(token, editingId, {
      name: clean,
      category: draft.category,
      qty: Number(draft.qty) || 1,
      notes: draft.notes.trim(),
    });
    setEditingId(null);
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || t("inv.errSave"), "error");
      return;
    }
    load();
  }

  async function removeItem(item) {
    const ok = await askConfirm(
      t("inv.deleteItemQ"),
      t("inv.deleteItemMsg", { name: item.name }),
      t("common.delete")
    );
    if (!ok) return;
    const res = await apiDeleteItem(token, item.id);
    if (!res.ok) {
      toast(t("inv.errDelete"), "error");
      return;
    }
    setSel((prev) => {
      const next = new Set(prev);
      next.delete(item.id);
      return next;
    });
    load();
  }

  async function moveSelected(toLocationId) {
    const ids = [...sel];
    if (!ids.length) return;
    const res = await moveItems(token, ids, toLocationId);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(d.error || t("inv.errMove"), "error");
      return;
    }
    setSel(new Set());
    await load();
    const place = placeName(toLocationId);
    toast(
      d.moved === 1
        ? t("inv.movedOne", { place })
        : d.moved
        ? t("inv.moved", { n: d.moved, place })
        : t("inv.alreadyThere")
    );
  }

  async function addPlace() {
    const n = await askPrompt(
      t("inv.newPlaceQ"),
      t("inv.newPlaceMsg", { max: PLACE_NAME_MAX }),
      "",
      PLACE_NAME_MAX
    );
    if (!n) return;
    const res = await apiCreateLocation(token, n.slice(0, PLACE_NAME_MAX));
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || t("inv.errCreatePlace"), "error");
      return;
    }
    load();
  }

  async function renamePlace(loc) {
    const n = await askPrompt(
      t("inv.renamePlace"),
      t("inv.renamePlaceMsg", { max: PLACE_NAME_MAX }),
      loc.name,
      PLACE_NAME_MAX
    );
    if (n == null) return;
    const trimmed = n.trim();
    if (!trimmed || trimmed === loc.name) return;
    const res = await apiRenameLocation(token, loc.id, trimmed.slice(0, PLACE_NAME_MAX));
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast(d.error || t("inv.errRenamePlace"), "error");
      return;
    }
    load();
  }

  async function removePlace(loc) {
    const n = countFor(loc.id);
    const ok = await askConfirm(
      t("inv.deletePlaceQ"),
      n === 0
        ? t("inv.deletePlaceEmpty", { name: loc.name })
        : n === 1
        ? t("inv.deletePlaceMsgOne", { name: loc.name })
        : t("inv.deletePlaceMsg", { name: loc.name, n }),
      t("inv.deletePlace")
    );
    if (!ok) return;
    const res = await apiDeleteLocation(token, loc.id);
    if (!res.ok) {
      toast(t("inv.errDeletePlace"), "error");
      return;
    }
    if (place === loc.id) switchPlace(ALL);
    load();
  }

  async function openHistory() {
    setHistoryOpen(true);
    const list = await fetchMoves(token).catch(() => []);
    setHistory(Array.isArray(list) ? list : []);
  }

  // ---- render ------------------------------------------------------------
  if (!data) return e("div", { className: "inv__loading" }, t("inv.loading"));

  // First run: no places yet, so nothing else makes sense on screen.
  if (!locations.length) {
    return e(
      "div",
      { className: "empty" },
      e("i", { className: "ph-bold ph-suitcase-rolling empty__mark" }),
      e("div", { className: "empty__title" }, t("inv.noPlaces")),
      e(
        "div",
        { className: "empty__hint" },
        t("inv.noPlacesHint")
      ),
      e(
        "button",
        { className: "btn btn--primary empty__cta", onClick: addPlace },
        e("i", { className: "ph-bold ph-plus" }),
        " " + t("inv.addPlace")
      )
    );
  }

  const chips = [
    { key: ALL, label: t("inv.all") },
    ...locations.map((l) => ({ key: l.id, label: l.name })),
  ];
  if (countFor(UNKNOWN)) chips.push({ key: UNKNOWN, label: t("inv.unknown") });

  return e(
    React.Fragment,
    null,

    // places
    e(
      "div",
      { className: "tabs-track" },
      chips.map((c) =>
        e(
          "button",
          {
            key: String(c.key),
            className: "tab" + (place === c.key ? " tab--active" : ""),
            onClick: () => switchPlace(c.key),
            title: c.label,
          },
          c.label,
          e("span", { className: "tab__count" }, countFor(c.key))
        )
      ),
      // Mirrors "New tab" on the tasks side — same affordance, same place.
      e(
        "button",
        {
          className: "tab tab--new",
          onClick: addPlace,
          onMouseMove: handleGlowMove,
          title: t("inv.newPlace"),
        },
        e("i", { className: "ph-bold ph-plus" }),
        " " + t("inv.newPlace")
      )
    ),

    // toolbar — "Places" lives here, not in the chip row: that row scrolls
    // horizontally, so a manage button at its end is off-screen exactly when
    // you have enough places to need it.
    e(
      "div",
      { className: "inv__bar" },
      e(
        "span",
        { className: "inv__hint" },
        place !== ALL
          ? t("inv.here", { n: shown.length })
          : items.length === 1
          ? t("inv.trackedOne")
          : t("inv.tracked", { n: items.length })
      ),
      e(
        "div",
        { className: "inv__bar-actions" },
        e(
          "button",
          {
            className: "iconbtn iconbtn--label",
            onClick: () => setPlacesOpen(true),
            title: t("inv.managePlaces"),
          },
          e("i", { className: "ph-bold ph-gear" }),
          e("span", { className: "label" }, t("inv.places"))
        ),
        e(
          "button",
          { className: "iconbtn iconbtn--label", onClick: openHistory, title: t("inv.historyTitle") },
          e("i", { className: "ph-bold ph-clock-counter-clockwise" }),
          e("span", { className: "label" }, t("inv.history"))
        )
      )
    ),

    // Select-all header: doubles as the discoverability cue (a labelled box that
    // teaches that the row boxes select) AND the bulk shortcut. Indeterminate
    // (a dash) when some — but not all — visible items are picked.
    shown.length >= 2
      ? e(
          "div",
          { className: "inv__selall" },
          e(
            "button",
            {
              type: "button",
              role: "checkbox",
              "aria-checked": allShownSelected
                ? "true"
                : someShownSelected
                ? "mixed"
                : "false",
              className: "inv-pick" + (someShownSelected ? " inv-pick--on" : ""),
              onClick: toggleSelectAll,
              "aria-label": t("inv.selectAll"),
            },
            allShownSelected
              ? e("i", { className: "ph-bold ph-check inv-pick__check" })
              : someShownSelected
              ? e("i", { className: "ph-bold ph-minus inv-pick__check" })
              : null
          ),
          e(
            "button",
            { className: "inv__selall-label", onClick: toggleSelectAll },
            t("inv.selectAll")
          )
        )
      : null,

    // Composer hides while selecting — you're moving, not adding. The move bar
    // (below) takes over the fixed bottom dock so it's ALWAYS visible, however
    // far down the list you ticked a box.
    !sel.size
      ? e(
          "div",
          { className: "composer" },
          e("input", {
            className: "composer__input",
            "aria-label": t("inv.newItemName"),
            value: name,
            maxLength: ITEM_NAME_MAX,
            onChange: (ev) => setName(ev.target.value),
            onKeyDown: (ev) => {
              if (ev.key === "Enter") addNewItem();
            },
            placeholder: t("inv.addItem"),
          }),
          e(
            "select",
            {
              className: "composer__select",
              value: cat,
              "aria-label": t("inv.categoryNew"),
              onChange: (ev) => setCat(ev.target.value),
              title: t("inv.category"),
            },
            categories.map((c) =>
              e("option", { key: c.key, value: c.key }, t("cat." + c.key))
            )
          ),
          e(
            "button",
            { onClick: addNewItem, title: t("inv.addItemTitle"), className: "btn btn--primary composer__add" },
            e("i", { className: "ph-bold ph-plus" })
          )
        )
      : e(
          "div",
          { className: "selbar" },
          e(
            "div",
            { className: "selbar__head" },
            e("span", { className: "selbar__count" }, t("inv.selected", { n: sel.size })),
            e(
              "button",
              {
                className: "iconbtn selbar__clear",
                onClick: () => setSel(new Set()),
                title: t("inv.clear"),
                "aria-label": t("inv.clear"),
              },
              e("i", { className: "ph-bold ph-x" })
            )
          ),
          e(
            "div",
            { className: "selbar__targets" },
            e("span", { className: "selbar__label" }, t("inv.moveTo")),
            locations.map((l) =>
              e(
                "button",
                {
                  key: l.id,
                  className: "btn btn--primary selbar__target",
                  onClick: () => moveSelected(l.id),
                },
                e("i", { className: "ph-bold ph-arrow-bend-up-right" }),
                " ",
                l.name
              )
            )
          )
        ),

    // list
    shown.length
      ? e(
          "ul",
          { className: "tasklist" },
          shown.map((item) => {
            const meta = catOf(item.category);
            const editing = editingId === item.id;
            return e(
              "li",
              { key: item.id, className: "task inv-item" + (sel.has(item.id) ? " inv-item--sel" : "") },
              // A real toggle button instead of a bare native checkbox: it reads
              // as a selection control (rounded box that fills gold + checks when
              // on), and the whole 40px square is the tap target.
              e(
                "button",
                {
                  type: "button",
                  role: "checkbox",
                  "aria-checked": sel.has(item.id),
                  className: "inv-pick" + (sel.has(item.id) ? " inv-pick--on" : ""),
                  onClick: () => toggleSel(item.id),
                  "aria-label": t("inv.select", { name: item.name }),
                },
                // Render the check ONLY when selected — never hidden with opacity,
                // which some mobile browsers still paint faintly.
                sel.has(item.id)
                  ? e("i", { className: "ph-bold ph-check inv-pick__check" })
                  : null
              ),
              e("i", {
                className: "ph-bold " + meta.icon + " inv-item__icon",
                title: meta.label,
              }),
              e(
                "div",
                { className: "task__body" },
                editing
                  ? e(
                      "div",
                      { className: "inv-edit" },
                      e(
                        "div",
                        { className: "inv-edit__row" },
                        e("input", {
                          type: "text",
                          autoFocus: true,
                          "aria-label": t("inv.itemName"),
                          value: draft.name,
                          maxLength: ITEM_NAME_MAX,
                          onChange: (ev) => setDraft({ ...draft, name: ev.target.value }),
                          onKeyDown: (ev) => {
                            if (ev.key === "Enter") saveDraft();
                            if (ev.key === "Escape") setEditingId(null);
                          },
                        }),
                        e(
                          "select",
                          {
                            value: draft.category,
                            "aria-label": t("inv.category"),
                            onChange: (ev) => setDraft({ ...draft, category: ev.target.value }),
                            title: t("inv.category"),
                          },
                          categories.map((c) =>
                            e("option", { key: c.key, value: c.key }, t("cat." + c.key))
                          )
                        ),
                        e("input", {
                          type: "number",
                          className: "inv-edit__qty",
                          "aria-label": t("inv.howMany"),
                          min: 1,
                          max: QTY_MAX,
                          value: draft.qty,
                          onChange: (ev) => setDraft({ ...draft, qty: ev.target.value }),
                          title: t("inv.howMany"),
                        }),
                        e(
                          "button",
                          {
                            className: "iconbtn",
                            title: t("common.save"),
                            onMouseDown: (ev) => ev.preventDefault(),
                            onClick: saveDraft,
                          },
                          e("i", { className: "ph-bold ph-check" })
                        )
                      ),
                      e("input", {
                        type: "text",
                        className: "inv-edit__notes",
                        "aria-label": t("inv.note"),
                        value: draft.notes,
                        maxLength: NOTES_MAX,
                        placeholder: t("inv.notePlaceholder"),
                        onChange: (ev) => setDraft({ ...draft, notes: ev.target.value }),
                        onKeyDown: (ev) => {
                          if (ev.key === "Enter") saveDraft();
                          if (ev.key === "Escape") setEditingId(null);
                        },
                      })
                    )
                  : e(
                      "div",
                      {
                        className: "inv-item__text",
                        onClick: () => {
                          setEditingId(item.id);
                          setDraft({
                            name: item.name,
                            category: item.category,
                            qty: item.qty,
                            notes: item.notes || "",
                          });
                        },
                      },
                      e(
                        "span",
                        { className: "task__title" },
                        item.name,
                        item.qty > 1 ? e("span", { className: "inv-item__qty" }, `×${item.qty}`) : null
                      ),
                      e(
                        "span",
                        { className: "inv-item__sub" },
                        place === ALL ? placeName(item.location_id) : null,
                        place === ALL && item.notes ? " · " : null,
                        item.notes || null
                      )
                    )
              ),
              e(
                "button",
                {
                  onClick: () => removeItem(item),
                  title: t("inv.deleteItem"),
                  className: "iconbtn iconbtn--danger",
                },
                e("i", { className: "ph-bold ph-trash" })
              )
            );
          })
        )
      : e(
          "div",
          { className: "empty" },
          e("i", { className: "ph-bold ph-suitcase-rolling empty__mark" }),
          e(
            "div",
            { className: "empty__title" },
            place === ALL ? t("inv.nothingTracked") : t("inv.nothingHere")
          ),
          e(
            "div",
            { className: "empty__hint" },
            place === ALL ? t("inv.nothingTrackedHint") : t("inv.nothingHereHint")
          )
        ),

    // Keeps the last row clear of the fixed move bar while selecting.
    sel.size ? e("div", { className: "inv__dock-spacer" }) : null,

    // places manager
    placesOpen
      ? e(
          "div",
          { className: "modal-backdrop", onClick: () => setPlacesOpen(false) },
          e(
            "div",
            { className: "modal", onClick: (ev) => ev.stopPropagation() },
            e("h3", { className: "modal__title" }, t("inv.places")),
            e(
              "p",
              { className: "modal__msg" },
              t("inv.placesSub")
            ),
            e(
              "ul",
              { className: "placelist" },
              locations.map((l) =>
                e(
                  "li",
                  { key: l.id, className: "placelist__row" },
                  e("span", { className: "placelist__name" }, l.name),
                  e("span", { className: "placelist__count" }, t("inv.itemCount", { n: countFor(l.id) })),
                  e(
                    "button",
                    { className: "iconbtn", title: t("inv.rename"), onClick: () => renamePlace(l) },
                    e("i", { className: "ph-bold ph-pencil-simple" })
                  ),
                  e(
                    "button",
                    {
                      className: "iconbtn iconbtn--danger",
                      title: t("common.delete"),
                      onClick: () => removePlace(l),
                    },
                    e("i", { className: "ph-bold ph-trash" })
                  )
                )
              )
            ),
            e(
              "div",
              { className: "modal__actions" },
              e("button", { className: "btn btn--ghost", onClick: () => setPlacesOpen(false) }, t("common.close")),
              e(
                "button",
                { className: "btn btn--primary", onClick: addPlace },
                e("i", { className: "ph-bold ph-plus" }),
                " " + t("inv.addPlace")
              )
            )
          )
        )
      : null,

    // history
    historyOpen
      ? e(
          "div",
          { className: "modal-backdrop", onClick: () => setHistoryOpen(false) },
          e(
            "div",
            { className: "modal", onClick: (ev) => ev.stopPropagation() },
            e("h3", { className: "modal__title" }, t("inv.historyTitle")),
            history.length
              ? e(
                  "ul",
                  { className: "histlist" },
                  history.map((h) =>
                    e(
                      "li",
                      { key: h.id, className: "histlist__row" },
                      e("span", { className: "histlist__item" }, h.item_name),
                      e(
                        "span",
                        { className: "histlist__move" },
                        h.from_name || t("inv.unknown"),
                        e("i", { className: "ph-bold ph-arrow-right" }),
                        h.to_name || t("inv.unknown")
                      ),
                      e("span", { className: "histlist__when" }, whenText(h.moved_at))
                    )
                  )
                )
              : e("p", { className: "modal__msg" }, t("inv.noMoves")),
            e(
              "div",
              { className: "modal__actions" },
              e("button", { className: "btn btn--ghost", onClick: () => setHistoryOpen(false) }, t("common.close"))
            )
          )
        )
      : null
  );
}
