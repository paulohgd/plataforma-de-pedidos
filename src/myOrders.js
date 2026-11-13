import { fetchCheckoutSession } from "./pay";

const MAX = 20;

function storageKey(slug) {
  return `pedido-meus:${slug || ""}`;
}

function notifyOrders() {
  window.dispatchEvent(new Event("pedido-meus"));
}

export function readMyOrders(slug) {
  try {
    const rows = JSON.parse(localStorage.getItem(storageKey(slug)) || "[]");
    return Array.isArray(rows) ? rows.filter((row) => row && row.id) : [];
  } catch {
    return [];
  }
}

function saveMyOrders(slug, rows) {
  localStorage.setItem(storageKey(slug), JSON.stringify(rows.slice(0, MAX)));
  notifyOrders();
}

export function upsertMyOrder(slug, patch = {}) {
  const id = String(patch.id || "").trim();
  if (!slug || !id) return readMyOrders(slug);
  const rows = readMyOrders(slug);
  const index = rows.findIndex((row) => row.id === id);
  const current = index >= 0 ? rows[index] : {};
  const next = { ...current, ...patch, id };
  if (index >= 0) rows.splice(index, 1);
  rows.unshift(next);
  saveMyOrders(slug, rows);
  return rows;
}

export function myOrderStatus(row, now = Date.now()) {
  if (row?.status === "paid" || row?.paid) return "paid";
  if (row?.status === "canceled") return "canceled";
  if (row?.payment === "pix" && Number(row.expiresAt || 0) > 0 && Number(row.expiresAt) <= now) return "expired";
  return row?.status || "pending";
}

export function pendingOrderCount(slug, now = Date.now()) {
  return readMyOrders(slug).filter((row) => myOrderStatus(row, now) === "pending").length;
}

export async function refreshMyOrder(slug, id) {
  const sessionId = String(id || "").trim();
  if (!slug || !sessionId) return readMyOrders(slug);
  const { ok, payload } = await fetchCheckoutSession(sessionId);
  if (!ok || !payload) return readMyOrders(slug);
  const patch = { id: sessionId };
  if (payload.paid) patch.status = "paid";
  else if (payload.canceled) patch.status = "canceled";
  else patch.status = "pending";
  if (payload.shopName) patch.shopName = payload.shopName;
  if (payload.shopLogo) patch.shopLogo = payload.shopLogo;
  if (payload.payment) patch.payment = payload.payment;
  if (payload.pixCopy) patch.pixCopy = payload.pixCopy;
  if (payload.expiresAt) patch.expiresAt = Number(payload.expiresAt) || 0;
  if (payload.total != null) patch.total = Number(payload.total) || 0;
  if (Array.isArray(payload.items)) patch.items = payload.items;
  if (payload.createdAt) patch.createdAt = payload.createdAt;
  return upsertMyOrder(slug, patch);
}
