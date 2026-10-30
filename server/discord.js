import { formatPhone } from "../src/format.js";

function toDiscordMarkdown(text) {
  return String(text || "")
    .replace(/\*([^*\n]+)\*/g, "**$1**")
    .replace(/_([^_\n]+)_/g, "*$1*");
}

function field(name, value, inline = true) {
  const text = String(value || "").trim() || "-";
  return { name, value: text.slice(0, 1024), inline };
}

function customerFields(order = {}) {
  const fields = [
    field("Cliente", order.customer_name),
    field("WhatsApp", formatPhone(order.customer_whatsapp) || order.customer_whatsapp),
    field("Tipo", order.customer_mode === "entrega" ? "Entrega" : "Retirada"),
  ];
  if (order.customer_mode === "entrega") {
    fields.push(field("Endereço", order.customer_address, false));
  }
  if (order.customer_notes) {
    fields.push(field("Observações", order.customer_notes, false));
  }
  return fields;
}

export async function sendShopDiscord(shop, text, webhookUrl = "", order = null) {
  const url = String(webhookUrl || "").trim();
  if (!url.startsWith("https://discord.com/api/webhooks/")) {
    return { sent: false, error: "Falta o webhook do Discord nas configurações da loja." };
  }
  if (!text) return { sent: false, error: "Pedido sem texto para enviar." };

  const customerName = String(order?.customer_name || "").trim();
  const phone = formatPhone(order?.customer_whatsapp) || order?.customer_whatsapp || "";
  const content = [customerName && `Pedido pago · ${customerName}`, phone].filter(Boolean).join(" · ") || "Pedido pago";

  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: String(shop?.name || "Pedi.ai").slice(0, 80),
      content: content.slice(0, 2000),
      embeds: [
        {
          title: "Pedido pago",
          description: toDiscordMarkdown(text).slice(0, 4096),
          color: 5763719,
          timestamp: new Date().toISOString(),
          fields: order ? customerFields(order) : [],
        },
      ],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    return { sent: false, error: body.slice(0, 300) || "O Discord recusou o envio." };
  }
  return { sent: true, error: "" };
}
