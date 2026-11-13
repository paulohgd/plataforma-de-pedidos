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
    return sortMyOrders(Array.isArray(rows) ? rows.filter((row) => row && row.id) : []);
  } catch {
    return [];
  }
}

function saveMyOrders(slug, rows) {
  localStorage.setItem(storageKey(slug), JSON.stringify(rows.slice(0, MAX)));
  notifyOrders();
}

function orderTime(row) {
  const created = Date.parse(String(row?.createdAt || "")) || 0;
  return created || Number(row?.expiresAt || 0) || 0;
}

export function sortMyOrders(rows = []) {
  return rows
    .slice()
    .sort((a, b) => orderTime(b) - orderTime(a) || String(b.id || "").localeCompare(String(a.id || "")));
}

export function upsertMyOrder(slug, patch = {}) {
  const id = String(patch.id || "").trim();
  if (!slug || !id) return readMyOrders(slug);
  const rows = readMyOrders(slug);
  const index = rows.findIndex((row) => row.id === id);
  const current = index >= 0 ? rows[index] : {};
  const next = { ...current, ...patch, id };
  if (!next.createdAt) next.createdAt = current.createdAt || new Date().toISOString();
  if (next.status === "paid") {
    next.paid = true;
    next.expiresAt = 0;
  }
  if (index >= 0) {
    rows[index] = next;
  } else {
    rows.unshift(next);
  }
  saveMyOrders(slug, sortMyOrders(rows));
  return readMyOrders(slug);
}

const PIX_SOFT_MS = 5 * 60 * 1000;

export function orderExpiresAt(row) {
  const explicit = Number(row?.expiresAt || 0);
  if (explicit > 0) return explicit;
  if (row?.payment !== "pix") return 0;
  const created = Date.parse(String(row?.createdAt || "")) || 0;
  return created ? created + PIX_SOFT_MS : 0;
}

export function myOrderStatus(row, now = Date.now()) {
  if (row?.status === "paid" || row?.paid) return "paid";
  const expiresAt = orderExpiresAt(row);
  if (row?.payment === "pix" && expiresAt > 0 && expiresAt <= now) return "expired";
  if (row?.status === "canceled") return "canceled";
  if (row?.payment === "pix" && row?.pixCopy) return "pending";
  return row?.status || "pending";
}

export function pendingOrderCount(slug, now = Date.now()) {
  return readMyOrders(slug).filter((row) => {
    const status = myOrderStatus(row, now);
    return status === "pending" || status === "awaiting";
  }).length;
}

export async function refreshMyOrder(slug, id) {
  const sessionId = String(id || "").trim();
  if (!slug || !sessionId) return readMyOrders(slug);
  const { ok, payload } = await fetchCheckoutSession(sessionId);
  if (!ok || !payload) return readMyOrders(slug);
  const patch = { id: sessionId };
  if (payload.paid) {
    patch.status = "paid";
    patch.paid = true;
    patch.expiresAt = 0;
    patch.pixCopy = "";
  } else if (payload.canceled) {
    patch.status = "canceled";
  } else {
    patch.status = "pending";
  }
  if (payload.shopName) patch.shopName = payload.shopName;
  if (payload.shopLogo) patch.shopLogo = payload.shopLogo;
  if (payload.payment) patch.payment = payload.payment;
  if (!payload.paid) {
    if (payload.pixCopy) patch.pixCopy = payload.pixCopy;
    if (payload.expiresAt) patch.expiresAt = Number(payload.expiresAt) || 0;
  }
  if (payload.total != null) patch.total = Number(payload.total) || 0;
  if (Array.isArray(payload.items)) patch.items = payload.items;
  if (payload.createdAt) patch.createdAt = payload.createdAt;
  if (payload.parentOrderId) patch.parentOrderId = payload.parentOrderId;
  patch.paymentDuplicate = Boolean(payload.paymentDuplicate);
  if (payload.paymentDuplicateNote) patch.paymentDuplicateNote = payload.paymentDuplicateNote;
  return upsertMyOrder(slug, patch);
}
