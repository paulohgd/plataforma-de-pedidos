export function money(value) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function saoPauloDayBounds(daysBack = 0) {
  const key = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const [year, month, day] = key.split("-").map(Number);
  const start = new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00-03:00`);
  start.setTime(start.getTime() - Math.max(0, daysBack) * 24 * 60 * 60 * 1000);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

export function norm(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function slugify(value) {
  const slug = norm(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "loja";
}

export function phoneDigits(value) {
  return nationalPhone(value);
}

export function nationalPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  digits = digits.replace(/^0+/, "");
  if (digits.startsWith("55") && digits.length >= 12) digits = digits.slice(2);
  return digits.slice(0, 11);
}

export function fullPhone(value) {
  const national = nationalPhone(value);
  if (national.length < 10) return "";
  return `55${national}`;
}

export function validPhone(value) {
  const national = nationalPhone(value);
  return national.length === 10 || national.length === 11;
}

export function formatPhone(value) {
  const national = nationalPhone(value);
  if (!national) return "";
  const ddd = national.slice(0, 2);
  const rest = national.slice(2);
  if (!rest) return ddd.length === 2 ? `(${ddd})` : national;
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  if (rest.length <= 8) return `(${ddd}) ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
  return `(${ddd}) ${rest.slice(0, 5)}-${rest.slice(5, 9)}`;
}

export function checkoutEmail(phone, orderId = "") {
  const orderKey = String(orderId || "").replace(/[^a-z0-9]/gi, "").slice(0, 32);
  if (orderKey) return `pedido.${orderKey}@cliente.pediaqui.dev.br`;
  const digits = String(phone || "").replace(/\D/g, "");
  const key = digits.length >= 10 ? digits.slice(-11) : "";
  return key ? `pedido.${key}@cliente.pediaqui.dev.br` : "";
}

export function validEmail(value) {
  const email = String(value || "").trim();
  return (
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) &&
    email.length <= 120 &&
    !/@cliente\.pediaqui\.dev\.br$/i.test(email) &&
    !/^pedido\.[0-9a-z]+@pediaqui\.dev\.br$/i.test(email)
  );
}

export function payerEmail(value, fallback = "") {
  const email = String(value || "").trim().toLowerCase();
  if (validEmail(email)) return email.slice(0, 120);
  const next = String(fallback || "").trim().toLowerCase();
  return validEmail(next) ? next.slice(0, 120) : "";
}

export function groupHint(group) {
  const max = group.max;
  const min = group.min || 0;
  const word = (count) => (count === 1 ? "item" : "itens");
  if (min > 0 && min === max) return `Escolha ${min} ${word(min)}`;
  if (min > 0) return `Escolha de ${min} a ${max} itens`;
  return `Escolha até ${max} ${word(max)}`;
}

export function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(Number(ms || 0) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
