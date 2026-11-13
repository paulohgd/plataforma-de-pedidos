export function normalizePaymentMethod(value) {
  const method = String(value || "").trim().toLowerCase();
  if (method === "pix" || method === "card") return method;
  return "";
}

export function canLockPaymentMethod(current, next) {
  const from = normalizePaymentMethod(current);
  const to = normalizePaymentMethod(next);
  if (!to) return { ok: false, error: "Informe o método de pagamento." };
  if (!from) return { ok: true, method: to };
  if (from === to) return { ok: true, method: to };
  return {
    ok: false,
    error:
      from === "pix"
        ? "Este pedido já está no Pix. Para pagar com cartão, inicie um novo pedido."
        : "Este pedido já está no cartão. Para pagar com Pix, inicie um novo pedido.",
  };
}

export function relatedOrderIds(order, rows = []) {
  const id = String(order?.id || "").trim();
  if (!id) return [];
  const parent = String(order?.parent_order_id || "").trim();
  const related = new Set([id]);
  if (parent) related.add(parent);
  for (const row of rows) {
    const rowId = String(row?.id || "").trim();
    const rowParent = String(row?.parent_order_id || "").trim();
    if (!rowId) continue;
    if (rowId === parent || rowParent === id || (parent && rowParent === parent)) related.add(rowId);
  }
  return [...related];
}

export function findDuplicatePaid(order, rows = []) {
  const id = String(order?.id || "").trim();
  if (!id || order?.status !== "paid") return null;
  const related = relatedOrderIds(order, rows);
  return (
    rows.find((row) => {
      const rowId = String(row?.id || "").trim();
      return rowId && rowId !== id && related.includes(rowId) && row.status === "paid";
    }) || null
  );
}
