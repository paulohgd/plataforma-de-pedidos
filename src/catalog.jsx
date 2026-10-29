import { useCallback, useContext, useEffect, useMemo, useState, createContext } from "react";
import { shop as defaultShop } from "./config";
import { norm } from "./format";
import { hydrateProducts, orderFeatured, seedCategories, seedProducts } from "./menu";
import {
  createSeedShop,
  deleteMyAccount,
  deleteCategory,
  deleteProduct,
  explainAuth,
  fetchStore,
  insertCategory,
  saveShopRow,
  updateCategoryName,
  uploadProductImage,
  upsertProduct,
} from "./remote";
import { supabase } from "./supabase";

const KINDS = new Set(["beef", "chicken", "sandwich", "fries", "simple"]);
const CatalogContext = createContext(null);

function seedStore() {
  return {
    shopId: null,
    ownerId: null,
    shop: { ...defaultShop },
    categories: seedCategories.map((category) => ({ ...category })),
    products: seedProducts.map((product) => ({ ...product })),
  };
}

function cleanShop(shop) {
  const source = shop && typeof shop === "object" ? shop : {};
  return {
    name: String(source.name || defaultShop.name).trim() || defaultShop.name,
    whatsapp: String(source.whatsapp || "").replace(/\D/g, "").slice(0, 15),
    address: String(source.address || "").trim().slice(0, 120),
    hours: String(source.hours || "").trim().slice(0, 80),
    open: source.open !== false,
    openLabel: String(source.openLabel || defaultShop.openLabel).trim().slice(0, 60) || defaultShop.openLabel,
    closedLabel: String(source.closedLabel || defaultShop.closedLabel).trim().slice(0, 80) || defaultShop.closedLabel,
  };
}

function cleanProduct(product) {
  if (!product || !String(product.name || "").trim()) return null;
  const image = typeof product.image === "string" ? product.image.trim() : "";
  return {
    id: product.id ? String(product.id) : "",
    category: String(product.category || ""),
    kind: KINDS.has(product.kind) ? product.kind : "simple",
    name: String(product.name).trim().slice(0, 80),
    description: String(product.description || "").trim().slice(0, 400),
    price: Math.round(Number(product.price) * 100) / 100,
    image,
    featured: Boolean(product.featured),
  };
}

function uniqueId(name, used) {
  const base = norm(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  let id = base;
  let count = 2;
  while (used.has(id)) {
    id = `${base}-${count}`;
    count += 1;
  }
  return id;
}

function toAccount(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.user_metadata?.name || user.email?.split("@")[0] || "Conta",
    email: user.email || "",
  };
}

