import "./env.js";
import http from "node:http";
import Stripe from "stripe";
import WebSocket from "ws";
import { createClient } from "@supabase/supabase-js";
import { paidMessage, paidTitle } from "../src/config.js";
import { buildOrderText, paymentKindFromStripe, withPaidPayment } from "../src/order.js";
import { cents, quoteCart } from "./quote.js";
import { sendShopDiscord } from "./discord.js";

const port = Number(process.env.PORT) || 8787;
const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const stripe = stripeSecret ? new Stripe(stripeSecret) : null;
const supabase =
  supabaseUrl && serviceKey
    ? createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        realtime: { transport: WebSocket },
      })
    : null;
const discordReady = String(process.env.DISCORD_WEBHOOK_URL || "").startsWith("https://discord.com/api/webhooks/");
const platformPublishable = process.env.VITE_STRIPE_PUBLISHABLE_KEY || "";
const stripeClients = new Map();
const notifiedOrders = new Set();

async function stripeForShop(shopId) {
  let shopKey = "";
  if (supabase && shopId) {
    const { data, error } = await supabase.from("shop_secrets").select("stripe_secret_key").eq("shop_id", shopId).maybeSingle();
    if (!error) shopKey = String(data?.stripe_secret_key || "").trim();
  }
  const key = shopKey || stripeSecret;
  if (!key) return null;
  if (!stripeClients.has(key)) stripeClients.set(key, new Stripe(key));
  return stripeClients.get(key);
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
  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase.from("categories").select("*").eq("shop_id", shop.id),
    supabase.from("products").select("*").eq("shop_id", shop.id),
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
    categories: categories || [],
  };
}

async function detectPayment(session, client) {
  const stripeClient = client || stripe;
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
  if (!session || (session.payment_status !== "paid" && session.status !== "complete")) return null;
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
    const sent = await sendShopDiscord(shop, data.whatsapp_text);
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
  const publishableKey = store.shop.stripePublishableKey || platformPublishable;
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
    json(response, 200, { clientSecret: session.client_secret, orderId: order.id, publishableKey });
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
  const client = (await stripeForShop(existing?.shop_id)) || stripe;
  if (!client) {
    json(response, 503, { error: "Pagamento ainda não está configurado no servidor." });
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

async function handleWebhook(request, response) {
  if (!stripe || !supabase || !webhookSecret) {
    json(response, 503, { error: "Webhook sem STRIPE_WEBHOOK_SECRET." });
    return;
  }
  const raw = await readBody(request);
  const signature = request.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(raw, signature, webhookSecret);
  } catch {
    json(response, 400, { error: "Assinatura do webhook inválida." });
    return;
  }
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    await fulfill(event.data.object, stripe);
  }
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
        stripe: Boolean(stripe),
        database: Boolean(supabase),
        discord: discordReady,
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
    json(response, 404, { error: "Rota não encontrada." });
  } catch (error) {
    json(response, 500, { error: error.message || "Erro no servidor de pagamento." });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Pagamento em http://127.0.0.1:${port}`);
});
