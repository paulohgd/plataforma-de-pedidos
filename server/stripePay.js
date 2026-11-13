import Stripe from "stripe";

export const PIX_MS = 5 * 60 * 1000;
export const PIX_EXPIRE_SECONDS = 30 * 60;

export function stripeClient(secretKey) {
  const key = String(secretKey || "").trim();
  if (!key) throw new Error("Stripe não configurado.");
  return new Stripe(key);
}

export function amountToCents(value) {
  return Math.round(Number(value || 0) * 100);
}

export function stripePiId(value) {
  const id = String(value || "").trim();
  return /^pi_[A-Za-z0-9]+$/.test(id) ? id : "";
}

export function stripeCsId(value) {
  const id = String(value || "").trim();
  return /^cs_[A-Za-z0-9]+$/.test(id) ? id : "";
}

export function checkoutSessionPaid(session) {
  const paymentStatus = String(session?.payment_status || "").toLowerCase();
  const status = String(session?.status || "").toLowerCase();
  return paymentStatus === "paid" || status === "complete";
}

export function stripePaymentPaid(intent) {
  const status = String(intent?.status || "").toLowerCase();
  return status === "succeeded";
}

export function stripePaymentClosed(intent) {
  const status = String(intent?.status || "").toLowerCase();
  return ["canceled", "cancelled"].includes(status);
}

export function stripePaymentFailed(intent) {
  const status = String(intent?.status || "").toLowerCase();
  if (status === "requires_payment_method") {
    return Boolean(intent?.last_payment_error);
  }
  return status === "canceled" || status === "cancelled";
}

export function paymentKindFromIntent(intent) {
  const types = intent?.payment_method_types || [];
  if (types.includes("pix")) return "pix";
  const type = String(intent?.charges?.data?.[0]?.payment_method_details?.type || "").toLowerCase();
  if (type === "pix") return "pix";
  return "card";
}

export function pixFromIntent(intent) {
  if (stripePaymentPaid(intent)) return { paid: true, pixCopy: "", expiresAt: 0 };
  const qr = intent?.next_action?.pix_display_qr_code || {};
  const copy = String(qr.data || "").trim();
  const expiresAt = Number(qr.expires_at || 0) * 1000 || (intent?.created ? intent.created * 1000 + PIX_MS : 0);
  return { paid: false, pixCopy: copy, expiresAt };
}

export function stripePublicError(error, fallback = "Não foi possível concluir o pagamento.") {
  const message = String(error?.message || error || "");
  const code = String(error?.code || error?.decline_code || "").toLowerCase();
  if (/card_declined|generic_decline/i.test(code) || /declined/i.test(message)) {
    return "O cartão foi recusado. Tente outro cartão ou Pix.";
  }
  if (/insufficient/i.test(code) || /insufficient/i.test(message)) {
    return "Este cartão não tem limite. Tente outro cartão ou Pix.";
  }
  if (/expired_card/i.test(code)) return "Cartão vencido. Use outro cartão ou Pix.";
  if (/incorrect_cvc|invalid_cvc/i.test(code)) return "CVV inválido. Confira os três números do verso.";
  if (/incorrect_number|invalid_number/i.test(code)) return "Número do cartão inválido.";
  if (/authentication_required/i.test(code)) {
    return "O banco pediu autenticação. Conclua a confirmação no cartão ou tente Pix.";
  }
  if (/pix/i.test(message) && /not.?enabled|disabled|unavailable/i.test(message)) {
    return "Pix ainda não está ativo nesta conta Stripe. Ative Pix no painel da Stripe.";
  }
  if (/api.?key|invalid.?key|authentication/i.test(message)) {
    return "As chaves da Stripe desta loja estão inválidas.";
  }
  return message.slice(0, 220) || fallback;
}

