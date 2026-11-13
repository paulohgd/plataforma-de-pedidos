import "./env.js";
import http from "node:http";
import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";
import { paidMessage, paidTitle } from "../src/config.js";
import { cleanCouponCode, couponDiscount, findCoupon } from "../src/coupons.js";
import { checkoutEmail, fullPhone, payerEmail, validPhone } from "../src/format.js";
import { formatKm } from "../src/freight.js";
import {
  asStripePublishableKey,
  asStripeSecretKey,
  isStripePublishableKey,
  isStripeSecretKey,
  isStripeTestKey,
} from "../src/stripeKeys.js";
import { buildOrderText, whatsappOrderUrl } from "../src/order.js";
import { quoteCart } from "./quote.js";
import { sendShopDiscord } from "./discord.js";
import { sendShopWhatsApp } from "./evolution.js";
import { quoteDelivery } from "./freight.js";
import {
  amountToCents,
  cancelIntent,
  checkoutSessionPaid,
  constructWebhookEvent,
  createCardIntent,
  createEmbeddedCheckout,
  createPixIntent,
  paymentKindFromIntent,
  pixFromIntent,
  retrieveCheckoutSession,
  retrieveIntent,
  searchPaidIntentByOrder,
  stripeCsId,
  stripePaymentClosed,
  stripePaymentPaid,
  stripePiId,
  stripePublicError,
} from "./stripePay.js";
import { canLockPaymentMethod, findDuplicatePaid, normalizePaymentMethod } from "./paymentRules.js";
import { isShopPage, sendShopPage } from "./shopPage.js";
import { publicError, readBody, readJson, securityHeaders, tooMany } from "./security.js";

function moneyAmount(value) {
  return Number(value || 0).toFixed(2);
}

const chargingOrders = new Set();

const port = Number(process.env.PORT) || 8787;
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const supabase =
  supabaseUrl && serviceKey
    ? createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { transport: WebSocket },
      })
    : null;
const notifiedOrders = new Set();

function envStripePublishableKey() {
  return asStripePublishableKey(process.env.STRIPE_PUBLISHABLE_KEY);
}

function envStripeSecretKey() {
  return asStripeSecretKey(process.env.STRIPE_SECRET_KEY);
}

function envStripeWebhookSecret() {
  return String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
}

async function loadShopForNotify(shopId) {
  if (!supabase || !shopId) return null;
  const full = await supabase
    .from("shops")
    .select("name, whatsapp, notify_whatsapp, notify_discord")
    .eq("id", shopId)
    .maybeSingle();
  if (!full.error) return full.data;
  if (/notify_whatsapp|notify_discord/i.test(full.error.message || "")) {
    const basic = await supabase.from("shops").select("name, whatsapp").eq("id", shopId).maybeSingle();
    return basic.data;
  }
  console.error("Loja do pedido:", full.error.message);
  return null;
}

async function loadShopSecrets(shopId) {
  if (!supabase || !shopId) return { stripeSecret: "", discordWebhook: "" };
  const { data, error } = await supabase.from("shop_secrets").select("*").eq("shop_id", shopId).maybeSingle();
  if (error) {
    console.error("Segredos da loja:", error.message);
    return { stripeSecret: "", discordWebhook: "" };
  }
  if (!data) return { stripeSecret: "", discordWebhook: "" };
  return {
    stripeSecret:
      envStripeSecretKey() || asStripeSecretKey(data.stripe_secret_key) || asStripeSecretKey(data.mp_access_token),
    discordWebhook: String(data.discord_webhook_url || "").trim(),
  };
}

async function secretForShop(shopId) {
  const { stripeSecret } = await loadShopSecrets(shopId);
  return stripeSecret || "";
}

async function ownerFromRequest(request) {
  const jwt = String(request.headers.authorization || "").replace(/^Bearer\s+/i, "").trim();
  if (!jwt || !supabase) return null;
  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data?.user?.id) return null;
  return data.user;
}

async function saveShopStripeSecrets(request, response) {
  if (!supabase) {
    json(response, 503, { error: "Pagamento ainda não está configurado no servidor." });
    return;
  }
  const user = await ownerFromRequest(request);
  if (!user) {
    json(response, 401, { error: "Sua sessão expirou. Entre de novo." });
    return;
  }
  const payload = await readJson(request, 8192);
  const shopId = String(payload.shopId || "").trim();
  const token = String(payload.stripeSecretKey || payload.mpAccessToken || "").trim();
  const discord = String(payload.discordWebhookUrl || "").trim();
  if (token && !isStripeSecretKey(token)) {
    json(response, 400, { error: "Cole a chave secreta da Stripe desta loja (sk_... ou rk_...)." });
    return;
  }
  if (discord && !discord.startsWith("https://discord.com/api/webhooks/")) {
    json(response, 400, { error: "O webhook do Discord deve começar com https://discord.com/api/webhooks/" });
    return;
  }
  const { data: shop } = await supabase.from("shops").select("id, owner_id").eq("id", shopId).maybeSingle();
  if (!shop || shop.owner_id !== user.id) {
    json(response, 403, { error: "Esta loja não pertence a esta conta." });
    return;
  }
  if (!token && !discord) {
    json(response, 200, { ok: true, stripe: false });
    return;
  }
  const { data: existing } = await supabase.from("shop_secrets").select("shop_id").eq("shop_id", shopId).maybeSingle();
  const row = {
    shop_id: shopId,
    updated_at: new Date().toISOString(),
  };
  if (token) row.stripe_secret_key = token;
  if (discord) row.discord_webhook_url = discord;
  const written = existing
    ? await supabase.from("shop_secrets").update(row).eq("shop_id", shopId).select("stripe_secret_key").maybeSingle()
    : await supabase
        .from("shop_secrets")
        .insert({
          stripe_secret_key: token || "",
          discord_webhook_url: discord || "",
          ...row,
        })
        .select("stripe_secret_key")
        .maybeSingle();
  if (written.error) {
    console.error("shop_secrets:", written.error.message);
    json(response, 500, { error: "Não foi possível gravar a chave secreta da Stripe." });
    return;
  }
  json(response, 200, {
    ok: true,
    stripe: Boolean(asStripeSecretKey(written.data?.stripe_secret_key)),
  });
}

