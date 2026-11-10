import "./env.js";
import http from "node:http";
import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";
import { paidMessage, paidTitle } from "../src/config.js";
import { cleanCouponCode, couponDiscount, findCoupon } from "../src/coupons.js";
import { checkoutEmail, fullPhone, validPhone } from "../src/format.js";
import { formatKm } from "../src/freight.js";
import { asMpKey, isMpTestKey } from "../src/mp.js";
import { buildOrderText, whatsappOrderUrl } from "../src/order.js";
import { quoteCart } from "./quote.js";
import { sendShopDiscord } from "./discord.js";
import { quoteDelivery } from "./freight.js";
import {
  cancelMpOrder,
  createMpOrder,
  getMpOrder,
  searchMpOrderByRef,
  moneyAmount,
  mpOrderClosed,
  mpOrderPaid,
  mpPublicError,
  payerFromOrder,
  paymentKindFromOrder,
  pixFromOrder,
} from "./mercadopago.js";
import { isShopPage, sendShopPage } from "./shopPage.js";
import { publicError, readBody, readJson, securityHeaders, tooMany } from "./security.js";

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

function envMpPublicKey() {
  return asMpKey(process.env.MP_PUBLIC_KEY);
}

function envMpAccessToken() {
  return asMpKey(process.env.MP_ACCESS_TOKEN);
}

async function loadShopSecrets(shopId) {
  if (!supabase || !shopId) return { mpAccessToken: "", discordWebhook: "" };
  const { data, error } = await supabase.from("shop_secrets").select("*").eq("shop_id", shopId).maybeSingle();
  if (error || !data) return { mpAccessToken: "", discordWebhook: "" };
  return {
    mpAccessToken: envMpAccessToken() || asMpKey(data.mp_access_token) || asMpKey(data.stripe_secret_key),
    discordWebhook: String(data.discord_webhook_url || "").trim(),
  };
}

async function accessTokenForShop(shopId) {
  const { mpAccessToken } = await loadShopSecrets(shopId);
  return mpAccessToken || "";
}

function shopPublicKey(shop) {
  return envMpPublicKey() || shop?.mpPublicKey || "";
}

function isMpTestMode(publicKey, accessToken) {
  return isMpTestKey(publicKey) || isMpTestKey(accessToken);
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
      mpPublicKey: asMpKey(shop.mp_public_key) || asMpKey(shop.stripe_publishable_key),
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

function mpOrderId(value) {
  const id = String(value || "").trim();
  return /^ORD/i.test(id) ? id : "";
}

async function fulfill(orderId, mpOrder) {
  if (!orderId || !mpOrderPaid(mpOrder)) return null;
  const paidAt = new Date().toISOString();
  const payment = paymentKindFromOrder(mpOrder);
  const paymentId = String(firstPaymentId(mpOrder) || "");
  const { data, error } = await supabase
    .from("orders")
    .update({
      status: "paid",
      paid_at: paidAt,
      stripe_session_id: String(mpOrder.id || ""),
      stripe_payment_intent: paymentId,
    })
    .eq("id", orderId)
    .neq("status", "paid")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) {
    notifiedOrders.add(data.id);
    const shop = (await supabase.from("shops").select("name").eq("id", data.shop_id).maybeSingle()).data;
    data.whatsapp_text = orderTextFromRow(shop, data, payment);
    await supabase.from("orders").update({ whatsapp_text: data.whatsapp_text }).eq("id", data.id);
    const secrets = await loadShopSecrets(data.shop_id);
    const sent = await sendShopDiscord(shop, data.whatsapp_text, secrets.discordWebhook, data);
    if (sent.sent) {
      data.whatsapp_sent_at = new Date().toISOString();
      const stampedRow = await supabase
        .from("orders")
        .update({ whatsapp_sent_at: data.whatsapp_sent_at })
        .eq("id", data.id);
      if (stampedRow.error) console.error("whatsapp_sent_at:", stampedRow.error.message);
    } else {
      console.error("Discord da loja:", sent.error);
    }
    return data;
  }
  return (await supabase.from("orders").select("*").eq("id", orderId).maybeSingle()).data || null;
}

