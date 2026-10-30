import "./env.js";
import http from "node:http";
import Stripe from "stripe";
import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";
import { paidMessage, paidTitle } from "../src/config.js";
import { checkoutEmail, fullPhone, validPhone } from "../src/format.js";
import { buildOrderText, paymentKindFromStripe } from "../src/order.js";
import { cents, quoteCart } from "./quote.js";
import { sendShopDiscord } from "./discord.js";
import { isShopPage, sendShopPage } from "./shopPage.js";

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
const stripeClients = new Map();
const notifiedOrders = new Set();

async function loadShopSecrets(shopId) {
  if (!supabase || !shopId) return { stripeSecret: "", discordWebhook: "" };
  const { data, error } = await supabase.from("shop_secrets").select("*").eq("shop_id", shopId).maybeSingle();
  if (error || !data) return { stripeSecret: "", discordWebhook: "" };
  return {
    stripeSecret: String(data.stripe_secret_key || "").trim(),
    discordWebhook: String(data.discord_webhook_url || "").trim(),
  };
}

async function stripeForShop(shopId) {
  const { stripeSecret } = await loadShopSecrets(shopId);
  if (!stripeSecret) return null;
  if (!stripeClients.has(stripeSecret)) stripeClients.set(stripeSecret, new Stripe(stripeSecret));
  return stripeClients.get(stripeSecret);
}

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function originFrom(request, payload = {}) {
  const header = String(request.headers.origin || request.headers.referer || "").replace(/\/$/, "");
  if (header) {
    try {
      return new URL(header).origin;
    } catch {
      return header;
    }
  }
  if (payload.origin) return String(payload.origin).replace(/\/$/, "");
  return "http://127.0.0.1:5173";
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
      open: shop.is_open !== false,
      stripePublishableKey: shop.stripe_publishable_key || "",
      paidTitle: shop.paid_title || paidTitle,
      paidMessage: shop.paid_message || paidMessage,
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
    })),
    itemTypes: (itemTypes || []).map((type) => ({
      id: type.id,
      name: type.name,
      groups: type.groups || [],
    })),
    categories: categories || [],
  };
}

async function detectPayment(session, client) {
  const stripeClient = client;
  const intentId =
    typeof session.payment_intent === "string"
      ? session.payment_intent
      : session.payment_intent?.id || "";
  if (!intentId || !stripeClient) return "card";
  try {
    const intent = await stripeClient.paymentIntents.retrieve(intentId, {
      expand: ["payment_method", "latest_charge"],
    });
    const charge = typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    const method = typeof intent.payment_method === "object" ? intent.payment_method : null;
    return paymentKindFromStripe({
      type: charge?.payment_method_details?.type || method?.type || "",
      wallet: charge?.payment_method_details?.card?.wallet?.type || method?.card?.wallet?.type || "",
    });
  } catch (error) {
    console.error("Forma de pagamento:", error.message);
    return "card";
  }
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
  });
}

function stripeCustomerMeta(order) {
  return {
    customer_name: String(order.customer_name || "").slice(0, 500),
    customer_whatsapp: String(order.customer_whatsapp || "").slice(0, 500),
    customer_mode: String(order.customer_mode || "").slice(0, 40),
    customer_address: String(order.customer_address || "").slice(0, 500),
  };
}

