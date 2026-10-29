export function authRedirectTo() {
  return `${window.location.origin}/acesso`;
}

export function readAuthCallbackError() {
  const hash = new URLSearchParams(String(window.location.hash || "").replace(/^#/, ""));
  const query = new URLSearchParams(window.location.search);
  const code = hash.get("error_code") || query.get("error_code") || "";
  const error = hash.get("error") || query.get("error") || "";
  const description = decodeURIComponent(
    hash.get("error_description") || query.get("error_description") || "",
  ).replace(/\+/g, " ");
  if (!error && !code) return "";
  if (code === "otp_expired" || /expired|invalid/i.test(description)) {
    return "Este link de confirmação já foi usado ou expirou. Peça outro e-mail ou entre se a conta já estiver confirmada.";
  }
  if (error === "access_denied") return "Não foi possível confirmar o e-mail com este link.";
  return "Não foi possível confirmar o e-mail.";
}

export function clearAuthCallbackUrl() {
  const url = new URL(window.location.href);
  const hadHash = Boolean(url.hash);
  url.hash = "";
  ["error", "error_code", "error_description", "sb"].forEach((key) => url.searchParams.delete(key));
  const next = `${url.pathname}${url.search}`;
  if (hadHash || next !== `${window.location.pathname}${window.location.search}`) {
    history.replaceState(history.state, "", next);
  }
}