function firstPaymentId(mpOrder) {
  return mpOrder?.transactions?.payments?.[0]?.id || "";
}

async function markCanceled(orderId, mpOrder) {
  if (!orderId) return null;
  const paymentId = String(firstPaymentId(mpOrder) || "");
  const { data, error } = await supabase
    .from("orders")
    .update({
      status: "canceled",
      stripe_session_id: String(mpOrder?.id || ""),
      stripe_payment_intent: paymentId,
    })
    .eq("id", orderId)
    .eq("status", "pending")
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data;
  return (await supabase.from("orders").select("*").eq("id", orderId).maybeSingle()).data || null;
}

async function applyMpOrder(existing, mpOrder) {
  if (!existing || !mpOrder) return existing;
  if (existing.status === "paid") return existing;
  if (mpOrderPaid(mpOrder)) return (await fulfill(existing.id, mpOrder)) || existing;
  if (mpOrderClosed(mpOrder)) return (await markCanceled(existing.id, mpOrder)) || existing;
  return existing;
}

async function reopenPending(orderId) {
  await supabase.from("orders").update({ status: "pending" }).eq("id", orderId).eq("status", "canceled");
}

async function settleOrder(existing) {
  if (!existing) return existing;
  if (existing.status === "paid") return existing;
  const token = await accessTokenForShop(existing.shop_id);
  if (!token) return existing;
  const mpId = mpOrderId(existing.stripe_session_id);
  let mpOrder = null;
  if (mpId) {
    try {
      mpOrder = await getMpOrder(token, mpId);
    } catch (error) {
      console.error("Consulta do Mercado Pago:", error.message);
    }
  }
  if (!mpOrderPaid(mpOrder)) {
    try {
      mpOrder = (await searchMpOrderByRef(token, existing.id)) || mpOrder;
    } catch (error) {
      console.error("Busca do Mercado Pago:", error.message);
    }
  }
  if (!mpOrder) return existing;
  return applyMpOrder(existing, mpOrder);
}

async function loadOrderBySession(sessionId) {
  const id = String(sessionId || "").trim();
  if (!id) return null;
  const byId = (await supabase.from("orders").select("*").eq("id", id).maybeSingle()).data;
  if (byId) return byId;
  return (await supabase.from("orders").select("*").eq("stripe_session_id", id).maybeSingle()).data;
}

