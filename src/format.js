export function money(value) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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

export function checkoutEmail(value) {
  const phone = fullPhone(value);
  return phone ? `${phone}@cliente.pediaqui.dev.br` : "";
}

export function groupHint(group) {
  const max = group.max;
  const min = group.min || 0;
  const word = (count) => (count === 1 ? "item" : "itens");
  if (min > 0 && min === max) return `Escolha ${min} ${word(min)}`;
  if (min > 0) return `Escolha de ${min} a ${max} itens`;
  return `Escolha até ${max} ${word(max)}`;
}
