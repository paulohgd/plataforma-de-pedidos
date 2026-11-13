import { paidMessage, paidTitle, shop as defaultShop } from "./config";
import { asStripePublishableKey, asStripeSecretKey, isStripeSecretKey } from "./stripeKeys";
import { saoPauloDayBounds, slugify } from "./format";
import { cleanCoupons } from "./coupons";
import { cleanDeliveryFees, cleanDeliveryMaxKm, cleanMinOrder, defaultDeliveryFees } from "./freight";
import { cloneItemType, seedCategories, seedItemTypes, seedProducts } from "./menu";
import { supabase } from "./supabase";

export function explain(error) {
  const code = error?.code || "";
  const message = error?.message || "";
  if (/slug/i.test(message) && /column|schema cache/i.test(message)) {
    return "Falta atualizar a base. Rode o schema.sql de novo no Supabase.";
  }
  if (code === "PGRST205" || code === "42P01" || /schema cache/i.test(message) || /shop_secrets|paid_title|stripe_publishable|mp_public|mp_access|item_types|\bactive\b|\blogo\b|\bcep\b|min_order|delivery_max|delivery_fees|\bcoupons\b|notify_whatsapp|notify_discord/i.test(message)) {
    return "Falta atualizar a base. Rode o schema.sql de novo no Supabase.";
  }
  if (code === "23503") return "Essa categoria ainda tem produtos vinculados.";
  if (/shops_slug_key|slug taken/i.test(message)) return "Já existe uma loja com esse endereço. Escolha outro nome.";
  if (/invalid slug/i.test(message)) return "O nome da loja precisa ter letras ou números.";
  if (code === "23505" || /shop exists/i.test(message)) return "Esta conta já tem uma loja.";
  if (code === "PGRST202") return "A base ainda não permite apagar a conta. Rode o SQL da loja de novo.";
  if (/bucket not found/i.test(message)) return "O espaço de fotos ainda não foi criado no Supabase.";
  if (/not authenticated/i.test(message) || code === "PGRST301") return "Sua sessão expirou. Entre de novo.";
  return "Não foi possível salvar agora.";
}

export function explainAuth(error) {
  const message = error?.message || "";
  if (/invalid login credentials/i.test(message)) return "E-mail ou senha não conferem.";
  if (/already registered|already been registered/i.test(message)) return "Já existe uma conta com esse e-mail.";
  if (/email not confirmed/i.test(message)) return "Confirme o e-mail antes de entrar.";
  if (/otp_expired|expired|invalid/i.test(message) && /link|otp|email/i.test(message)) {
    return "Este link de confirmação já foi usado ou expirou. Peça outro e-mail ou entre se a conta já estiver confirmada.";
  }
  if (/password/i.test(message)) return "A senha precisa ter pelo menos 6 caracteres.";
  return "Não foi possível acessar agora.";
}

function toItemTypes(rows) {
  if (!rows?.length) return seedItemTypes.map(cloneItemType);
  return rows.map((row) =>
    cloneItemType({
      id: row.id,
      name: row.name,
      groups: row.groups,
    }),
  );
}

function toStore(shop, categories, products, itemTypes) {
  return {
    shopId: shop.id,
    ownerId: shop.owner_id,
    shop: {
      name: shop.name,
      slug: shop.slug || slugify(shop.name),
      whatsapp: shop.whatsapp || "",
      address: shop.address || "",
      cep: shop.cep || "",
      hours: shop.hours || "",
      open: shop.is_open !== false,
      openLabel: shop.open_label || defaultShop.openLabel,
      closedLabel: shop.closed_label || defaultShop.closedLabel,
      mpPublicKey: asStripePublishableKey(shop.stripe_publishable_key) || asStripePublishableKey(shop.mp_public_key),
      stripePublishableKey:
        asStripePublishableKey(shop.stripe_publishable_key) || asStripePublishableKey(shop.mp_public_key),
      paidTitle: shop.paid_title || paidTitle,
      paidMessage: shop.paid_message || paidMessage,
      logo: shop.logo || "",
      minOrder: cleanMinOrder(shop.min_order),
      deliveryMaxKm: cleanDeliveryMaxKm(shop.delivery_max_km),
      deliveryFees: cleanDeliveryFees(shop.delivery_fees?.length ? shop.delivery_fees : defaultDeliveryFees),
      coupons: cleanCoupons(shop.coupons),
      notifyWhatsapp: shop.notify_whatsapp !== false,
      notifyDiscord: shop.notify_discord === true,
    },
    categories: (categories || []).map((category) => ({ id: category.id, name: category.name })),
    products: (products || []).map((product) => ({
      id: product.id,
      category: product.category_id,
      kind: product.kind,
      name: product.name,
      description: product.description || "",
      price: Number(product.price),
      image: product.image || "",
      featured: Boolean(product.featured),
      featuredRank: Number(product.featured_rank) || 0,
      active: product.active !== false,
    })),
    itemTypes: toItemTypes(itemTypes),
  };
}