async function rememberMpOrder(orderId, mpOrder) {
  const patch = { stripe_session_id: String(mpOrder?.id || "") };
  const paymentId = firstPaymentId(mpOrder);
  if (paymentId) patch.stripe_payment_intent = paymentId;
  await supabase.from("orders").update(patch).eq("id", orderId);
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

  const accessToken = await accessTokenForShop(store.shopId);
  const publicKey = shopPublicKey(store.shop);
  if (!accessToken || !publicKey) {
    json(response, 503, { error: "Falta configurar as chaves do Mercado Pago nas configurações da loja." });
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

  const orderRow = {
    shop_id: store.shopId,
    status: "pending",
    customer_name: name.slice(0, 80),
    customer_whatsapp: whatsapp,
    customer_mode: mode,
    customer_address: address.slice(0, 160),
    customer_notes: notes,
    items,
    total: payTotal,
    delivery_km: delivery ? delivery.km : null,
    delivery_fee: delivery ? delivery.fee : 0,
    whatsapp_text: text,
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
  if (orderError) {
    json(response, 500, { error: "Não foi possível gravar o pedido." });
    return;
  }

  json(response, 200, {
    sessionId: order.id,
    publicKey,
    payerEmail: checkoutEmail(order.id),
  });
}

async function shopCopy(shopId) {
  const withCopy = await supabase.from("shops").select("name, slug, paid_title, paid_message, whatsapp").eq("id", shopId).maybeSingle();
  if (!withCopy.error) return withCopy.data;
  return (await supabase.from("shops").select("name, slug, whatsapp").eq("id", shopId).maybeSingle()).data;
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
  const token = await accessTokenForShop(existing.shop_id);
  if (!token) {
    json(response, 503, { error: "Falta configurar as chaves do Mercado Pago nas configurações da loja." });
    return;
  }
  const order = await settleOrder(existing);
  const shop = await shopCopy(order.shop_id);
  const paid = order.status === "paid";
  const canceled = order.status === "canceled";
  const text = paid ? order.whatsapp_text || orderTextFromRow(shop, order) : "";
  json(response, 200, {
    paid,
    canceled,
    paidTitle: shop?.paid_title || paidTitle,
    paidMessage: shop?.paid_message || paidMessage,
    whatsappUrl: paid ? whatsappOrderUrl(shop, text) : "",
  });
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

function mpLocation(uf) {
  const state = String(uf || "").trim().toUpperCase();
  return state.length === 2 ? `BR-${state}` : "BR-SP";
}

function orderAmount(existing) {
  return moneyAmount(existing.total);
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
  const existing = await loadOrderBySession(payload.sessionId);
  if (!existing) {
    json(response, 404, { error: "Pedido não encontrado." });
    return;
  }
  if (existing.status === "paid") {
    json(response, 200, { paid: true, pixCopy: "", expiresAt: 0 });
    return;
  }
  if (existing.status === "canceled") await reopenPending(existing.id);
  const token = await accessTokenForShop(existing.shop_id);
  if (!token) {
    json(response, 503, { error: "Falta configurar as chaves do Mercado Pago nas configurações da loja." });
    return;
  }
  try {
    const currentId = mpOrderId(existing.stripe_session_id);
    if (currentId) {
      const previous = await getMpOrder(token, currentId).catch(() => null);
      if (previous) {
        if (mpOrderPaid(previous)) {
          await fulfill(existing.id, previous);
          json(response, 200, { paid: true, pixCopy: "", expiresAt: 0 });
          return;
        }
        const current = pixFromOrder(previous);
        if (current.expiresAt > Date.now()) {
          json(response, 200, current);
          return;
        }
        await cancelMpOrder(token, currentId).catch(() => {});
      }
    }
    const amount = orderAmount(existing);
    const payer = payerFromOrder(existing, checkoutEmail(existing.id));
    const shopKeys = (await supabase.from("shops").select("mp_public_key, stripe_publishable_key").eq("id", existing.shop_id).maybeSingle()).data;
    const publicKey = shopPublicKey({
      mpPublicKey: asMpKey(shopKeys?.mp_public_key) || asMpKey(shopKeys?.stripe_publishable_key),
    });
    if (isMpTestMode(publicKey, token)) payer.first_name = "APRO";
    let created = await createMpOrder(token, {
      type: "online",
      processing_mode: "automatic",
      total_amount: amount,
      external_reference: existing.id,
      description: "Pedido",
      payer,
      config: { location: { state_id: mpLocation() } },
      transactions: {
        payments: [
          {
            amount,
            payment_method: { id: "pix", type: "bank_transfer" },
            expiration_time: "PT30M",
          },
        ],
      },
    });
    if (created?.id && !mpOrderPaid(created) && !pixFromOrder(created).pixCopy) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
      created = (await getMpOrder(token, created.id).catch(() => null)) || created;
    }
    await rememberMpOrder(existing.id, created);
    if (mpOrderPaid(created)) {
      await fulfill(existing.id, created);
      json(response, 200, { paid: true, pixCopy: "", expiresAt: 0 });
      return;
    }
    const pix = pixFromOrder(created);
    if (!pix.pixCopy) {
      json(response, 500, { error: "Não foi possível gerar o Pix." });
      return;
    }
    json(response, 200, pix);
  } catch (error) {
    console.error("Pix:", error.message);
    json(response, 500, { error: mpPublicError(error, "Não foi possível gerar o Pix.") });
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
  const existing = await loadOrderBySession(payload.sessionId);
  if (!existing) {
    json(response, 404, { error: "Pedido não encontrado." });
    return;
  }
  if (existing.status === "paid") {
    json(response, 200, { paid: true });
    return;
  }
  if (existing.status === "canceled") await reopenPending(existing.id);
  const token = String(payload.token || "").trim();
  const paymentMethodId = String(payload.paymentMethodId || "").trim().toLowerCase();
  const paymentType = String(payload.paymentTypeId || "credit_card").trim().toLowerCase();
  const installments = 1;
  if (!token || !paymentMethodId) {
    json(response, 400, { error: "Informe os dados do cartão." });
    return;
  }
  const accessToken = await accessTokenForShop(existing.shop_id);
  if (!accessToken) {
    json(response, 503, { error: "Falta configurar as chaves do Mercado Pago nas configurações da loja." });
    return;
  }
  try {
    const currentId = mpOrderId(existing.stripe_session_id);
    if (currentId) {
      const previous = await getMpOrder(accessToken, currentId).catch(() => null);
      if (previous && mpOrderPaid(previous)) {
        await fulfill(existing.id, previous);
        json(response, 200, { paid: true });
        return;
      }
      if (previous && !mpOrderPaid(previous)) {
        await cancelMpOrder(accessToken, currentId).catch(() => {});
      }
    }
    const amount = orderAmount(existing);
    const identification = payload.identification && payload.identification.number
      ? {
          type: String(payload.identification.type || "CPF").toUpperCase(),
          number: String(payload.identification.number || "").replace(/\D/g, ""),
        }
      : null;
    const payer = payerFromOrder(existing, checkoutEmail(existing.id));
    if (identification) payer.identification = identification;
    const created = await createMpOrder(accessToken, {
      type: "online",
      processing_mode: "automatic",
      total_amount: amount,
      external_reference: existing.id,
      description: "Pedido",
      payer,
      config: { location: { state_id: mpLocation() } },
      transactions: {
        payments: [
          {
            amount,
            payment_method: {
              id: paymentMethodId,
              type: paymentType === "debit_card" ? "debit_card" : "credit_card",
              token,
              installments,
            },
          },
        ],
      },
    });
    await rememberMpOrder(existing.id, created);
    if (mpOrderPaid(created)) {
      await fulfill(existing.id, created);
      json(response, 200, { paid: true });
      return;
    }
    json(response, 400, {
      error: "O pagamento não foi aprovado. Tente outro cartão ou Pix.",
    });
  } catch (error) {
    console.error("Cartão:", error.message);
    json(response, 400, { error: mpPublicError(error, "Não foi possível pagar com cartão.") });
  }
}

async function findOrderFromMp(data = {}) {
  const orderId = String(data.external_reference || "").trim();
  const mpId = mpOrderId(data.id);
  if (orderId) {
    const { data: row } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
    if (row) return row;
  }
  if (mpId) {
    const { data: row } = await supabase.from("orders").select("*").eq("stripe_session_id", mpId).maybeSingle();
    if (row) return row;
  }
  return null;
}

async function handleWebhook(request, response, url) {
  if (!supabase) {
    json(response, 200, { received: true });
    return;
  }
  const raw = await readBody(request, 262144);
  let event;
  try {
    event = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    json(response, 400, { error: "Webhook inválido." });
    return;
  }

  const type = String(event.type || url.searchParams.get("type") || "").toLowerCase();
  const data = event.data && typeof event.data === "object" ? event.data : {};
  const mpId = mpOrderId(data.id || url.searchParams.get("data.id") || url.searchParams.get("id"));
  if (type && type !== "order" && !mpId && !data.external_reference) {
    json(response, 200, { received: true });
    return;
  }

  const existing = await findOrderFromMp({ ...data, id: mpId || data.id });
  if (!existing) {
    json(response, 200, { received: true });
    return;
  }
  if (existing.status === "paid") {
    json(response, 200, { received: true });
    return;
  }

  try {
    const current = {
      ...existing,
      stripe_session_id: mpId || existing.stripe_session_id,
    };
    const settled = await settleOrder(current);
    if (settled?.status === "pending") await applyMpOrder(current, data);
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
  const localTest = isMpTestMode(envMpPublicKey(), envMpAccessToken());
  console.log(`Pagamento em http://127.0.0.1:${port}${localTest ? " · Mercado Pago teste (.env.server)" : ""}`);
});
