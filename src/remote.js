import { paidMessage, paidTitle, shop as defaultShop } from "./config";
import { slugify } from "./format";
import { seedCategories, seedProducts } from "./menu";
import { supabase } from "./supabase";

export function explain(error) {
  const code = error?.code || "";
  const message = error?.message || "";
  if (/slug/i.test(message) && /column|schema cache/i.test(message)) {
    return "Falta atualizar a base. Rode o schema.sql de novo no Supabase.";
  }
  if (code === "PGRST205" || code === "42P01" || /schema cache/i.test(message) || /shop_secrets|paid_title|stripe_publishable/i.test(message)) {
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
  if (/password/i.test(message)) return "A senha precisa ter pelo menos 6 caracteres.";
  return "Não foi possível acessar agora.";
}

function toStore(shop, categories, products) {
  return {
    shopId: shop.id,
    ownerId: shop.owner_id,
    shop: {
      name: shop.name,
      slug: shop.slug || slugify(shop.name),
      whatsapp: shop.whatsapp || "",
      address: shop.address || "",
      hours: shop.hours || "",
      open: shop.is_open !== false,
      openLabel: shop.open_label || defaultShop.openLabel,
      closedLabel: shop.closed_label || defaultShop.closedLabel,
      stripePublishableKey: shop.stripe_publishable_key || "",
      paidTitle: shop.paid_title || paidTitle,
      paidMessage: shop.paid_message || paidMessage,
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
    })),
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
  };
}

async function loadShop(shop) {
  if (!shop) return { error: "", store: null };

  const [categoriesResult, productsResult] = await Promise.all([
    supabase.from("categories").select("*").eq("shop_id", shop.id).order("position"),
    supabase.from("products").select("*").eq("shop_id", shop.id).order("position"),
  ]);
  if (categoriesResult.error) return { error: explain(categoriesResult.error), store: null };
  if (productsResult.error) return { error: explain(productsResult.error), store: null };
  return { error: "", store: toStore(shop, categoriesResult.data, productsResult.data) };
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

export async function createSeedShop(name) {
  const shopName = String(name || defaultShop.name).trim() || defaultShop.name;
  const shop = {
    name: shopName,
    slug: slugify(shopName),
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
    position,
  }));
  const { error } = await supabase.rpc("create_store", { shop, categories, products });
  if (error) return { error: explain(error), store: null };
  return fetchStoreBySlug(shop.slug);
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
  if (error) return { error: explain(error), stripe: false, discord: false };
  return {
    error: "",
    stripe: Boolean(String(data?.stripe_secret_key || "").trim()),
    discord: Boolean(String(data?.discord_webhook_url || "").trim()),
  };
}

export async function saveShopSecrets(shopId, { stripeSecretKey, discordWebhookUrl }) {
  const stripe = String(stripeSecretKey || "").trim();
  const discord = String(discordWebhookUrl || "").trim();
  if (stripe && !/^(sk|pk|rk)_/.test(stripe)) {
    return "Cole a chave da Stripe desta loja.";
  }
  if (discord && !discord.startsWith("https://discord.com/api/webhooks/")) {
    return "O webhook do Discord deve começar com https://discord.com/api/webhooks/";
  }
  if (!stripe && !discord) return "";

  const patch = { updated_at: new Date().toISOString() };
  if (stripe) patch.stripe_secret_key = stripe;
  if (discord) patch.discord_webhook_url = discord;

  const { data: existing, error: lookupError } = await supabase
    .from("shop_secrets")
    .select("shop_id")
    .eq("shop_id", shopId)
    .maybeSingle();
  if (lookupError) return explain(lookupError);

  if (existing) {
    const { error } = await supabase.from("shop_secrets").update(patch).eq("shop_id", shopId);
    return error ? explain(error) : "";
  }

  const { error } = await supabase.from("shop_secrets").insert({
    shop_id: shopId,
    stripe_secret_key: stripe,
    discord_webhook_url: discord,
    updated_at: patch.updated_at,
  });
  return error ? explain(error) : "";
}

export async function saveShopRow(shopId, shop) {
  const fields = {
    name: shop.name,
    whatsapp: shop.whatsapp,
    address: shop.address,
    hours: shop.hours,
    is_open: shop.open,
    open_label: shop.openLabel,
    closed_label: shop.closedLabel,
    stripe_publishable_key: shop.stripePublishableKey || "",
    paid_title: shop.paidTitle || paidTitle,
    paid_message: shop.paidMessage || paidMessage,
  };
  let { error } = await supabase.from("shops").update({ ...fields, slug: shop.slug }).eq("id", shopId);
  if (error && missingSlugColumn(error)) {
    ({ error } = await supabase.from("shops").update(fields).eq("id", shopId));
  }
  return error ? explain(error) : "";
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

export async function upsertProduct(shopId, product, position) {
  const { error } = await supabase.from("products").upsert(
    {
      shop_id: shopId,
      id: product.id,
      category_id: product.category,
      kind: product.kind,
      name: product.name,
      description: product.description,
      price: product.price,
      image: product.image,
      featured: product.featured,
      position,
    },
    { onConflict: "shop_id,id" },
  );
  return error ? explain(error) : "";
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

export async function fetchShopOrders(shopId) {
  const { data, error } = await supabase
    .from("orders")
    .select("id, status, customer_name, customer_mode, customer_address, customer_notes, items, total, paid_at, created_at")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { error: explain(error), orders: [] };
  return { error: "", orders: data || [] };
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
