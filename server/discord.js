function toDiscordMarkdown(text) {
  return String(text || "")
    .replace(/\*([^*\n]+)\*/g, "**$1**")
    .replace(/_([^_\n]+)_/g, "*$1*");
}

export async function sendShopDiscord(shop, text) {
  const url = process.env.DISCORD_WEBHOOK_URL || "";
  if (!url.startsWith("https://discord.com/api/webhooks/")) {
    return { sent: false, error: "Falta configurar DISCORD_WEBHOOK_URL no .env.server." };
  }
  if (!text) return { sent: false, error: "Pedido sem texto para enviar." };

  const response = await fetch(`${url}${url.includes("?") ? "&" : "?"}wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: String(shop?.name || "Pedi.ai").slice(0, 80),
      content: "Pedido pago",
      embeds: [
        {
          title: "Pedido pago",
          description: toDiscordMarkdown(text).slice(0, 4096),
          color: 5763719,
          timestamp: new Date().toISOString(),
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
