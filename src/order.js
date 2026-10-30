import { formatPhone, money } from "./format.js";

export function shopWhatsapp(shop) {
  return String(shop?.whatsapp || "").replace(/\D/g, "");
}

function shortGroup(name) {
  if (name.startsWith("Aceita uma porção")) return "Porção";
  if (name.startsWith("Vai uma bebidinha")) return "Bebida";
  return name;
}

export function paymentMethodName(kind = "card") {
  if (kind === "pix") return "Pix";
  if (kind === "google_pay") return "Google Pay";
  return "cartão";
}

export function paymentKindFromStripe({ type = "", wallet = "" } = {}) {
  const method = String(type || "").toLowerCase();
  const walletType = String(wallet || "").toLowerCase();
  if (method === "pix") return "pix";
  if (walletType === "google_pay") return "google_pay";
  return "card";
}

export function withPaidPayment(text, kind = "card") {
  const line = `*Pagamento:* confirmado no ${paymentMethodName(kind)}`;
  const source = String(text || "");
  if (/\*Pagamento:\*/.test(source)) return source.replace(/\*Pagamento:\*.*/g, line);
  return `${source.trim()}\n${line}`;
}

export function buildOrderText({ shop, customer, lines, total, paid = false, payment = "card" }) {
  const out = [
    paid ? `*${shop.name} — pedido pago*` : `*${shop.name} — novo pedido*`,
    "",
    `*Cliente:* ${customer.name.trim()}`,
    `*WhatsApp:* ${formatPhone(customer.whatsapp) || customer.whatsapp || "-"}`,
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
  if (paid) out.push(`*Pagamento:* confirmado no ${paymentMethodName(payment)}`);

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