function toSummary(shop) {
  return {
    id: shop.id,
    slug: shop.slug || slugify(shop.name),
    ownerId: shop.owner_id,
    name: shop.name,
    address: shop.address || "",
    hours: shop.hours || "",
    open: shop.is_open !== false,
    openLabel: shop.open_label || defaultShop.openLabel,
    closedLabel: shop.closed_label || defaultShop.closedLabel,
    logo: shop.logo || "",
  };
}

function missingItemTypes(error) {
  const message = error?.message || "";
  return /item_types/i.test(message) && /relation|schema cache|does not exist/i.test(message);
}

async function loadShop(shop) {
  if (!shop) return { error: "", store: null };

  const [categoriesResult, productsResult, typesResult] = await Promise.all([
    supabase.from("categories").select("*").eq("shop_id", shop.id).order("position"),
    supabase.from("products").select("*").eq("shop_id", shop.id).order("position"),
    supabase.from("item_types").select("*").eq("shop_id", shop.id).order("position"),
  ]);
  if (categoriesResult.error) return { error: explain(categoriesResult.error), store: null };
  if (productsResult.error) return { error: explain(productsResult.error), store: null };
  if (typesResult.error && !missingItemTypes(typesResult.error)) {
    return { error: explain(typesResult.error), store: null };
  }
  return {
    error: "",
    store: toStore(shop, categoriesResult.data, productsResult.data, typesResult.error ? [] : typesResult.data),
  };
}

export async function fetchShops() {
  const { data, error } = await supabase.from("shops").select("*").order("name");
  if (error) return { error: explain(error), shops: [] };
  return { error: "", shops: (data || []).map(toSummary) };
}

function missingSlugColumn(error) {
  const message = error?.message || "";
  return /slug/i.test(message) && /column|schema cache/i.test(message);
}

export async function fetchStoreBySlug(slug) {
  const { data: shop, error } = await supabase.from("shops").select("*").eq("slug", slug).maybeSingle();
  if (error && missingSlugColumn(error)) {
    const list = await fetchShops();
    if (list.error) return { error: list.error, store: null };
    const match = list.shops.find((item) => item.slug === slug);
    if (!match) return { error: "", store: null };
    const found = await supabase.from("shops").select("*").eq("id", match.id).maybeSingle();
    if (found.error) return { error: explain(found.error), store: null };
    return loadShop(found.data);
  }
  if (error) return { error: explain(error), store: null };
  return loadShop(shop);
}

export async function fetchStoreByOwner(ownerId) {
  const { data: shop, error } = await supabase.from("shops").select("*").eq("owner_id", ownerId).maybeSingle();
  if (error) return { error: explain(error), store: null };
  return loadShop(shop);
}

async function nextShopSlug(name) {
  const base = slugify(name);
  for (let index = 1; index <= 40; index += 1) {
    const slug = index === 1 ? base : `${base.slice(0, 44)}-${index}`;
    const { data, error } = await supabase.from("shops").select("id").eq("slug", slug).maybeSingle();
    if (error) return { error: explain(error), slug: "" };
    if (!data) return { error: "", slug };
  }
  return { error: "", slug: `${base.slice(0, 32)}-${Date.now().toString(36)}` };
}

export async function createSeedShop(name) {
  const shopName = String(name || defaultShop.name).trim() || defaultShop.name;
  const slugResult = await nextShopSlug(shopName);
  if (slugResult.error) return { error: slugResult.error, store: null };
  const shop = {
    name: shopName,
    slug: slugResult.slug,
    whatsapp: defaultShop.whatsapp,
    address: defaultShop.address,
    hours: defaultShop.hours,
    is_open: defaultShop.open,
    open_label: defaultShop.openLabel,
    closed_label: defaultShop.closedLabel,
  };
  const categories = seedCategories.map((category, position) => ({
    id: category.id,
    name: category.name,
    position,
  }));
  const products = seedProducts.map((product, position) => ({
    id: product.id,
    category_id: product.category,
    kind: product.kind,
    name: product.name,
    description: product.description,
    price: product.price,
    image: product.image,
    featured: Boolean(product.featured),
    featured_rank: Number(product.featuredRank) || 0,
    active: product.active !== false,
    position,
  }));
  let { error } = await supabase.rpc("create_store", { shop, categories, products });
  if (error && /featured_rank/i.test(error.message || "")) {
    const plain = products.map(({ featured_rank: _rank, ...product }) => product);
    ({ error } = await supabase.rpc("create_store", { shop, categories, products: plain }));
  }
  if (error && alreadyHasShop(error)) {
    const current = await supabase.auth.getUser();
    if (current.data?.user?.id) return fetchStoreByOwner(current.data.user.id);
  }
  if (error) return { error: explain(error), store: null };
  const created = await fetchStoreBySlug(shop.slug);
  if (created.store?.shopId) {
    await Promise.all(seedItemTypes.map((type, position) => upsertItemType(created.store.shopId, type, position)));
  }
  return created;
}

