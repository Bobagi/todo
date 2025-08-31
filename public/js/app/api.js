export const authHeaders = (token) =>
  token ? { Authorization: "Bearer " + token } : {};

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

export async function myEntitlements(token) {
  const r = await fetch("/api/billing/my-entitlements", {
    headers: authHeaders(token),
  });
  return r.json();
}
