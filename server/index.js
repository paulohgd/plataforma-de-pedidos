import "./env.js";
import http from "node:http";
import Stripe from "stripe";
import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";
import { paidMessage, paidTitle } from "../src/config.js";
import { buildOrderText, paymentKindFromStripe, withPaidPayment } from "../src/order.js";
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
    data.whatsapp_text = withPaidPayment(data.whatsapp_text, payment);
    await supabase.from("orders").update({ whatsapp_text: data.whatsapp_text }).eq("id", data.id);
    const shop = (await supabase.from("shops").select("name").eq("id", data.shop_id).maybeSingle()).data;
    const secrets = await loadShopSecrets(data.shop_id);
    const sent = await sendShopDiscord(shop, data.whatsapp_text, secrets.discordWebhook);
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
  const mode = customer.mode === "entrega" ? "entrega" : "retirada";
  const address = String(customer.address || "").trim();
  const notes = String(customer.notes || "").trim().slice(0, 200);

  if (name.length < 2) {
    json(response, 400, { error: "Informe seu nome." });
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
    customer: { name, mode, address, notes },
    lines: quoted.lines,
    total: quoted.total,
    paid: true,
  });

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .insert({
      shop_id: store.shopId,
      status: "pending",
      customer_name: name.slice(0, 80),
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
    })
    .select("*")
    .single();
  if (orderError) {
    json(response, 500, { error: "Não foi possível gravar o pedido." });
    return;
  }

  const origin = originFrom(request, payload);
  const returnUrl = `${origin}/loja/${encodeURIComponent(slug)}/pedido-pago?session_id={CHECKOUT_SESSION_ID}`;

  try {
    const session = await shopStripe.checkout.sessions.create({
      mode: "payment",
      ui_mode: "embedded",
      locale: "pt-BR",
      customer_creation: "if_required",
      return_url: returnUrl,
      metadata: {
        order_id: order.id,
        shop_id: store.shopId,
        shop_slug: slug,
      },
      payment_intent_data: {
        metadata: {
          order_id: order.id,
          shop_id: store.shopId,
          shop_slug: slug,
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

    await supabase.from("orders").update({ stripe_session_id: session.id }).eq("id", order.id);
    json(response, 200, {
      clientSecret: session.client_secret,
      sessionId: session.id,
      orderId: order.id,
      publishableKey,
    });
  } catch (error) {
    await supabase.from("orders").update({ status: "canceled" }).eq("id", order.id);
    json(response, 500, { error: error.message || "Não foi possível iniciar o pagamento." });
  }
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
  const existing = (await supabase.from("orders").select("shop_id").eq("stripe_session_id", sessionId).maybeSingle()).data;
  const client = await stripeForShop(existing?.shop_id);
  if (!client) {
    json(response, 503, { error: "Falta configurar as chaves Stripe nas configurações da loja." });
    return;
  }
  const session = await client.checkout.sessions.retrieve(sessionId);
  const order = await fulfill(session, client);
  let shop = null;
  if (order) {
    const withCopy = await supabase.from("shops").select("name, slug, paid_title, paid_message").eq("id", order.shop_id).maybeSingle();
    shop = withCopy.error
      ? (await supabase.from("shops").select("name, slug").eq("id", order.shop_id).maybeSingle()).data
      : withCopy.data;
  }
  const paid = Boolean(order && order.status === "paid");
  json(response, 200, {
    paid,
    sent: Boolean(order?.whatsapp_sent_at),
    shopName: shop?.name || "",
    paidTitle: shop?.paid_title || paidTitle,
    paidMessage: shop?.paid_message || paidMessage,
  });
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

  let sessionId = order?.stripe_session_id || "";
  if (String(object.id || "").startsWith("cs_")) sessionId = object.id;
  if (!sessionId && String(object.id || "").startsWith("pi_")) {
    const listed = await client.checkout.sessions.list({ payment_intent: object.id, limit: 1 });
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