async function fulfill(session, client) {
  if (!session || session.payment_status !== "paid") return null;
  const orderId = session.metadata?.order_id;
  if (!orderId) return null;
  const paidAt = new Date().toISOString();
  const payment = await detectPayment(session, client);
  const { data, error } = await supabase
    .from("orders")
    .update({
      status: "paid",
      paid_at: paidAt,
      stripe_payment_intent: String(session.payment_intent || ""),
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

async function fulfillPaidIntent(orderId, intentId, client) {
  if (!orderId || !intentId) return null;
  return fulfill(
    {
      payment_status: "paid",
      payment_intent: intentId,
      metadata: { order_id: orderId },
    },
    client,
  );
}

async function settleOrder(existing, client) {
  if (!existing || !client) return existing;
  if (existing.status === "paid") return existing;
  if (existing.stripe_payment_intent) {
    try {
      const intent = await client.paymentIntents.retrieve(existing.stripe_payment_intent);
      if (intent.status === "succeeded") {
        return (await fulfillPaidIntent(existing.id, intent.id, client)) || existing;
      }
    } catch (error) {
      console.error("Consulta do Pix:", error.message);
    }
  }
  if (!existing.stripe_session_id) return existing;
  const session = await client.checkout.sessions.retrieve(existing.stripe_session_id, { expand: ["payment_intent"] });
  return (await fulfill(session, client)) || existing;
}

async function createCheckout(request, response) {
  if (!supabase) {
    json(response, 503, {
      error: "Falta configurar SUPABASE_SERVICE_ROLE_KEY no arquivo .env.server.",
    });
    return;
  }

  const payload = JSON.parse((await readBody(request)).toString("utf8") || "{}");
  const slug = String(payload.slug || "").trim();
  const customer = payload.customer || {};
  const name = String(customer.name || "").trim();
  const whatsapp = fullPhone(customer.whatsapp);
  const mode = customer.mode === "entrega" ? "entrega" : "retirada";
  const address = String(customer.address || "").trim();
  const notes = String(customer.notes || "").trim().slice(0, 200);

  if (name.length < 2) {
    json(response, 400, { error: "Informe seu nome." });
    return;
  }
  if (!validPhone(whatsapp)) {
    json(response, 400, { error: "Informe um WhatsApp válido, com DDD." });
    return;
  }
  if (mode === "entrega" && address.length < 6) {
    json(response, 400, { error: "Informe o endereço da entrega." });
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

  const shopStripe = await stripeForShop(store.shopId);
  const publishableKey = store.shop.stripePublishableKey;
  if (!shopStripe || !publishableKey) {
    json(response, 503, { error: "Falta configurar as chaves Stripe nas configurações da loja." });
    return;
  }

  const quoted = quoteCart(store, payload);
  if (quoted.error) {
    json(response, 400, { error: quoted.error });
    return;
  }

  const text = buildOrderText({
    shop: store.shop,
    customer: { name, whatsapp, mode, address, notes },
    lines: quoted.lines,
    total: quoted.total,
    paid: true,
  });

  const orderRow = {
    shop_id: store.shopId,
    status: "pending",
    customer_name: name.slice(0, 80),
    customer_whatsapp: whatsapp,
    customer_mode: mode,
    customer_address: address.slice(0, 160),
    customer_notes: notes,
    items: quoted.lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      qty: line.qty,
      note: line.note,
      options: line.options,
      total: line.total,
    })),
    total: quoted.total,
    whatsapp_text: text,
  };

  let { data: order, error: orderError } = await supabase.from("orders").insert(orderRow).select("*").single();
  if (orderError && /customer_whatsapp/i.test(orderError.message || "")) {
    const { customer_whatsapp: _phone, ...rest } = orderRow;
    ({ data: order, error: orderError } = await supabase.from("orders").insert(rest).select("*").single());
  }
  if (orderError) {
    json(response, 500, { error: "Não foi possível gravar o pedido." });
    return;
  }

  const origin = originFrom(request, payload);
  const returnUrl = `${origin}/loja/${encodeURIComponent(slug)}/pedido-pago?session_id={CHECKOUT_SESSION_ID}`;

  try {
    const session = await shopStripe.checkout.sessions.create({
      mode: "payment",
      ui_mode: "custom",
      locale: "pt-BR",
      customer_email: checkoutEmail(whatsapp),
      customer_creation: "if_required",
      name_collection: { individual: { enabled: false } },
      return_url: returnUrl,
      payment_method_types: ["card"],
      payment_method_options: {
        card: {
          request_three_d_secure: "automatic",
        },
      },
      expand: ["payment_intent"],
      metadata: {
        order_id: order.id,
        shop_id: store.shopId,
        shop_slug: slug,
        ...stripeCustomerMeta(order),
      },
      payment_intent_data: {
        metadata: {
          order_id: order.id,
          shop_id: store.shopId,
          shop_slug: slug,
          ...stripeCustomerMeta(order),
        },
      },
      line_items: quoted.lines.map((line) => ({
        quantity: line.qty,
        price_data: {
          currency: "brl",
          unit_amount: cents(line.unit),
          product_data: {
            name: line.name,
            description: line.options.map((option) => option.name).join(", ").slice(0, 500) || undefined,
          },
        },
      })),
    });

    let intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
    if (!intent?.client_secret) {
      const intentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
      if (intentId) intent = await shopStripe.paymentIntents.retrieve(intentId);
    }
    await supabase.from("orders").update({ stripe_session_id: session.id }).eq("id", order.id);
    json(response, 200, {
      clientSecret: session.client_secret,
      paymentIntentSecret: intent?.client_secret || "",
      sessionId: session.id,
      orderId: order.id,
      publishableKey,
      returnUrl: `${origin}/loja/${encodeURIComponent(slug)}/pedido-pago?session_id=${encodeURIComponent(session.id)}`,
    });
  } catch (error) {
    await supabase.from("orders").update({ status: "canceled" }).eq("id", order.id);
    json(response, 500, { error: error.message || "Não foi possível iniciar o pagamento." });
  }
}

async function shopCopy(shopId) {
  const withCopy = await supabase.from("shops").select("name, slug, paid_title, paid_message").eq("id", shopId).maybeSingle();
  if (!withCopy.error) return withCopy.data;
  return (await supabase.from("shops").select("name, slug").eq("id", shopId).maybeSingle()).data;
}

async function readSession(request, response, url) {
  if (!supabase) {
    json(response, 503, { error: "Pagamento ainda não está configurado no servidor." });
    return;
  }
  const sessionId = url.searchParams.get("session_id") || "";
  if (!sessionId.startsWith("cs_")) {
    json(response, 400, { error: "Sessão de pagamento inválida." });
    return;
  }
  const existing = (await supabase.from("orders").select("*").eq("stripe_session_id", sessionId).maybeSingle()).data;
  const client = existing ? await stripeForShop(existing.shop_id) : null;
  if (!existing) {
    json(response, 404, { error: "Pedido não encontrado." });
    return;
  }
  if (!client) {
    json(response, 503, { error: "Falta configurar as chaves Stripe nas configurações da loja." });
    return;
  }
  const order = await settleOrder(existing, client);
  const shop = await shopCopy(order.shop_id);
  const paid = order.status === "paid";
  json(response, 200, {
    paid,
    sent: Boolean(order.whatsapp_sent_at),
    shopName: shop?.name || "",
    paidTitle: shop?.paid_title || paidTitle,
    paidMessage: shop?.paid_message || paidMessage,
    pixCopy: "",
  });
}

const PIX_SECONDS = 15 * 60;

function pixFromIntent(intent) {
  if (!intent) return { paid: false, pixCopy: "", expiresAt: 0 };
  if (intent.status === "succeeded") return { paid: true, pixCopy: "", expiresAt: 0 };
  const pix = intent.next_action?.pix_display_qr_code;
  const expiresAt =
    Number(pix?.expires_at || 0) * 1000 ||
    (Number(intent.created || 0) * 1000 + PIX_SECONDS * 1000);
  const alive = Boolean(pix?.data) && expiresAt > Date.now();
  return {
    paid: false,
    pixCopy: alive ? pix.data : "",
    expiresAt: alive ? expiresAt : 0,
  };
}

async function createPix(request, response) {
  if (!supabase) {
    json(response, 503, { error: "Pagamento ainda não está configurado no servidor." });
    return;
  }
  const payload = JSON.parse((await readBody(request)).toString("utf8") || "{}");
  const sessionId = String(payload.sessionId || "");
  if (!sessionId.startsWith("cs_")) {
    json(response, 400, { error: "Sessão de pagamento inválida." });
    return;
  }
  const existing = (await supabase.from("orders").select("*").eq("stripe_session_id", sessionId).maybeSingle()).data;
  if (!existing) {
    json(response, 404, { error: "Pedido não encontrado." });
    return;
  }
  if (existing.status === "paid") {
    json(response, 200, { paid: true, pixCopy: "" });
    return;
  }
  const shopStripe = await stripeForShop(existing.shop_id);
  if (!shopStripe) {
    json(response, 503, { error: "Falta configurar as chaves Stripe nas configurações da loja." });
    return;
  }
  try {
    if (existing.stripe_payment_intent) {
      const previous = await shopStripe.paymentIntents.retrieve(existing.stripe_payment_intent);
      const current = pixFromIntent(previous);
      if (current.paid) {
        await fulfillPaidIntent(existing.id, previous.id, shopStripe);
        json(response, 200, { paid: true, pixCopy: "", expiresAt: 0 });
        return;
      }
      if (current.pixCopy) {
        json(response, 200, current);
        return;
      }
      if (previous.status !== "canceled" && previous.status !== "succeeded") {
        await shopStripe.paymentIntents.cancel(previous.id).catch(() => {});
      }
    }
    const confirmed = await shopStripe.paymentIntents.create({
      amount: cents(existing.total),
      currency: "brl",
      payment_method_types: ["pix"],
      payment_method_data: { type: "pix" },
      payment_method_options: { pix: { expires_after_seconds: PIX_SECONDS } },
      confirm: true,
      metadata: {
        order_id: existing.id,
        shop_id: existing.shop_id,
        ...stripeCustomerMeta(existing),
      },
    });
    await supabase.from("orders").update({ stripe_payment_intent: confirmed.id }).eq("id", existing.id);
    json(response, 200, pixFromIntent(confirmed));
  } catch (error) {
    json(response, 500, { error: error.message || "Não foi possível gerar o Pix." });
  }
}

async function findOrderFromEvent(object = {}) {
  const sessionId = String(object.id || "").startsWith("cs_") ? object.id : "";
  const intentId = String(object.id || "").startsWith("pi_")
    ? object.id
    : typeof object.payment_intent === "string"
      ? object.payment_intent
      : object.payment_intent?.id || "";
  const orderId = String(object.metadata?.order_id || "");
  if (orderId) {
    const { data } = await supabase.from("orders").select("id, shop_id, stripe_session_id").eq("id", orderId).maybeSingle();
    if (data) return data;
  }
  if (sessionId) {
    const { data } = await supabase.from("orders").select("id, shop_id, stripe_session_id").eq("stripe_session_id", sessionId).maybeSingle();
    if (data) return data;
  }
  if (intentId) {
    const { data } = await supabase.from("orders").select("id, shop_id, stripe_session_id").eq("stripe_payment_intent", intentId).maybeSingle();
    if (data) return data;
  }
  return null;
}

async function handleWebhook(request, response) {
  if (!supabase) {
    json(response, 200, { received: true });
    return;
  }
  const raw = await readBody(request);
  let event;
  try {
    event = JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    json(response, 400, { error: "Webhook inválido." });
    return;
  }

  const type = String(event.type || "");
  const object = event.data?.object || {};
  const useful =
    type === "checkout.session.completed" ||
    type === "checkout.session.async_payment_succeeded" ||
    type === "payment_intent.succeeded";
  if (!useful) {
    json(response, 200, { received: true });
    return;
  }

  const order = await findOrderFromEvent(object);
  const shopId = order?.shop_id || String(object.metadata?.shop_id || "");
  const client = await stripeForShop(shopId);
  if (!client) {
    json(response, 200, { received: true });
    return;
  }

  if (type === "payment_intent.succeeded") {
    const orderId = order?.id || String(object.metadata?.order_id || "");
    await fulfillPaidIntent(orderId, object.id, client);
    json(response, 200, { received: true });
    return;
  }

  let sessionId = String(object.id || "").startsWith("cs_") ? object.id : order?.stripe_session_id || "";
  if (!sessionId && String(object.payment_intent || "").startsWith("pi_")) {
    const listed = await client.checkout.sessions.list({ payment_intent: object.payment_intent, limit: 1 });
    sessionId = listed.data[0]?.id || "";
  }
  if (!sessionId) {
    json(response, 200, { received: true });
    return;
  }

  const session = await client.checkout.sessions.retrieve(sessionId);
  await fulfill(session, client);
  json(response, 200, { received: true });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/health") {
      json(response, 200, {
        ok: true,
        database: Boolean(supabase),
      });
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/create-checkout") {
      await createCheckout(request, response);
      return;
    }
    if (request.method === "GET" && url.pathname === "/api/checkout-session") {
      await readSession(request, response, url);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/create-pix") {
      await createPix(request, response);
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/stripe-webhook") {
      await handleWebhook(request, response);
      return;
    }
    if (isShopPage(request.method, url.pathname)) {
      await sendShopPage(request, response, url, supabase);
      return;
    }
    json(response, 404, { error: "Rota não encontrada." });
  } catch (error) {
    json(response, 500, { error: error.message || "Erro no servidor de pagamento." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Pagamento em http://127.0.0.1:${port}`);
});