function shopPublicKey(shop) {
  return (
    envStripePublishableKey() ||
    asStripePublishableKey(shop?.stripePublishableKey) ||
    asStripePublishableKey(shop?.mpPublicKey) ||
    ""
  );
}

function missingStripeConfig(secret, publicKey) {
  if (!publicKey && !secret) {
    return "Falta configurar as chaves da Stripe nas configurações da loja.";
  }
  if (!publicKey) return "Falta a chave pública da Stripe (pk_...) nas configurações da loja.";
  return "Falta a chave secreta da Stripe (sk_... ou rk_...) nas configurações da loja. Cole de novo e salve.";
}

function json(response, status, payload) {
  response.writeHead(status, {
    ...securityHeaders,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

async function loadShop(slug) {
  const { data: shop, error } = await supabase.from("shops").select("*").eq("slug", slug).maybeSingle();
  if (error) throw new Error(error.message);
  if (!shop) return null;
  const [{ data: categories }, { data: products }, { data: itemTypes }] = await Promise.all([
    supabase.from("categories").select("*").eq("shop_id", shop.id),
    supabase.from("products").select("*").eq("shop_id", shop.id),
    supabase.from("item_types").select("*").eq("shop_id", shop.id).order("position"),
  ]);
  return {
    shopId: shop.id,
    shop: {
      name: shop.name,
      slug: shop.slug,
      whatsapp: shop.whatsapp || "",
      address: shop.address || "",
      cep: shop.cep || "",
      open: shop.is_open !== false,
      mpPublicKey:
        asStripePublishableKey(shop.stripe_publishable_key) || asStripePublishableKey(shop.mp_public_key),
      stripePublishableKey:
        asStripePublishableKey(shop.stripe_publishable_key) || asStripePublishableKey(shop.mp_public_key),
      paidTitle: shop.paid_title || paidTitle,
      paidMessage: shop.paid_message || paidMessage,
      minOrder: shop.min_order,
      deliveryMaxKm: shop.delivery_max_km,
      deliveryFees: shop.delivery_fees,
      coupons: shop.coupons,
    },
    products: (products || []).map((product) => ({
      id: product.id,
      category: product.category_id,
      kind: product.kind,
      name: product.name,
      description: product.description || "",
      price: Number(product.price),
      image: product.image || "",
      featured: Boolean(product.featured),
      active: product.active !== false,
    })),
    itemTypes: (itemTypes || []).map((type) => ({
      id: type.id,
      name: type.name,
      groups: type.groups || [],
    })),
    categories: categories || [],
  };
}

function orderTextFromRow(shop, order, payment) {
  const lines = (order.items || []).map((line) => ({
    qty: line.qty,
    product: { name: line.name },
    total: line.total,
    options: line.options || [],
    note: line.note || "",
  }));
  return buildOrderText({
    shop: { name: shop?.name || "" },
    customer: {
      name: order.customer_name || "",
      whatsapp: order.customer_whatsapp || "",
      mode: order.customer_mode || "retirada",
      address: order.customer_address || "",
      notes: order.customer_notes || "",
    },
    lines,
    total: Number(order.total || 0),
    paid: true,
    payment,
    delivery:
      order.customer_mode === "entrega" && order.delivery_km != null
        ? { km: Number(order.delivery_km), fee: Number(order.delivery_fee) || 0 }
        : null,
  });
}

async function lockPaymentMethod(order, method) {
  const check = canLockPaymentMethod(order?.payment_method, method);
  if (!check.ok) return { ok: false, error: check.error, order };
  if (normalizePaymentMethod(order?.payment_method) === check.method) return { ok: true, order };
  const patch = { payment_method: check.method };
  const { data, error } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", order.id)
    .select("*")
    .maybeSingle();
  if (error && /payment_method/i.test(error.message || "")) {
    return { ok: true, order: { ...order, payment_method: check.method } };
  }
  if (error) return { ok: false, error: error.message, order };
  return { ok: true, order: data || { ...order, payment_method: check.method } };
}

async function flagDuplicatePayments(paidOrder) {
  if (!paidOrder?.id || paidOrder.status !== "paid") return;
  const shopId = paidOrder.shop_id;
  const parentId = String(paidOrder.parent_order_id || "").trim();
  const { data: rows } = await supabase
    .from("orders")
    .select("id, status, parent_order_id, payment_method, payment_duplicate")
    .eq("shop_id", shopId)
    .or(
      [
        `id.eq.${paidOrder.id}`,
        parentId ? `id.eq.${parentId}` : "",
        `parent_order_id.eq.${paidOrder.id}`,
        parentId ? `parent_order_id.eq.${parentId}` : "",
      ]
        .filter(Boolean)
        .join(","),
    );
  const other = findDuplicatePaid(paidOrder, rows || []);
  if (!other) return;
  const note = `Pagamento duplicado: este pedido e o ${other.id.slice(0, 8)} foram pagos.`;
  await supabase
    .from("orders")
    .update({ payment_duplicate: true, payment_duplicate_note: note })
    .in("id", [paidOrder.id, other.id]);
  console.error("Pagamento duplicado:", paidOrder.id, other.id);
}

function paymentIntentIdFrom(value) {
  if (!value) return "";
  if (typeof value === "string") return stripePiId(value);
  return stripePiId(value.id);
}

function paymentKindFromSession(session) {
  const intent = typeof session?.payment_intent === "object" ? session.payment_intent : null;
  if (intent) return paymentKindFromIntent(intent);
  return "card";
}

async function fulfill(orderId, intent, session = null) {
  if (!orderId) return null;
  if (session) {
    if (!checkoutSessionPaid(session)) return null;
  } else if (!stripePaymentPaid(intent)) {
    return null;
  }
  const paidAt = new Date().toISOString();
  const payment = session ? paymentKindFromSession(session) : paymentKindFromIntent(intent);
  const intentId = paymentIntentIdFrom(session?.payment_intent) || String(intent?.id || "");
  const sessionId = stripeCsId(session?.id) || "";
  const patch = {
    status: "paid",
    paid_at: paidAt,
    stripe_session_id: sessionId || intentId,
    stripe_payment_intent: intentId,
    payment_method: payment,
  };
  let { data, error } = await supabase
    .from("orders")
    .update(patch)
    .eq("id", orderId)
    .neq("status", "paid")
    .select("*")
    .maybeSingle();
  if (error && /payment_method/i.test(error.message || "")) {
    const { payment_method: _method, ...rest } = patch;
    ({ data, error } = await supabase
      .from("orders")
      .update(rest)
      .eq("id", orderId)
      .neq("status", "paid")
      .select("*")
      .maybeSingle());
  }
  if (error) throw new Error(error.message);
  if (data) {
    notifiedOrders.add(data.id);
    await flagDuplicatePayments(data).catch((failure) => console.error("Duplicidade:", failure.message));
    const shop = await loadShopForNotify(data.shop_id);
    data.whatsapp_text = orderTextFromRow(shop, data, payment);
    await supabase.from("orders").update({ whatsapp_text: data.whatsapp_text }).eq("id", data.id);
    const secrets = await loadShopSecrets(data.shop_id);
    const notifyWhatsapp = shop?.notify_whatsapp !== false;
    const notifyDiscord = shop?.notify_discord === true;
    const whatsapp = notifyWhatsapp
      ? await sendShopWhatsApp(shop, data.whatsapp_text, shop?.whatsapp)
      : { sent: false, error: "" };
    if (notifyWhatsapp && !whatsapp.sent) console.error("WhatsApp da loja:", whatsapp.error);
    const discord = notifyDiscord
      ? await sendShopDiscord(shop, data.whatsapp_text, secrets.discordWebhook, data)
      : { sent: false, error: "" };
    if (notifyDiscord && !discord.sent) console.error("Discord da loja:", discord.error);
    if (whatsapp.sent || discord.sent) {
      data.whatsapp_sent_at = new Date().toISOString();
      const stampedRow = await supabase
        .from("orders")
        .update({ whatsapp_sent_at: data.whatsapp_sent_at })
        .eq("id", data.id);
      if (stampedRow.error) console.error("whatsapp_sent_at:", stampedRow.error.message);
    }
    return data;
  }
  return (await supabase.from("orders").select("*").eq("id", orderId).maybeSingle()).data || null;
}

async function markCanceled(orderId, intent) {
  if (!orderId) return null;
  const intentId = String(intent?.id || "");
  const { data, error } = await supabase
    .from("orders")
    .update({
      status: "canceled",
      stripe_session_id: intentId || undefined,
      stripe_payment_intent: intentId || undefined,
    })
    .eq("id", orderId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data;
  return (await supabase.from("orders").select("*").eq("id", orderId).maybeSingle()).data || null;
}

function sameOrderReference(existing, intent) {
  const ref = String(intent?.metadata?.order_id || "").trim();
  return !ref || ref === String(existing?.id || "");
}

async function applyStripeIntent(existing, intent) {
  if (!existing || !intent) return existing;
  if (existing.status === "paid") return existing;
  if (!sameOrderReference(existing, intent)) return existing;
  if (stripePaymentPaid(intent)) return (await fulfill(existing.id, intent)) || existing;
  if (stripePaymentClosed(intent)) {
    const currentId = stripePiId(existing.stripe_session_id);
    const closedId = stripePiId(intent.id);
    if (currentId && closedId && currentId !== closedId) return existing;
    return (await markCanceled(existing.id, intent)) || existing;
  }
  return existing;
}

async function reopenPending(orderId) {
  await supabase.from("orders").update({ status: "pending" }).eq("id", orderId).eq("status", "canceled");
}

async function settleOrder(existing) {
  if (!existing) return existing;
  if (existing.status === "paid") return existing;
  const secret = await secretForShop(existing.shop_id);
  if (!secret) return existing;

  const csId = stripeCsId(existing.stripe_session_id);
  if (csId) {
    try {
      const session = await retrieveCheckoutSession(secret, csId);
      if (checkoutSessionPaid(session)) {
        const intent =
          typeof session.payment_intent === "object"
            ? session.payment_intent
            : session.payment_intent
              ? await retrieveIntent(secret, session.payment_intent).catch(() => null)
              : null;
        return (await fulfill(existing.id, intent, session)) || existing;
      }
    } catch (error) {
      console.error("Consulta Checkout Stripe:", error.message);
    }
  }

  const piId = stripePiId(existing.stripe_session_id) || stripePiId(existing.stripe_payment_intent);
  let intent = null;
  if (piId) {
    try {
      intent = await retrieveIntent(secret, piId);
    } catch (error) {
      console.error("Consulta Stripe:", error.message);
    }
  }
  if (!stripePaymentPaid(intent)) {
    try {
      intent = (await searchPaidIntentByOrder(secret, existing.id)) || intent;
    } catch (error) {
      console.error("Busca Stripe:", error.message);
    }
  }
  if (!intent) return existing;
  return applyStripeIntent(existing, intent);
}

async function rememberIntent(orderId, intent) {
  const id = String(intent?.id || "");
  if (!orderId || !id) return;
  await supabase.from("orders").update({ stripe_session_id: id, stripe_payment_intent: id }).eq("id", orderId);
}

async function loadOrderBySession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  const byId = (await supabase.from("orders").select("*").eq("id", id).maybeSingle()).data;
  if (byId) return byId;
  return (await supabase.from("orders").select("*").eq("stripe_session_id", id).maybeSingle()).data;
}

function mpLocation(uf) {
  const state = String(uf || "").trim().toUpperCase();
  return state.length === 2 ? `BR-${state}` : "BR-SP";
}

function orderAmount(existing) {
  return moneyAmount(existing.total);
}

function customerPlace(order, payload = {}) {
  const incoming = payload.place && typeof payload.place === "object" ? payload.place : {};
  const saved = order?.customer_place && typeof order.customer_place === "object" ? order.customer_place : {};
  return {
    cep: String(incoming.cep || saved.cep || "").replace(/\D/g, "").slice(0, 8),
    street: String(incoming.street || saved.street || "").trim(),
    number: String(incoming.number || saved.number || "").trim(),
    neighborhood: String(incoming.neighborhood || saved.neighborhood || "").trim(),
    city: String(incoming.city || saved.city || "").trim(),
    uf: String(incoming.uf || saved.uf || "").trim().toUpperCase(),
    complement: String(incoming.complement || saved.complement || "").trim(),
  };
}

function orderPayerEmail(order) {
  return checkoutEmail(order?.customer_whatsapp, order?.id);
}

async function createCheckout(request, response) {
  if (!supabase) {
    json(response, 503, { error: "Pagamento ainda não está configurado no servidor." });
    return;
  }
  if (tooMany(request, 8, 5 * 60 * 1000)) {
    json(response, 429, { error: "Muitas tentativas. Espere um pouco e tente de novo." });
    return;
  }

  const payload = await readJson(request);
  const slug = String(payload.slug || "").trim();
  const customer = payload.customer || {};
  const name = String(customer.name || "").trim();
  const whatsapp = fullPhone(customer.whatsapp);
  const mode = customer.mode === "entrega" ? "entrega" : "retirada";
  const address = String(customer.address || "").trim();
  const cep = String(customer.cep || "").replace(/\D/g, "").slice(0, 8);
  const notes = String(customer.notes || "").trim().slice(0, 200);
  const place = {
    cep,
    street: String(customer.street || "").trim(),
    number: String(customer.number || "").trim(),
    neighborhood: String(customer.neighborhood || "").trim(),
    city: String(customer.city || "").trim(),
    uf: String(customer.uf || "").trim().toUpperCase(),
    complement: String(customer.complement || "").trim(),
  };

  if (name.length < 2) {
    json(response, 400, { error: "Informe seu nome." });
    return;
  }
  if (!validPhone(whatsapp)) {
    json(response, 400, { error: "Informe um WhatsApp válido, com DDD." });
    return;
  }
  if (mode === "entrega" && cep.length !== 8 && address.length < 6) {
    json(response, 400, { error: "Informe o CEP da entrega." });
    return;
  }

  const store = await loadShop(slug);
  if (!store) {
    json(response, 404, { error: "Loja não encontrada." });
    return;
  }
  if (!store.shop.open) {
    json(response, 400, { error: "A loja está fechada no momento." });
    return;
  }

  const accessToken = await secretForShop(store.shopId);
  const publicKey = shopPublicKey(store.shop);
  if (!accessToken || !publicKey) {
    json(response, 503, { error: missingStripeConfig(accessToken, publicKey) });
    return;
  }

  const quoted = quoteCart(store, payload);
  if (quoted.error) {
    json(response, 400, { error: quoted.error });
    return;
  }

  const couponCode = cleanCouponCode(payload.coupon);
  const coupon = findCoupon(store.shop.coupons, couponCode);
  if (couponCode && !coupon) {
    json(response, 400, { error: "Cupom inválido." });
    return;
  }
  const discount = couponDiscount(quoted.total, coupon);

  let delivery = null;
  if (mode === "entrega") {
    delivery = await quoteDelivery(
      {
        address: store.shop.address,
        cep: store.shop.cep,
        deliveryMaxKm: store.shop.deliveryMaxKm,
        deliveryFees: store.shop.deliveryFees,
      },
      { address, cep, number: customer.number },
    );
    if (delivery.error) {
      json(response, 400, { error: delivery.error });
      return;
    }
  }

  const payTotal = Number((quoted.total - discount + (delivery?.fee || 0)).toFixed(2));
  if (payTotal < 0.5) {
    json(response, 400, { error: "O valor com desconto ficou abaixo do mínimo para pagamento." });
    return;
  }
  const items = quoted.lines.map((line) => ({
    productId: line.productId,
    name: line.name,
    qty: line.qty,
    note: line.note,
    options: line.options,
    total: line.total,
  }));
  if (discount > 0 && coupon) {
    items.push({
      name: `Cupom ${coupon.code} (${coupon.percent}%)`,
      qty: 1,
      note: "",
      options: [],
      total: -discount,
    });
  }
  if (delivery) {
    items.push({
      name: delivery.fee > 0 ? `Entrega (${formatKm(delivery.km)})` : `Entrega grátis (${formatKm(delivery.km)})`,
      qty: 1,
      note: "",
      options: [],
      total: delivery.fee,
    });
  }

  const text = buildOrderText({
    shop: store.shop,
    customer: { name, whatsapp, mode, address, notes },
    lines: quoted.lines,
    total: payTotal,
    paid: true,
    delivery,
    coupon,
    discount,
  });

  const parentOrderId = String(payload.parentOrderId || "").trim();
  let parent = null;
  if (parentOrderId) {
    parent = (await supabase.from("orders").select("id, shop_id, status").eq("id", parentOrderId).maybeSingle()).data;
    if (!parent || parent.shop_id !== store.shopId) {
      json(response, 400, { error: "Pedido de origem inválido." });
      return;
    }
  }

  const orderRow = {
    shop_id: store.shopId,
    status: "pending",
    customer_name: name.slice(0, 80),
    customer_email: "",
    customer_place: place,
    customer_whatsapp: whatsapp,
    customer_mode: mode,
    customer_address: address.slice(0, 160),
    customer_notes: notes,
    items,
    total: payTotal,
    delivery_km: delivery ? delivery.km : null,
    delivery_fee: delivery ? delivery.fee : 0,
    whatsapp_text: text,
    payment_method: "",
    parent_order_id: parent?.id || null,
    payment_duplicate: false,
    payment_duplicate_note: "",
  };

  let { data: order, error: orderError } = await supabase.from("orders").insert(orderRow).select("*").single();
  if (orderError && /customer_whatsapp/i.test(orderError.message || "")) {
    const { customer_whatsapp: _phone, ...rest } = orderRow;
    ({ data: order, error: orderError } = await supabase.from("orders").insert(rest).select("*").single());
  }
  if (orderError && /delivery_/i.test(orderError.message || "")) {
    const { delivery_km: _km, delivery_fee: _fee, ...rest } = orderRow;
    ({ data: order, error: orderError } = await supabase.from("orders").insert(rest).select("*").single());
  }
  if (orderError && /customer_email|customer_place/i.test(orderError.message || "")) {
    const { customer_email: _email, customer_place: _place, ...rest } = orderRow;
    ({ data: order, error: orderError } = await supabase.from("orders").insert(rest).select("*").single());
  }
  if (orderError && /payment_method|parent_order_id|payment_duplicate/i.test(orderError.message || "")) {
    const {
      payment_method: _method,
      parent_order_id: _parent,
      payment_duplicate: _dup,
      payment_duplicate_note: _note,
      ...rest
    } = orderRow;
    ({ data: order, error: orderError } = await supabase.from("orders").insert(rest).select("*").single());
  }
  if (orderError) {
    json(response, 500, { error: "Não foi possível gravar o pedido." });
    return;
  }

  const origin = String(payload.origin || request.headers.origin || "").replace(/\/$/, "");
  const returnUrl = origin
    ? `${origin}/loja/${encodeURIComponent(slug)}/pedido-pago?session_id={CHECKOUT_SESSION_ID}`
    : undefined;
  if (!returnUrl) {
    await supabase.from("orders").update({ status: "canceled" }).eq("id", order.id);
    json(response, 400, { error: "Origem do checkout inválida." });
    return;
  }

  const stripeLines = [
    ...quoted.lines.map((line) => ({
      name: line.name,
      qty: line.qty,
      unit: line.unit,
      total: line.total,
      options: line.options,
    })),
  ];
  if (delivery && delivery.fee > 0) {
    stripeLines.push({
      name: `Entrega (${formatKm(delivery.km)})`,
      qty: 1,
      unit: delivery.fee,
      total: delivery.fee,
      options: [],
    });
  }

  try {
    const session = await createEmbeddedCheckout(accessToken, {
      orderId: order.id,
      shopId: store.shopId,
      slug,
      returnUrl,
      lines: stripeLines,
      email: checkoutEmail(whatsapp, order.id),
      discountCents: discount > 0 ? amountToCents(discount) : 0,
      discountLabel: coupon ? `Cupom ${coupon.code}` : "Desconto",
    });
    await supabase
      .from("orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id);
    json(response, 200, {
      sessionId: order.id,
      checkoutSessionId: session.id,
      clientSecret: session.client_secret,
      publishableKey: publicKey,
      publicKey,
      payerEmail: checkoutEmail(whatsapp, order.id),
      parentOrderId: order.parent_order_id || parent?.id || "",
    });
  } catch (error) {
    console.error("Checkout Stripe:", error.message);
    await supabase.from("orders").update({ status: "canceled" }).eq("id", order.id);
    json(response, 500, {
      error: stripePublicError(error, "Não foi possível iniciar o pagamento."),
    });
  }
}

async function shopCopy(shopId) {
  const withCopy = await supabase.from("shops").select("name, slug, logo, paid_title, paid_message, whatsapp").eq("id", shopId).maybeSingle();
  if (!withCopy.error) return withCopy.data;
  return (await supabase.from("shops").select("name, slug, whatsapp").eq("id", shopId).maybeSingle()).data;
}

async function quoteDeliveryRoute(request, response) {
  if (!supabase) {
    json(response, 503, { error: "Pagamento ainda não está configurado no servidor." });
    return;
  }
  if (tooMany(request, 20, 5 * 60 * 1000)) {
    json(response, 429, { error: "Muitas tentativas. Espere um pouco e tente de novo." });
    return;
  }
  const payload = await readJson(request, 4096);
  const slug = String(payload.slug || "").trim();
  const address = String(payload.address || "").trim();
  const cep = String(payload.cep || "").replace(/\D/g, "").slice(0, 8);
  const store = await loadShop(slug);
  if (!store) {
    json(response, 404, { error: "Loja não encontrada." });
    return;
  }
  const quote = await quoteDelivery(
    {
      address: store.shop.address,
      cep: store.shop.cep,
      deliveryMaxKm: store.shop.deliveryMaxKm,
      deliveryFees: store.shop.deliveryFees,
    },
    { address, cep, number: payload.number },
  );
  if (quote.error) {
    json(response, 400, { error: quote.error });
    return;
  }
  json(response, 200, quote);
}

async function readSession(request, response) {
  if (!supabase) {
    json(response, 503, { error: "Pagamento ainda não está configurado no servidor." });
    return;
  }
  const payload = await readJson(request, 4096);
  const sessionId = String(payload.sessionId || "");
  const existing = await loadOrderBySession(sessionId);
  if (!existing) {
    json(response, 404, { error: "Pedido não encontrado." });
    return;
  }
  const secret = await secretForShop(existing.shop_id);
  if (!secret) {
    json(response, 503, { error: missingStripeConfig(secret, true) });
    return;
  }
  const order = await settleOrder(existing);
  const shop = await shopCopy(order.shop_id);
  const paid = order.status === "paid";
  const canceled = order.status === "canceled";
  const text = paid ? order.whatsapp_text || orderTextFromRow(shop, order) : "";
  let payment = order.payment_method || "";
  let pix = { pixCopy: "", expiresAt: 0 };
  const piId = stripePiId(order.stripe_session_id) || stripePiId(order.stripe_payment_intent);
  if (piId) {
    const intent = await retrieveIntent(secret, piId).catch(() => null);
    if (intent) {
      payment = payment || paymentKindFromIntent(intent);
      pix = pixFromIntent(intent);
    }
  }
  json(response, 200, {
    paid,
    canceled,
    pending: !paid && !canceled,
    payment,
    paymentDuplicate: Boolean(order.payment_duplicate),
    paymentDuplicateNote: order.payment_duplicate_note || "",
    parentOrderId: order.parent_order_id || "",
    pixCopy: pix.pixCopy || "",
    expiresAt: pix.expiresAt || 0,
    shopName: shop?.name || "",
    shopLogo: shop?.logo || "",
    total: Number(order.total || 0),
    items: Array.isArray(order.items) ? order.items : [],
    createdAt: order.created_at,
    paidTitle: shop?.paid_title || paidTitle,
    paidMessage: shop?.paid_message || paidMessage,
    whatsappUrl: paid ? whatsappOrderUrl(shop, text) : "",
  });
}

async function createPix(request, response) {
  if (!supabase) {
    json(response, 503, { error: "Pagamento ainda não está configurado no servidor." });
    return;
  }
  if (tooMany(request, 12, 5 * 60 * 1000)) {
    json(response, 429, { error: "Muitas tentativas. Espere um pouco e tente de novo." });
    return;
  }
  const payload = await readJson(request, 4096);
  let existing = await loadOrderBySession(payload.sessionId);
  if (!existing) {
    json(response, 404, { error: "Pedido não encontrado." });
    return;
  }
  if (existing.status === "paid") {
    json(response, 200, { paid: true, pixCopy: "", expiresAt: 0 });
    return;
  }
  if (existing.status === "canceled") await reopenPending(existing.id);
  const locked = await lockPaymentMethod(existing, "pix");
  if (!locked.ok) {
    json(response, 409, { error: locked.error });
    return;
  }
  existing = locked.order;
  const secret = await secretForShop(existing.shop_id);
  if (!secret) {
    json(response, 503, { error: missingStripeConfig(secret, true) });
    return;
  }
  if (chargingOrders.has(existing.id)) {
    json(response, 409, { error: "Este pedido já está sendo processado. Aguarde." });
    return;
  }
  chargingOrders.add(existing.id);
  try {
    const currentId = stripePiId(existing.stripe_session_id);
    if (currentId) {
      const previous = await retrieveIntent(secret, currentId).catch(() => null);
      if (previous) {
        if (stripePaymentPaid(previous)) {
          await fulfill(existing.id, previous);
          json(response, 200, { paid: true, pixCopy: "", expiresAt: 0 });
          return;
        }
        const live = pixFromIntent(previous);
        if (live.pixCopy && !stripePaymentClosed(previous)) {
          json(response, 200, { ...live, payment: "pix" });
          return;
        }
        if (!stripePaymentClosed(previous) && !stripePaymentPaid(previous)) {
          await cancelIntent(secret, currentId).catch(() => null);
        }
      }
    }
    const email = payerEmail(payload.email) || checkoutEmail(existing.customer_whatsapp, existing.id);
    const created = await createPixIntent(secret, {
      amount: existing.total,
      orderId: existing.id,
      name: existing.customer_name,
      email,
      taxId: payload.taxId || payload.cpf || "",
    });
    await rememberIntent(existing.id, created);
    if (stripePaymentPaid(created)) {
      await fulfill(existing.id, created);
      json(response, 200, { paid: true, pixCopy: "", expiresAt: 0 });
      return;
    }
    const pix = pixFromIntent(created);
    if (!pix.pixCopy) {
      json(response, 500, { error: "Não foi possível gerar o Pix. Tente de novo em instantes." });
      return;
    }
    json(response, 200, { ...pix, payment: "pix" });
  } catch (error) {
    console.error("Pix:", error.message);
    json(response, 500, { error: stripePublicError(error, "Não foi possível gerar o Pix.") });
  } finally {
    chargingOrders.delete(existing.id);
  }
}

async function payCard(request, response) {
  if (!supabase) {
    json(response, 503, { error: "Pagamento ainda não está configurado no servidor." });
    return;
  }
  if (tooMany(request, 12, 5 * 60 * 1000)) {
    json(response, 429, { error: "Muitas tentativas. Espere um pouco e tente de novo." });
    return;
  }
  const payload = await readJson(request, 8192);
  let existing = await loadOrderBySession(payload.sessionId);
  if (!existing) {
    json(response, 404, { error: "Pedido não encontrado." });
    return;
  }
  if (existing.status === "paid") {
    json(response, 200, { paid: true });
    return;
  }
  if (existing.status === "canceled") await reopenPending(existing.id);
  const locked = await lockPaymentMethod(existing, "card");
  if (!locked.ok) {
    json(response, 409, {
      error: locked.error,
      needsNewCheckout: true,
    });
    return;
  }
  existing = locked.order;
  const cardEmail = payerEmail(payload.email);
  if (!cardEmail) {
    json(response, 400, { error: "Informe um e-mail válido para pagar com cartão." });
    return;
  }
  const secret = await secretForShop(existing.shop_id);
  if (!secret) {
    json(response, 503, { error: missingStripeConfig(secret, true) });
    return;
  }
  if (chargingOrders.has(existing.id)) {
    json(response, 409, { error: "Este pedido já está sendo processado. Aguarde." });
    return;
  }
  chargingOrders.add(existing.id);
  try {
    const currentId = stripePiId(existing.stripe_session_id);
    if (currentId) {
      const previous = await retrieveIntent(secret, currentId).catch(() => null);
      if (previous && stripePaymentPaid(previous)) {
        await fulfill(existing.id, previous);
        json(response, 200, { paid: true });
        return;
      }
      if (previous && paymentKindFromIntent(previous) === "pix" && !stripePaymentClosed(previous)) {
        const live = pixFromIntent(previous);
        if (live.pixCopy) {
          json(response, 409, {
            error: "Este pedido já está no Pix. Para pagar com cartão, inicie um novo pedido.",
            needsNewCheckout: true,
            ...live,
          });
          return;
        }
      }
      if (
        previous &&
        paymentKindFromIntent(previous) === "card" &&
        previous.status === "requires_payment_method" &&
        previous.client_secret
      ) {
        json(response, 200, {
          paid: false,
          clientSecret: previous.client_secret,
          paymentIntentId: previous.id,
        });
        return;
      }
      if (previous && !stripePaymentClosed(previous) && !stripePaymentPaid(previous)) {
        await cancelIntent(secret, currentId).catch(() => null);
      }
    }
    const created = await createCardIntent(secret, {
      amount: existing.total,
      orderId: existing.id,
      email: cardEmail,
      name: existing.customer_name,
    });
    await rememberIntent(existing.id, created);
    if (stripePaymentPaid(created)) {
      await fulfill(existing.id, created);
      json(response, 200, { paid: true });
      return;
    }
    if (!created.client_secret) {
      json(response, 500, { error: "Não foi possível iniciar o pagamento com cartão." });
      return;
    }
    json(response, 200, {
      paid: false,
      clientSecret: created.client_secret,
      paymentIntentId: created.id,
    });
  } catch (error) {
    console.error("Cartão:", error.message);
    json(response, 400, {
      error: stripePublicError(error, "Não foi possível processar o cartão agora. Tente de novo ou pague com Pix."),
    });
  } finally {
    chargingOrders.delete(existing.id);
  }
}

async function findOrderFromStripe(intent = {}) {
  const orderId = String(intent.metadata?.order_id || "").trim();
  const piId = stripePiId(intent.id);
  if (orderId) {
    const { data: row } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (row) return row;
  }
  if (piId) {
    const { data: row } = await supabase.from("orders").select("*").eq("stripe_session_id", piId).maybeSingle();
    if (row) return row;
  }
  return null;
}

async function handleWebhook(request, response) {
  if (!supabase) {
    json(response, 200, { received: true });
    return;
  }
  const raw = await readBody(request, 262144);
  let event;
  const signature = String(request.headers["stripe-signature"] || "");
  const webhookSecret = envStripeWebhookSecret();
  try {
    if (webhookSecret && signature) {
      event = constructWebhookEvent(raw, signature, webhookSecret);
    } else {
      event = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw || "{}"));
    }
  } catch (error) {
    console.error("Webhook Stripe:", error.message);
    json(response, 400, { error: "Webhook inválido." });
    return;
  }

  const type = String(event.type || "").toLowerCase();
  const object = event.data?.object && typeof event.data.object === "object" ? event.data.object : {};

  if (type.startsWith("checkout.session.")) {
    const sessionId = stripeCsId(object.id);
    const orderId = String(object.metadata?.order_id || "").trim();
    let existing = null;
    if (orderId) {
      existing = (await supabase.from("orders").select("*").eq("id", orderId).maybeSingle()).data;
    }
    if (!existing && sessionId) {
      existing = (await supabase.from("orders").select("*").eq("stripe_session_id", sessionId).maybeSingle()).data;
    }
    if (existing && existing.status !== "paid" && checkoutSessionPaid(object)) {
      try {
        const secret = await secretForShop(existing.shop_id);
        const session = secret
          ? (await retrieveCheckoutSession(secret, sessionId || object.id).catch(() => object))
          : object;
        const intent =
          typeof session.payment_intent === "object"
            ? session.payment_intent
            : session.payment_intent && secret
              ? await retrieveIntent(secret, session.payment_intent).catch(() => null)
              : null;
        await fulfill(existing.id, intent, session);
      } catch (error) {
        console.error("Webhook checkout:", error.message);
      }
    }
    json(response, 200, { received: true });
    return;
  }

  if (type && !type.startsWith("payment_intent.")) {
    json(response, 200, { received: true });
    return;
  }
  const intent = object;
  const existing = await findOrderFromStripe(intent);
  if (!existing) {
    json(response, 200, { received: true });
    return;
  }
  if (existing.status === "paid") {
    json(response, 200, { received: true });
    return;
  }
  try {
    const secret = await secretForShop(existing.shop_id);
    const fresh = secret ? await retrieveIntent(secret, intent.id).catch(() => intent) : intent;
    await applyStripeIntent(existing, fresh);
  } catch (error) {
    console.error("Webhook:", error.message);
  }
  json(response, 200, { received: true });
}


const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204, securityHeaders);
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/create-checkout") {
      await createCheckout(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/checkout-session") {
      await readSession(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/create-pix") {
      await createPix(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/pay-card") {
      await payCard(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/quote-delivery") {
      await quoteDeliveryRoute(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/shop-secrets") {
      await saveShopStripeSecrets(request, response);
      return;
    }
    if (request.method === "GET" && (url.pathname === "/api/mp-webhook" || url.pathname === "/api/stripe-webhook")) {
      json(response, 200, { ok: true });
      return;
    }
    if (request.method === "POST" && (url.pathname === "/api/mp-webhook" || url.pathname === "/api/stripe-webhook")) {
      await handleWebhook(request, response, url);
      return;
    }
    if (isShopPage(request.method, url.pathname)) {
      await sendShopPage(request, response, url, supabase);
      return;
    }
    json(response, 404, { error: "Rota não encontrada." });
  } catch (error) {
    const status = error?.code === "PAYLOAD_TOO_LARGE" ? 413 : error?.code === "INVALID_JSON" ? 400 : 500;
    json(response, status, {
      error: publicError(error, "Erro no servidor de pagamento."),
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  const localTest = isStripeTestKey(envStripeSecretKey()) || isStripeTestKey(envStripePublishableKey());
  console.log(`Pagamento em http://127.0.0.1:${port}${localTest ? " · Stripe teste (.env.server)" : ""}`);
});
