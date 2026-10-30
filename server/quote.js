import { hydrateProducts } from "../src/menu.js";

export function quoteCart(store, payload) {
  const products = hydrateProducts(store.products || [], store.itemTypes);
  const byId = new Map(products.map((product) => [product.id, product]));
  const incoming = Array.isArray(payload.lines) ? payload.lines : [];
  if (incoming.length > 40) return { error: "O pedido tem itens demais." };
  const lines = [];

  for (const raw of incoming) {
    const product = byId.get(raw.productId);
    if (!product || product.active === false) return { error: "Um item da sacola não está disponível no cardápio." };
    const qty = Math.min(Math.max(Number(raw.qty) || 0, 0), 20);
    if (qty < 1) return { error: "Quantidade inválida." };

    const picked = {};
    const options = [];
    for (const option of raw.options || []) {
      const group = (product.groups || []).find((item) => item.id === option.groupId);
      const item = group?.items.find((entry) => entry.id === option.itemId);
      if (!group || !item) return { error: `Opção inválida em ${product.name}.` };
      const optionQty = Math.min(Math.max(Number(option.qty) || 0, 0), item.max || group.max || 1);
      if (!optionQty) continue;
      picked[group.id] = (picked[group.id] || 0) + optionQty;
      options.push({
        groupId: group.id,
        groupName: group.name,
        itemId: item.id,
        name: item.name,
        price: Number(item.price) || 0,
        qty: optionQty,
      });
    }

    for (const group of product.groups || []) {
      const count = picked[group.id] || 0;
      if (count < (group.min || 0) || count > group.max) {
        return { error: `Escolha as opções de ${product.name}.` };
      }
    }

    const unit = Number(product.price) + options.reduce((sum, option) => sum + option.price * option.qty, 0);
    lines.push({
      productId: product.id,
      name: product.name,
      qty,
      note: String(raw.note || "").slice(0, 200),
      options,
      unit,
      total: unit * qty,
      product: { id: product.id, name: product.name, price: product.price },
    });
  }

  if (!lines.length) return { error: "Adicione itens na sacola." };
  const total = Number(lines.reduce((sum, line) => sum + line.total, 0).toFixed(2));
  if (total < 0.5) return { error: "O pedido mínimo é R$ 0,50." };
  return { lines, total };
}

export function cents(value) {
  return Math.round(Number(value) * 100);
}
