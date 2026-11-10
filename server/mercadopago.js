import { randomUUID } from "node:crypto";

const API = "https://api.mercadopago.com";
export const PIX_MS = 5 * 60 * 1000;

export function moneyAmount(value) {
  return Number(value || 0).toFixed(2);
}

export function firstPayment(order) {
  return order?.transactions?.payments?.[0] || null;
}

function paidStatus(value) {
  const status = String(value || "").toLowerCase();
  return ["processed", "approved", "accredited", "paid"].includes(status);
}

function waitingStatus(value) {
  const status = String(value || "").toLowerCase();
  return [
    "action_required",
    "pending",
    "created",
    "waiting_transfer",
    "waiting_payment",
    "pending_waiting_transfer",
    "pending_waiting_payment",
  ].includes(status);
}

export function mpOrderPaid(order) {
  if (!order) return false;
  const payment = firstPayment(order);
  const statuses = [order.status, order.status_detail, payment?.status, payment?.status_detail];
  if (statuses.some(waitingStatus) || statuses.some(closedStatus)) return false;
  if (statuses.some(paidStatus)) return true;
  return Boolean(order.paid_at || payment?.paid_at || payment?.date_approved);
}

function closedStatus(value) {
  const status = String(value || "").toLowerCase();
  return ["canceled", "cancelled", "expired", "failed", "rejected"].includes(status);
}

export function mpOrderClosed(order) {
  const payment = firstPayment(order);
  return (
    closedStatus(order?.status) ||
    closedStatus(order?.status_detail) ||
    closedStatus(payment?.status) ||
    closedStatus(payment?.status_detail)
  );
}

export function paymentKindFromOrder(order) {
  const payment = firstPayment(order) || {};
  const type = String(payment.payment_method?.type || "").toLowerCase();
  const id = String(payment.payment_method?.id || "").toLowerCase();
  if (id === "pix" || type === "bank_transfer") return "pix";
  return "card";
}

export function pixFromOrder(order) {
  if (mpOrderPaid(order)) return { paid: true, pixCopy: "", expiresAt: 0 };
  const method = firstPayment(order)?.payment_method || {};
  const copy = String(method.qr_code || "").trim();
  const created = Date.parse(order?.created_date || order?.date_created || "") || 0;
  const expiresAt = created ? created + PIX_MS : 0;
  return { paid: false, pixCopy: copy, expiresAt };
}

export function mpPhone(whatsapp) {
  const digits = String(whatsapp || "").replace(/\D/g, "");
  const national = digits.startsWith("55") && digits.length >= 12 ? digits.slice(2) : digits;
  if (national.length < 10) return null;
  return { area_code: national.slice(0, 2), number: national.slice(2) };
}

function errorText(payload, status) {
  if (!payload || typeof payload !== "object") return `Mercado Pago ${status}`;
  const first = Array.isArray(payload.errors) ? payload.errors[0] : null;
  return String(first?.message || payload.message || payload.error || payload.cause?.[0]?.description || `Mercado Pago ${status}`);
}

export function mpPublicError(error, fallback = "Não foi possível concluir o pagamento.") {
  const message = String(error?.message || error || "");
  if (/401|unauthorized|invalid.?access|invalid.?token/i.test(message)) {
    return "As chaves do Mercado Pago desta loja estão inválidas.";
  }
  if (/pix/i.test(message) && /key|chave|not.?found|não encontr/i.test(message)) {
    return "Esta loja ainda não tem Pix cadastrado no Mercado Pago.";
  }
  if (/token/i.test(message) && /invalid|expired|used/i.test(message)) {
    return "Não foi possível processar o cartão. Confira os dados.";
  }
  if (/card|bin|security.?code|cvv|expiration/i.test(message)) {
    return "Não foi possível processar o cartão. Confira os dados.";
  }
  if (/insufficient|high.?risk|rejected|refused/i.test(message)) {
    return "O pagamento foi recusado. Tente outro cartão ou Pix.";
  }
  return fallback;
}

export async function mpFetch(accessToken, { method = "GET", path, body, idempotencyKey } = {}) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Accept: "application/json",
  };
  if (body) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["X-Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(errorText(payload, response.status));
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function createMpOrder(accessToken, body, idempotencyKey = randomUUID()) {
  return mpFetch(accessToken, {
    method: "POST",
    path: "/v1/orders",
    body,
    idempotencyKey,
  });
}

export async function getMpOrder(accessToken, id) {
  return mpFetch(accessToken, { path: `/v1/orders/${encodeURIComponent(id)}` });
}

export async function searchMpOrderByRef(accessToken, externalReference) {
  const ref = String(externalReference || "").trim();
  if (!ref) return null;
  const end = new Date(Date.now() + 60 * 1000);
  const begin = new Date(end.getTime() - 3 * 24 * 60 * 60 * 1000);
  const qs = new URLSearchParams({
    external_reference: ref,
    begin_date: begin.toISOString(),
    end_date: end.toISOString(),
  });
  const payload = await mpFetch(accessToken, { path: `/v1/orders?${qs}` });
  const rows = (payload?.data || payload?.results || []).filter(
    (row) => String(row?.external_reference || "") === ref && mpOrderPaid(row),
  );
  return rows[0] || null;
}

export async function cancelMpOrder(accessToken, id) {
  try {
    return await mpFetch(accessToken, {
      method: "POST",
      path: `/v1/orders/${encodeURIComponent(id)}/cancel`,
      idempotencyKey: randomUUID(),
    });
  } catch (error) {
    if (error.status === 404 || /already|cancel|final/i.test(error.message || "")) return null;
    throw error;
  }
}

export function payerFromOrder(order, email) {
  const phone = mpPhone(order?.customer_whatsapp);
  const payer = { email: String(email || "").trim() };
  const name = String(order?.customer_name || "").trim();
  const [firstName, ...rest] = name.split(/\s+/).filter(Boolean);
  if (firstName) payer.first_name = firstName;
  if (rest.length) payer.last_name = rest.join(" ");
  if (phone) payer.phone = phone;
  return payer;
}