export async function createPixIntent(secretKey, { amount, orderId, name, email, taxId }) {
  const stripe = stripeClient(secretKey);
  const cents = amountToCents(amount);
  if (cents < 50) throw new Error("Valor mínimo para pagamento é R$ 0,50.");
  const tax = String(taxId || "").replace(/\D/g, "");
  const metadata = { order_id: String(orderId || "") };
  if (tax) metadata.tax_id = tax;
  return stripe.paymentIntents.create({
    amount: cents,
    currency: "brl",
    payment_method_types: ["pix"],
    payment_method_data: {
      type: "pix",
      billing_details: {
        name: String(name || "Cliente").slice(0, 120),
        email: String(email || "").trim() || undefined,
      },
    },
    payment_method_options: {
      pix: { expires_after_seconds: PIX_EXPIRE_SECONDS },
    },
    confirm: true,
    metadata,
  });
}

export async function createCardIntent(secretKey, { amount, orderId, email }) {
  const stripe = stripeClient(secretKey);
  const cents = amountToCents(amount);
  if (cents < 50) throw new Error("Valor mínimo para pagamento é R$ 0,50.");
  return stripe.paymentIntents.create({
    amount: cents,
    currency: "brl",
    payment_method_types: ["card"],
    metadata: { order_id: String(orderId || "") },
    receipt_email: String(email || "").trim() || undefined,
    description: `Pedido ${String(orderId || "").slice(0, 8)}`,
  });
}

export async function createEmbeddedCheckout(
  secretKey,
  { orderId, shopId, slug, returnUrl, lines, email, discountCents = 0, discountLabel = "Desconto" },
) {
  const stripe = stripeClient(secretKey);
  const lineItems = (lines || [])
    .map((line) => {
      const qty = Math.max(1, Number(line.qty) || 1);
      const unit = amountToCents(line.unit != null ? line.unit : Number(line.total || 0) / qty);
      if (unit < 1) return null;
      const description = Array.isArray(line.options)
        ? line.options.map((option) => option.name).filter(Boolean).join(", ").slice(0, 500)
        : "";
      return {
        quantity: qty,
        price_data: {
          currency: "brl",
          unit_amount: unit,
          product_data: {
            name: String(line.name || "Item").slice(0, 120),
            description: description || undefined,
          },
        },
      };
    })
    .filter(Boolean);
  if (!lineItems.length) throw new Error("Pedido sem itens para cobrança.");

  const metadata = {
    order_id: String(orderId || ""),
    shop_id: String(shopId || ""),
    shop_slug: String(slug || ""),
  };
  const params = {
    mode: "payment",
    ui_mode: "embedded_page",
    locale: "pt-BR",
    customer_creation: "if_required",
    return_url: returnUrl,
    metadata,
    line_items: lineItems,
    payment_intent_data: { metadata },
  };
  const mail = String(email || "").trim();
  if (mail) params.customer_email = mail;

  const off = Math.max(0, Math.round(Number(discountCents) || 0));
  if (off > 0) {
    const coupon = await stripe.coupons.create({
      amount_off: off,
      currency: "brl",
      duration: "once",
      name: String(discountLabel || "Desconto").slice(0, 40),
    });
    params.discounts = [{ coupon: coupon.id }];
  }

  return stripe.checkout.sessions.create(params);
}

export async function retrieveCheckoutSession(secretKey, sessionId) {
  const id = stripeCsId(sessionId);
  if (!id) return null;
  return stripeClient(secretKey).checkout.sessions.retrieve(id, {
    expand: ["payment_intent", "payment_intent.latest_charge", "payment_intent.payment_method"],
  });
}

export async function retrieveIntent(secretKey, intentId) {
  const id = stripePiId(intentId);
  if (!id) return null;
  return stripeClient(secretKey).paymentIntents.retrieve(id);
}

export async function cancelIntent(secretKey, intentId) {
  const id = stripePiId(intentId);
  if (!id) return null;
  try {
    return await stripeClient(secretKey).paymentIntents.cancel(id);
  } catch (error) {
    if (/already.?cancel|cannot.?cancel|status/i.test(error.message || "")) return null;
    throw error;
  }
}

export async function searchPaidIntentByOrder(secretKey, orderId) {
  const stripe = stripeClient(secretKey);
  const ref = String(orderId || "").trim();
  if (!ref) return null;
  const found = await stripe.paymentIntents.search({
    query: `metadata["order_id"]:"${ref}" AND status:"succeeded"`,
    limit: 1,
  });
  return found?.data?.[0] || null;
}

export function constructWebhookEvent(rawBody, signature, webhookSecret) {
  return Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
}