function alreadyHasShop(error) {
  const message = error?.message || "";
  const code = error?.code || "";
  return code === "23505" || /shop exists|duplicate key|shops_owner_id/i.test(message);
}

export async function deleteMyAccount(userId) {
  const listed = await supabase.storage.from("products").list(userId);
  if (!listed.error && listed.data?.length) {
    await supabase.storage.from("products").remove(listed.data.map((file) => `${userId}/${file.name}`));
  }
  const { error } = await supabase.rpc("delete_my_account");
  return error ? explain(error) : "";
}

export async function fetchShopSecretStatus(shopId) {
  const { data, error } = await supabase.from("shop_secrets").select("*").eq("shop_id", shopId).maybeSingle();
  if (error) return { error: explain(error), stripe: false, mercadoPago: false, discord: false };
  const stripe = Boolean(asStripeSecretKey(data?.stripe_secret_key));
  return {
    error: "",
    stripe,
    mercadoPago: stripe,
    discord: Boolean(String(data?.discord_webhook_url || "").trim()),
  };
}

export async function saveShopSecrets(shopId, { stripeSecretKey, mpAccessToken, discordWebhookUrl }) {
  const token = String(stripeSecretKey || mpAccessToken || "").trim();
  const discord = String(discordWebhookUrl || "").trim();
  if (token && !isStripeSecretKey(token)) {
    return "Cole a chave secreta da Stripe desta loja (sk_test_... ou sk_live_...).";
  }
  if (discord && !discord.startsWith("https://discord.com/api/webhooks/")) {
    return "O webhook do Discord deve começar com https://discord.com/api/webhooks/";
  }
  if (!token && !discord) return "";

  const { data: sessionData } = await supabase.auth.getSession();
  const access = sessionData?.session?.access_token || "";
  if (access) {
    try {
      const response = await fetch("/api/shop-secrets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${access}`,
        },
        body: JSON.stringify({ shopId, stripeSecretKey: token, discordWebhookUrl: discord }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return payload.error || "Não foi possível gravar a chave secreta da Stripe.";
      if (token && !payload.stripe) return "A chave secreta da Stripe não ficou salva.";
      return "";
    } catch (error) {
      console.error("shop_secrets api:", error.message || error);
    }
  }

  const patch = { updated_at: new Date().toISOString() };
  if (token) patch.stripe_secret_key = token;
  if (discord) patch.discord_webhook_url = discord;

  const { data: existing, error: lookupError } = await supabase
    .from("shop_secrets")
    .select("shop_id")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (lookupError) return explain(lookupError);

  async function write(target, extra = {}) {
    if (existing) {
      return supabase.from("shop_secrets").update({ ...target, ...extra }).eq("shop_id", shopId);
    }
    return supabase.from("shop_secrets").insert({
      shop_id: shopId,
      stripe_secret_key: "",
      discord_webhook_url: discord,
      updated_at: patch.updated_at,
      ...target,
      ...extra,
    });
  }

  const { error } = await write(patch);
  if (error) {
    console.error("shop_secrets:", error.message || error);
    return explain(error);
  }
  return "";
}

export async function saveShopRow(shopId, shop) {
  const fields = {
    name: shop.name,
    whatsapp: shop.whatsapp,
    address: shop.address,
    cep: shop.cep || "",
    hours: shop.hours,
    is_open: shop.open,
    open_label: shop.openLabel,
    closed_label: shop.closedLabel,
    mp_public_key: shop.mpPublicKey || shop.stripePublishableKey || "",
    stripe_publishable_key:
      asStripePublishableKey(shop.stripePublishableKey || shop.mpPublicKey) || "",
    paid_title: shop.paidTitle || paidTitle,
    paid_message: shop.paidMessage || paidMessage,
    logo: shop.logo || "",
    min_order: cleanMinOrder(shop.minOrder),
    delivery_max_km: cleanDeliveryMaxKm(shop.deliveryMaxKm),
    delivery_fees: cleanDeliveryFees(shop.deliveryFees),
    coupons: cleanCoupons(shop.coupons),
    notify_whatsapp: shop.notifyWhatsapp !== false,
    notify_discord: shop.notifyDiscord === true,
  };
  let { error } = await supabase.from("shops").update({ ...fields, slug: shop.slug }).eq("id", shopId);
  if (error && missingSlugColumn(error)) {
    ({ error } = await supabase.from("shops").update(fields).eq("id", shopId));
  }
  if (error && /\bcep\b/i.test(error.message || "") && /column|schema cache/i.test(error.message || "")) {
    const { cep: _cep, ...rest } = fields;
    ({ error } = await supabase.from("shops").update({ ...rest, slug: shop.slug }).eq("id", shopId));
  }
  if (error && /min_order|delivery_max_km|delivery_fees|\bcoupons\b/i.test(error.message || "") && /column|schema cache/i.test(error.message || "")) {
    const { min_order: _min, delivery_max_km: _max, delivery_fees: _fees, coupons: _coupons, ...rest } = fields;
    ({ error } = await supabase.from("shops").update({ ...rest, slug: shop.slug }).eq("id", shopId));
  }
  if (error && /mp_public_key/i.test(error.message || "") && /column|schema cache/i.test(error.message || "")) {
    const { mp_public_key: publicKey, ...rest } = fields;
    ({ error } = await supabase.from("shops").update({ ...rest, stripe_publishable_key: publicKey || "", slug: shop.slug }).eq("id", shopId));
  }
  if (error && /notify_whatsapp|notify_discord/i.test(error.message || "") && /column|schema cache/i.test(error.message || "")) {
    const { notify_whatsapp: _whatsapp, notify_discord: _discord, ...rest } = fields;
    ({ error } = await supabase.from("shops").update({ ...rest, slug: shop.slug }).eq("id", shopId));
  }
  return error ? explain(error) : "";
}

export async function saveProductOrder(shopId, ids) {
  const results = await Promise.all(
    ids.map((id, position) =>
      supabase.from("products").update({ position }).eq("shop_id", shopId).eq("id", id),
    ),
  );
  const fail = results.find((result) => result.error);
  return fail?.error ? explain(fail.error) : "";
}

export async function saveCategoryOrder(shopId, ids) {
  const results = await Promise.all(
    ids.map((id, position) =>
      supabase.from("categories").update({ position }).eq("shop_id", shopId).eq("id", id),
    ),
  );
  const fail = results.find((result) => result.error);
  return fail?.error ? explain(fail.error) : "";
}

export async function insertCategory(shopId, category, position) {
  const { error } = await supabase.from("categories").insert({
    shop_id: shopId,
    id: category.id,
    name: category.name,
    position,
  });
  return error ? explain(error) : "";
}

export async function updateCategoryName(shopId, id, name) {
  const { error } = await supabase.from("categories").update({ name }).eq("shop_id", shopId).eq("id", id);
  return error ? explain(error) : "";
}

export async function deleteCategory(shopId, id) {
  const { error } = await supabase.from("categories").delete().eq("shop_id", shopId).eq("id", id);
  return error ? explain(error) : "";
}

function missingFeaturedRank(error) {
  const message = error?.message || "";
  return /featured_rank/i.test(message) && /column|schema cache/i.test(message);
}

function missingActive(error) {
  const message = error?.message || "";
  return /\bactive\b/i.test(message) && /column|schema cache|Could not find/i.test(message);
}

function withoutMissingProductColumns(row, error) {
  let next = row;
  if (missingFeaturedRank(error)) {
    const { featured_rank: _rank, ...rest } = next;
    next = rest;
  }
  if (missingActive(error)) {
    const { active: _active, ...rest } = next;
    next = rest;
  }
  return next;
}

export async function upsertProduct(shopId, product, position) {
  const row = {
    shop_id: shopId,
    id: product.id,
    category_id: product.category,
    kind: product.kind,
    name: product.name,
    description: product.description,
    price: product.price,
    image: product.image,
    featured: product.featured,
    featured_rank: Number(product.featuredRank) || 0,
    active: product.active !== false,
    position,
  };
  let { error } = await supabase.from("products").upsert(row, { onConflict: "shop_id,id" });
  if (error && (missingFeaturedRank(error) || missingActive(error))) {
    ({ error } = await supabase.from("products").upsert(withoutMissingProductColumns(row, error), { onConflict: "shop_id,id" }));
  }
  return error ? explain(error) : "";
}

export async function saveProductActive(shopId, id, active) {
  const { error } = await supabase.from("products").update({ active: Boolean(active) }).eq("shop_id", shopId).eq("id", id);
  return error ? explain(error) : "";
}

export async function saveFeaturedProducts(shopId, products) {
  const results = await Promise.all(
    products.map(async (product) => {
      const row = {
        featured: Boolean(product.featured),
        featured_rank: Number(product.featuredRank) || 0,
      };
      let { error } = await supabase.from("products").update(row).eq("shop_id", shopId).eq("id", product.id);
      if (error && missingFeaturedRank(error)) {
        ({ error } = await supabase
          .from("products")
          .update({ featured: row.featured })
          .eq("shop_id", shopId)
          .eq("id", product.id));
      }
      return error;
    }),
  );
  const fail = results.find(Boolean);
  return fail ? explain(fail) : "";
}

export async function deleteProduct(shopId, id) {
  const { error } = await supabase.from("products").delete().eq("shop_id", shopId).eq("id", id);
  return error ? explain(error) : "";
}

function dataUrlToBlob(dataUrl) {
  const [header, body] = dataUrl.split(",");
  const mime = header.match(/data:(.*?);/)?.[1] || "image/jpeg";
  const binary = atob(body);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
}

export async function fetchShopOrders(shopId, daysBack = 0) {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { start, end } = saoPauloDayBounds(daysBack);
  await Promise.all([
    supabase
      .from("orders")
      .update({ status: "paid" })
      .eq("shop_id", shopId)
      .not("paid_at", "is", null)
      .neq("status", "paid"),
    supabase
      .from("orders")
      .update({ status: "canceled" })
      .eq("shop_id", shopId)
      .eq("status", "pending")
      .is("paid_at", null)
      .lt("created_at", cutoff),
  ]);
  const columns =
    "id, status, customer_name, customer_whatsapp, customer_mode, customer_address, customer_notes, items, total, paid_at, created_at";
  let { data, error } = await supabase
    .from("orders")
    .select(columns)
    .eq("shop_id", shopId)
    .gte("created_at", start.toISOString())
    .lt("created_at", end.toISOString())
    .order("created_at", { ascending: false })
    .limit(200);
  if (error && /customer_whatsapp/i.test(error.message || "")) {
    ({ data, error } = await supabase
      .from("orders")
      .select("id, status, customer_name, customer_mode, customer_address, customer_notes, items, total, paid_at, created_at")
      .eq("shop_id", shopId)
      .gte("created_at", start.toISOString())
      .lt("created_at", end.toISOString())
      .order("created_at", { ascending: false })
      .limit(200));
  }
  if (error) return { error: explain(error), orders: [] };
  const orders = (data || []).map((order) => {
    if (order.paid_at) return { ...order, status: "paid" };
    if (order.status === "pending" && new Date(order.created_at).getTime() < Date.now() - 60 * 60 * 1000) {
      return { ...order, status: "canceled" };
    }
    return order;
  });
  return { error: "", orders };
}

export async function upsertItemType(shopId, type, position) {
  const { error } = await supabase.from("item_types").upsert(
    {
      shop_id: shopId,
      id: type.id,
      name: type.name,
      groups: type.groups || [],
      position,
    },
    { onConflict: "shop_id,id" },
  );
  return error ? explain(error) : "";
}

export async function deleteItemType(shopId, id) {
  const { error } = await supabase.from("item_types").delete().eq("shop_id", shopId).eq("id", id);
  return error ? explain(error) : "";
}

export async function uploadShopLogo(userId, dataUrl) {
  const blob = dataUrlToBlob(dataUrl);
  const path = `${userId}/logo.png`;
  const { error } = await supabase.storage.from("products").upload(path, blob, {
    upsert: true,
    contentType: blob.type || "image/png",
  });
  if (error) return { error: explain(error), url: "" };
  const { data } = supabase.storage.from("products").getPublicUrl(path);
  return { error: "", url: `${data.publicUrl}?v=${Date.now()}` };
}

export async function uploadProductImage(userId, productId, dataUrl) {
  const blob = dataUrlToBlob(dataUrl);
  const path = `${userId}/${productId}.jpg`;
  const { error } = await supabase.storage.from("products").upload(path, blob, {
    upsert: true,
    contentType: "image/jpeg",
  });
  if (error) return { error: explain(error), url: "" };
  const { data } = supabase.storage.from("products").getPublicUrl(path);
  return { error: "", url: `${data.publicUrl}?v=${Date.now()}` };
}