export function CatalogProvider({ children }) {
  const [store, setStore] = useState(seedStore);
  const [account, setAccount] = useState(null);
  const [remoteError, setRemoteError] = useState("");
  const [ready, setReady] = useState(false);

  const isOwner = Boolean(account && store.ownerId === account.id);
  const hasOwner = Boolean(store.ownerId);
  const products = useMemo(() => hydrateProducts(store.products), [store.products]);
  const featured = useMemo(() => orderFeatured(products), [products]);

  const applyRemote = useCallback(async (userId) => {
    const loaded = await fetchStore();
    if (loaded.error) {
      setRemoteError(loaded.error);
      return { error: loaded.error, ownsStore: false };
    }
    if (!loaded.store) {
      if (!userId) {
        setRemoteError("");
        return { error: "", ownsStore: false };
      }
      const created = await createSeedShop();
      if (created.store) {
        setRemoteError("");
        setStore(created.store);
        return { error: "", ownsStore: created.store.ownerId === userId };
      }
      const again = await fetchStore();
      if (again.store) {
        setRemoteError("");
        setStore(again.store);
        return { error: "", ownsStore: again.store.ownerId === userId };
      }
      const message = created.error || again.error || "Não foi possível criar a loja.";
      setRemoteError(message);
      return { error: message, ownsStore: false };
    }
    setRemoteError("");
    setStore(loaded.store);
    return { error: "", ownsStore: Boolean(userId && loaded.store.ownerId === userId) };
  }, []);

  useEffect(() => {
    let cancel = false;

    async function boot() {
      const { data } = await supabase.auth.getSession();
      if (cancel) return;
      const user = toAccount(data.session?.user);
      setAccount(user);
      await applyRemote(user?.id || null);
      if (!cancel) setReady(true);
    }

    boot();
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccount(toAccount(session?.user));
    });

    return () => {
      cancel = true;
      data.subscription.unsubscribe();
    };
  }, [applyRemote]);

  useEffect(() => {
    if (!ready || !account) return;
    if (store.ownerId === account.id || store.shopId) return;
    applyRemote(account.id);
  }, [ready, account, store.ownerId, store.shopId, applyRemote]);

  const register = useCallback(
    async ({ name, email, password }) => {
      const cleanName = name.trim();
      const cleanEmail = email.trim().toLowerCase();
      if (cleanName.length < 2) return { ok: false, error: "Informe seu nome." };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return { ok: false, error: "Informe um e-mail válido." };
      if (password.length < 6) return { ok: false, error: "A senha precisa ter pelo menos 6 caracteres." };
      if (store.ownerId) return { ok: false, error: "Esta loja já tem uma conta. Entre com o e-mail dessa conta." };

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { name: cleanName.slice(0, 60) },
          emailRedirectTo: window.location.origin,
        },
      });
      if (error) return { ok: false, error: explainAuth(error) };
      if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
        return { ok: false, error: "Já existe uma conta com esse e-mail." };
      }
      if (!data.session) {
        return { ok: false, error: "Enviamos um link de confirmação para o seu e-mail. Depois de confirmar, entre na área da loja." };
      }

      const user = toAccount(data.session.user);
      setAccount(user);
      const result = await applyRemote(user.id);
      if (result.error) return { ok: false, error: result.error };
      return { ok: true, ownsStore: result.ownsStore };
    },
    [applyRemote, store.ownerId],
  );

  const login = useCallback(
    async ({ email, password }) => {
      const cleanEmail = email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (error) return { ok: false, error: explainAuth(error) };
      const user = toAccount(data.user);
      setAccount(user);
      const result = await applyRemote(user.id);
      if (result.error) return { ok: false, error: result.error };
      return { ok: true, ownsStore: result.ownsStore };
    },
    [applyRemote],
  );

  const logout = useCallback(async () => {
    setAccount(null);
    await supabase.auth.signOut();
  }, []);

  const removeAccount = useCallback(async () => {
    if (!account) return "Entre na conta para apagá-la.";
    const owned = store.ownerId === account.id;
    const error = await deleteMyAccount(account.id);
    if (error) return error;
    setAccount(null);
    await supabase.auth.signOut().catch(() => {});
    if (owned) {
      setStore(seedStore());
      return "";
    }
    const loaded = await fetchStore();
    if (loaded.store) setStore(loaded.store);
    return "";
  }, [account, store.ownerId]);

  const retryStore = useCallback(async () => {
    if (!account) return { error: "Entre na conta para criar a loja.", ownsStore: false };
    return applyRemote(account.id);
  }, [account, applyRemote]);

  const deny = useCallback(() => {
    if (!account) return "Entre com a conta dona desta loja para alterar o cardápio.";
    if (store.ownerId && store.ownerId !== account.id) return "Entre com a conta dona desta loja para alterar o cardápio.";
    if (store.ownerId !== account.id || !store.shopId) {
      return remoteError || "A loja ainda não foi gravada na base. Entre de novo para criar.";
    }
    return "";
  }, [account, remoteError, store.ownerId, store.shopId]);

  const updateShop = useCallback(
    async (shop) => {
      const denied = deny();
      if (denied) return denied;
      if (!String(shop.name || "").trim()) return "Informe o nome da loja.";
      const digits = String(shop.whatsapp || "").replace(/\D/g, "");
      if (digits && digits.length < 12) return "O WhatsApp precisa ter DDI e DDD. Exemplo: 5511987654321.";
      const nextShop = cleanShop({ ...store.shop, ...shop, whatsapp: digits });
      const error = await saveShopRow(store.shopId, nextShop);
      if (error) return error;
      setStore((current) => ({ ...current, shop: nextShop }));
      return "";
    },
    [deny, store.shop, store.shopId],
  );

  const addCategory = useCallback(
    async (name) => {
      const denied = deny();
      if (denied) return denied;
      const clean = name.trim().slice(0, 40);
      if (clean.length < 2) return "Informe o nome da categoria.";
      if (store.categories.some((category) => norm(category.name) === norm(clean))) return "Essa categoria já existe.";
      const id = uniqueId(clean, new Set(store.categories.map((category) => category.id)));
      const category = { id, name: clean };
      const error = await insertCategory(store.shopId, category, store.categories.length);
      if (error) return error;
      setStore((current) => ({ ...current, categories: [...current.categories, category] }));
      return "";
    },
    [deny, store.categories, store.shopId],
  );

  const renameCategory = useCallback(
    async (id, name) => {
      const denied = deny();
      if (denied) return denied;
      const clean = name.trim().slice(0, 40);
      if (clean.length < 2) return "Informe o nome da categoria.";
      if (store.categories.some((category) => category.id !== id && norm(category.name) === norm(clean))) {
        return "Essa categoria já existe.";
      }
      const error = await updateCategoryName(store.shopId, id, clean);
      if (error) return error;
      setStore((current) => ({
        ...current,
        categories: current.categories.map((category) => (category.id === id ? { ...category, name: clean } : category)),
      }));
      return "";
    },
    [deny, store.categories, store.shopId],
  );

  const removeCategory = useCallback(
    async (id) => {
      const denied = deny();
      if (denied) return denied;
      const count = store.products.filter((product) => product.category === id).length;
      if (count === 1) return "Essa categoria tem 1 produto. Mova ou apague o produto antes de removê-la.";
      if (count > 1) return `Essa categoria tem ${count} produtos. Mova ou apague esses produtos antes de removê-la.`;
      const error = await deleteCategory(store.shopId, id);
      if (error) return error;
      setStore((current) => ({ ...current, categories: current.categories.filter((category) => category.id !== id) }));
      return "";
    },
    [deny, store.products, store.shopId],
  );

  const saveProduct = useCallback(
    async (input) => {
      const denied = deny();
      if (denied) return denied;
      const name = String(input.name || "").trim();
      if (name.length < 2) return "Informe o nome do produto.";
      if (!store.categories.some((category) => category.id === input.category)) return "Escolha uma categoria cadastrada.";
      const price = Number(input.price);
      if (!Number.isFinite(price) || price < 0 || price > 9999) return "Informe um preço válido.";
      let image = String(input.image || "").trim();
      if (image && !image.startsWith("data:image/") && !/^https?:\/\//i.test(image)) {
        return "Use uma foto do aparelho ou um link que comece com http:// ou https://.";
      }
      if (image.startsWith("data:") && image.length > 1_500_000) return "A imagem ficou grande demais. Escolha outra foto.";
      const draft = cleanProduct({ ...input, name, price, image, description: String(input.description || "").trim() });
      if (!draft) return "Não foi possível salvar o produto.";
      const id = draft.id || uniqueId(name, new Set(store.products.map((product) => product.id)));
      if (image.startsWith("data:image/")) {
        const uploaded = await uploadProductImage(account.id, id, image);
        if (uploaded.error) return uploaded.error;
        image = uploaded.url;
      }
      const nextProduct = { ...draft, id, image };
      const index = store.products.findIndex((product) => product.id === id);
      const error = await upsertProduct(store.shopId, nextProduct, index === -1 ? store.products.length : index);
      if (error) return error;
      setStore((current) => ({
        ...current,
        products:
          index === -1
            ? [...current.products, nextProduct]
            : current.products.map((product) => (product.id === id ? nextProduct : product)),
      }));
      return "";
    },
    [account, deny, store.categories, store.products, store.shopId],
  );

  const removeProduct = useCallback(
    async (id) => {
      const denied = deny();
      if (denied) return denied;
      const error = await deleteProduct(store.shopId, id);
      if (error) return error;
      setStore((current) => ({ ...current, products: current.products.filter((product) => product.id !== id) }));
      return "";
    },
    [deny, store.shopId],
  );

  const value = {
    shop: store.shop,
    categories: store.categories,
    products,
    featured,
    account,
    isOwner,
    hasOwner,
    remoteError,
    ready,
    retryStore,
    getProduct(id) {
      return products.find((product) => product.id === id) || null;
    },
    productsIn(categoryId) {
      return products.filter((product) => product.category === categoryId);
    },
    register,
    login,
    logout,
    updateShop,
    addCategory,
    renameCategory,
    removeCategory,
    saveProduct,
    removeProduct,
    removeAccount,
  };

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog() {
  const value = useContext(CatalogContext);
  if (!value) throw new Error("useCatalog fora do provedor");
  return value;
}
