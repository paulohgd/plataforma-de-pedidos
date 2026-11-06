import { formatPhone, money } from "./format.js";
import { formatKm } from "./freight.js";

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

export function buildOrderText({ shop, customer, lines, total, paid = false, payment = "card", delivery = null, coupon = null, discount = 0 }) {
  const out = [
    paid ? `*${shop.name} — pedido pago*` : `*${shop.name} — novo pedido*`,
    "",
    `*Cliente:* ${customer.name.trim()}`,
    `*WhatsApp:* ${formatPhone(customer.whatsapp) || customer.whatsapp || "-"}`,
    `*Tipo:* ${customer.mode === "entrega" ? "Entrega" : "Retirada"}`,
  ];

  if (customer.mode === "entrega") {
    out.push(`*Endereço:* ${customer.address.trim()}`);
    if (delivery && Number.isFinite(Number(delivery.km))) {
      out.push(`*Distância:* ${formatKm(delivery.km)}`);
      out.push(`*Entrega:* ${Number(delivery.fee) > 0 ? money(delivery.fee) : "grátis"}`);
    }
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

  if (coupon && discount > 0) {
    out.push(`*Cupom:* ${coupon.code} (−${coupon.percent}%)`);
    out.push(`*Desconto:* -${money(discount)}`);
  }

  out.push("", `*Total: ${money(total)}*`);
  if (paid) out.push(`*Pagamento:* confirmado no ${paymentMethodName(payment)}`);

  if (customer.notes?.trim()) {
    out.push("", `*Observações:* ${customer.notes.trim()}`);
  }

  return out.join("\n");
}

export function whatsappOrderUrl(shop, text) {
  const digits = shopWhatsapp(shop);
  if (digits.length < 12 || !String(text || "").trim()) return "";
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

export function openWhatsApp(shop, text) {
  const url = whatsappOrderUrl(shop, text);
  if (!url) return false;
  const opened = window.open(url, "_blank", "noopener,noreferrer");
  if (!opened) window.location.href = url;
  return true;
}
