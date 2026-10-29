import { shop as defaultShop } from "./config";
import { seedCategories, seedProducts } from "./menu";
import { supabase } from "./supabase";

export function explain(error) {
  const code = error?.code || "";
  const message = error?.message || "";
  if (code === "PGRST205" || code === "42P01" || /schema cache/i.test(message)) {
    return "As tabelas da loja ainda não existem no Supabase.";
  }
  if (code === "23503") return "Essa categoria ainda tem produtos vinculados.";
  if (code === "23505" || /shop exists/i.test(message)) return "Esta loja já tem uma conta.";
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
      whatsapp: shop.whatsapp || "",
      address: shop.address || "",
      hours: shop.hours || "",
      open: shop.is_open !== false,
      openLabel: shop.open_label || defaultShop.openLabel,
      closedLabel: shop.closed_label || defaultShop.closedLabel,
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

export async function fetchStore() {
  const { data: shop, error } = await supabase.from("shops").select("*").order("created_at").limit(1).maybeSingle();
  if (error) return { error: explain(error), store: null };
  if (!shop) return { error: "", store: null };

  const [categoriesResult, productsResult] = await Promise.all([
    supabase.from("categories").select("*").eq("shop_id", shop.id).order("position"),
    supabase.from("products").select("*").eq("shop_id", shop.id).order("position"),
  ]);
  if (categoriesResult.error) return { error: explain(categoriesResult.error), store: null };
  if (productsResult.error) return { error: explain(productsResult.error), store: null };
  return { error: "", store: toStore(shop, categoriesResult.data, productsResult.data) };
}

export async function createSeedShop() {
  const shop = {
    name: defaultShop.name,
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
  return fetchStore();
}

export async function deleteMyAccount(userId) {
  const listed = await supabase.storage.from("products").list(userId);
  if (!listed.error && listed.data?.length) {
    await supabase.storage.from("products").remove(listed.data.map((file) => `${userId}/${file.name}`));
  }
  const { error } = await supabase.rpc("delete_my_account");
  return error ? explain(error) : "";
}

export async function saveShopRow(shopId, shop) {
  const { error } = await supabase
    .from("shops")
    .update({
      name: shop.name,
      whatsapp: shop.whatsapp,
      address: shop.address,
      hours: shop.hours,
      is_open: shop.open,
      open_label: shop.openLabel,
      closed_label: shop.closedLabel,
    })
    .eq("id", shopId);
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
