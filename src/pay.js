export function checkoutSessionId(clientSecret) {
  const text = String(clientSecret || "");
  const at = text.indexOf("_secret_");
  const id = at > 0 ? text.slice(0, at) : "";
  return id.startsWith("cs_") ? id : "";
}

function sessionKey(slug) {
  return `pedido-session:${slug || ""}`;
}

export function rememberCheckoutSession(slug, sessionId) {
  if (String(sessionId || "").startsWith("cs_")) {
    sessionStorage.setItem(sessionKey(slug), sessionId);
  }
}

export function readCheckoutSessionId(slug) {
  const fromUrl = new URLSearchParams(window.location.search).get("session_id") || "";
  if (fromUrl.startsWith("cs_")) {
    rememberCheckoutSession(slug, fromUrl);
    return fromUrl;
  }
  const stored = sessionStorage.getItem(sessionKey(slug)) || "";
  return stored.startsWith("cs_") ? stored : "";
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
