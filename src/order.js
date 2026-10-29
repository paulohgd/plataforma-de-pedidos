import { money } from "./format";

export function shopWhatsapp(shop) {
  return String(shop?.whatsapp || "").replace(/\D/g, "");
}

function shortGroup(name) {
  if (name.startsWith("Aceita uma porção")) return "Porção";
  if (name.startsWith("Vai uma bebidinha")) return "Bebida";
  return name;
}

export function buildOrderText({ shop, customer, lines, total }) {
  const out = [
    `*${shop.name} — novo pedido*`,
    "",
    `*Cliente:* ${customer.name.trim()}`,
    `*Tipo:* ${customer.mode === "entrega" ? "Entrega" : "Retirada"}`,
  ];

  if (customer.mode === "entrega") {
    out.push(`*Endereço:* ${customer.address.trim()}`);
  }

  out.push("", "*Itens*");

  for (const line of lines) {
    out.push(`${line.qty}x ${line.product.name} — ${money(line.total)}`);
    for (const option of line.options) {
      const times = option.qty > 1 ? `${option.qty}x ` : "";
      out.push(`   • ${shortGroup(option.groupName)}: ${times}${option.name}`);
    }
    if (line.note) out.push(`   _Obs: ${line.note}_`);
  }

  out.push("", `*Total: ${money(total)}*`);

  if (customer.notes?.trim()) {
    out.push("", `*Observações:* ${customer.notes.trim()}`);
  }

  if (customer.mode === "entrega") {
    out.push("", "_A taxa de entrega é combinada nesta conversa._");
  }

  return out.join("\n");
}

export function openWhatsApp(shop, text) {
  const digits = shopWhatsapp(shop);
  if (digits.length < 12) return false;
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.href = url;
  return true;
}
