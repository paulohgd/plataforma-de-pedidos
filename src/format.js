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

export function groupHint(group) {
  const max = group.max;
  const min = group.min || 0;
  const word = (count) => (count === 1 ? "item" : "itens");
  if (min > 0 && min === max) return `Escolha ${min} ${word(min)}`;
  if (min > 0) return `Escolha de ${min} a ${max} itens`;
  return `Escolha até ${max} ${word(max)}`;
}
