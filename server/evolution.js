import { fullPhone } from "../src/format.js";

function evolutionConfig() {
  const url = String(process.env.EVOLUTION_API_URL || "").trim().replace(/\/$/, "");
  const key = String(process.env.EVOLUTION_API_KEY || "").trim();
  const instance = String(process.env.EVOLUTION_INSTANCE || "pediaqui").trim();
  return { url, key, instance, ready: Boolean(url && key && instance) };
}

function errorText(payload, status) {
  if (!payload || typeof payload !== "object") return `Evolution ${status}`;
  const nested = payload.error && typeof payload.error === "object" ? payload.error.message : payload.error;
  return String(
    payload.message || nested || payload.response?.message || payload.response?.error || `Evolution ${status}`,
  ).slice(0, 300);
}

export async function sendShopWhatsApp(shop, text, toNumber = "") {
  const { url, key, instance, ready } = evolutionConfig();
  if (!ready) return { sent: false, error: "Falta configurar a Evolution API no servidor." };
  const number = fullPhone(toNumber || shop?.whatsapp);
  if (!number) return { sent: false, error: "A loja não tem WhatsApp cadastrado." };
  if (!text) return { sent: false, error: "Pedido sem texto para enviar." };

  try {
    const response = await fetch(`${url}/message/sendText/${encodeURIComponent(instance)}`, {
      method: "POST",
      headers: {
        apikey: key,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        number,
        text,
        textMessage: { text },
        linkPreview: false,
      }),
      signal: AbortSignal.timeout(20000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return { sent: false, error: errorText(payload, response.status) };
    return { sent: true, error: "" };
  } catch (error) {
    return { sent: false, error: String(error.message || error).slice(0, 300) };
  }
}
