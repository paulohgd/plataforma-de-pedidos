const SESSION_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCheckoutSessionId(value) {
  const id = String(value || "").trim();
  return SESSION_RE.test(id) || /^ORD/i.test(id) || /^cs_[A-Za-z0-9]+$/.test(id);
}

function sessionKey(slug) {
  return `pedido-session:${slug || ""}`;
}

function parentKey(slug) {
  return `pedido-origem:${slug || ""}`;
}

export function rememberCheckoutSession(slug, sessionId) {
  if (isCheckoutSessionId(sessionId)) {
    sessionStorage.setItem(sessionKey(slug), String(sessionId).trim());
  }
}

export function rememberParentOrder(slug, orderId) {
  if (isCheckoutSessionId(orderId) && !/^ORD/i.test(String(orderId))) {
    sessionStorage.setItem(parentKey(slug), String(orderId).trim());
  }
}

export function readParentOrderId(slug) {
  const stored = sessionStorage.getItem(parentKey(slug)) || "";
  return isCheckoutSessionId(stored) && !/^ORD/i.test(stored) ? stored : "";
}

export function clearParentOrder(slug) {
  sessionStorage.removeItem(parentKey(slug));
}

export function readCheckoutSessionId(slug) {
  const fromUrl = new URLSearchParams(window.location.search).get("session_id") || "";
  if (isCheckoutSessionId(fromUrl)) {
    rememberCheckoutSession(slug, fromUrl);
    return fromUrl.trim();
  }
  const stored = sessionStorage.getItem(sessionKey(slug)) || "";
  return isCheckoutSessionId(stored) ? stored : "";
}

export async function fetchCheckoutSession(sessionId) {
  const response = await fetch("/api/checkout-session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  const payload = await response.json().catch(() => ({}));
  return { ok: response.ok, payload };
}
