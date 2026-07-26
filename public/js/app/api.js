export const authHeaders = (token) =>
  token ? { Authorization: "Bearer " + token } : {};

export async function forgotPassword(email, locale) {
  return fetch("/api/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, locale }),
  });
}

export async function resetPassword(token, password) {
  return fetch("/api/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token, password }),
  });
}

export async function fetchBillingConfig(token) {
  const r = await fetch("/api/billing/config", { headers: authHeaders(token) });
  return r.ok ? r.json() : null;
}

export async function fetchTabs(token) {
  const r = await fetch("/api/tabs", { headers: authHeaders(token) });
  if (r.status === 401) throw new Error("unauth");
  return r.json();
}

export async function fetchTasks(token, tabId) {
  const qs = tabId ? `?tabId=${tabId}` : "";
  const r = await fetch("/api/tasks" + qs, { headers: authHeaders(token) });
  if (r.status === 401) throw new Error("unauth");
  return r.json();
}

export async function addTask(token, title, tabId) {
  return fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ title, tabId }),
  });
}

export async function deleteTask(token, id) {
  return fetch(`/api/tasks/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export async function toggleTask(token, taskId, done) {
  return fetch(`/api/tasks/${taskId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ done }),
  });
}

export async function renameTab(token, id, name) {
  return fetch(`/api/tabs/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ name }),
  });
}

export async function deleteTab(token, id) {
  return fetch(`/api/tabs/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export async function capacity(token) {
  const r = await fetch("/api/tabs/capacity", { headers: authHeaders(token) });
  return r.json();
}

export async function createTab(token, name) {
  return fetch("/api/tabs", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ name }),
  });
}

export async function reorderTabs(token, orderedIds) {
  const r = await fetch("/api/tabs/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ orderedIds }),
  });
  return r.json();
}

export async function reorderTasks(token, tabId, orderedIds) {
  const r = await fetch("/api/tasks/reorder", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ orderedIds, tabId }),
  });
  return r.json();
}

export async function openCheckout(token, actionType, tabId) {
  const res = await fetch("/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
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

export async function fakeGrant(token, actionType, tabId) {
  const res = await fetch("/api/billing/fake-grant", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify({ actionType, tabId }),
  });
  return res;
}

/* ---- inventory: what's at which place ---------------------------------- */

export async function fetchInventory(token) {
  const r = await fetch("/api/inventory", { headers: authHeaders(token) });
  if (r.status === 401) throw new Error("unauth");
  return r.json();
}

const jsonPost = (token, url, body, method = "POST") =>
  fetch(url, {
    method,
    headers: { "Content-Type": "application/json", ...authHeaders(token) },
    body: JSON.stringify(body),
  });

export async function createLocation(token, name) {
  return jsonPost(token, "/api/inventory/locations", { name });
}

export async function renameLocation(token, id, name) {
  return jsonPost(token, `/api/inventory/locations/${id}`, { name }, "PUT");
}

export async function deleteLocation(token, id) {
  return fetch(`/api/inventory/locations/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

export async function addItem(token, item) {
  return jsonPost(token, "/api/inventory/items", item);
}

export async function updateItem(token, id, patch) {
  return jsonPost(token, `/api/inventory/items/${id}`, patch, "PUT");
}

export async function deleteItem(token, id) {
  return fetch(`/api/inventory/items/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

/** The central operation: relocate items and record it in the history. */
export async function moveItems(token, itemIds, toLocationId) {
  return jsonPost(token, "/api/inventory/move", { itemIds, toLocationId });
}

export async function fetchMoves(token, limit = 40) {
  const r = await fetch(`/api/inventory/moves?limit=${limit}`, {
    headers: authHeaders(token),
  });
  if (r.status === 401) throw new Error("unauth");
  return r.json();
}

export async function myEntitlements(token) {
  const r = await fetch("/api/billing/my-entitlements", {
    headers: authHeaders(token),
  });
  return r.json();
}
