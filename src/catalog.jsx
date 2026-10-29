import { useCallback, useContext, useEffect, useMemo, useRef, useState, createContext } from "react";
import { paidMessage, paidTitle, shop as defaultShop } from "./config";
import { norm, slugify } from "./format";
import { hydrateProducts, orderFeatured } from "./menu";
import { readPlace, readRoute, singleShopRedirect } from "./place";
import {
  createSeedShop,
  deleteMyAccount,
  deleteCategory,
  deleteProduct,
  explainAuth,
  fetchShops,
  fetchStoreByOwner,
  fetchStoreBySlug,
  insertCategory,
  saveShopRow,
  saveShopSecret,
  updateCategoryName,
  uploadProductImage,
  upsertProduct,
} from "./remote";
import { supabase } from "./supabase";

const KINDS = new Set(["beef", "chicken", "sandwich", "fries", "simple"]);
const CatalogContext = createContext(null);

function blankStore() {
  return {
    shopId: null,
    ownerId: null,
    shop: {
      name: "",
      slug: "",
      whatsapp: "",
      address: "",
      hours: "",
      open: true,
      openLabel: defaultShop.openLabel,
      closedLabel: defaultShop.closedLabel,
      stripePublishableKey: "",
      paidTitle,
      paidMessage,
    },
    categories: [],
    products: [],
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
    stripePublishableKey: String(source.stripePublishableKey || "").trim(),
    paidTitle: String(source.paidTitle || paidTitle).trim().slice(0, 80) || paidTitle,
    paidMessage: String(source.paidMessage || paidMessage).trim().slice(0, 800) || paidMessage,
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
    storeName: user.user_metadata?.storeName || "",
    email: user.email || "",
  };
}

export function CatalogProvider({ children }) {
  const [store, setStore] = useState(blankStore);
  const [stores, setStores] = useState([]);
  const [listed, setListed] = useState(false);
  const [account, setAccount] = useState(null);
  const [mine, setMine] = useState(null);
  const [missing, setMissing] = useState(false);
  const [remoteError, setRemoteError] = useState("");
  const [ready, setReady] = useState(false);
  const accountRef = useRef(null);
  const storeRef = useRef(store);
  const ticket = useRef(0);

  const isOwner = Boolean(account && store.ownerId === account.id);
  const hasOwner = Boolean(mine?.shopId);
  const products = useMemo(() => hydrateProducts(store.products), [store.products]);
  const featured = useMemo(() => orderFeatured(products), [products]);

  function commitStore(next) {
    storeRef.current = next;
    setStore(next);
  }

  const refresh = useCallback(async () => {
    const current = ++ticket.current;
    const user = accountRef.current;
    const place = readPlace();
    let owned = { store: null, error: "" };

    if (user) {
      owned = await fetchStoreByOwner(user.id);
      if (current !== ticket.current) return { error: "", ownsStore: false };
      if (owned.error) {
        setRemoteError(owned.error);
      } else if (owned.store) {
        setMine({ shopId: owned.store.shopId, ownerId: owned.store.ownerId, slug: owned.store.shop.slug });
        setRemoteError("");
      } else {
        setMine(null);
      }
    } else {
      setMine(null);
    }

    if (place.scope === "admin" && user) {
      if (!owned.store && !owned.error) {
        const created = await createSeedShop(user.storeName || user.name);
        if (current !== ticket.current) return { error: "", ownsStore: false };
        if (created.store) owned = created;
        else owned = await fetchStoreByOwner(user.id);
        if (!owned.store) {
          const message = created.error || owned.error || "Não foi possível criar a loja.";
          setRemoteError(message);
          setReady(true);
          return { error: message, ownsStore: false };
        }
        setMine({ shopId: owned.store.shopId, ownerId: owned.store.ownerId, slug: owned.store.shop.slug });
        setRemoteError("");
      }
      if (owned.store) {
        commitStore(owned.store);
        setMissing(false);
      }
      setReady(true);
      return { error: owned.error || "", ownsStore: Boolean(owned.store && owned.store.ownerId === user.id) };
    }

    if (place.scope === "shop") {
      if (storeRef.current.shop.slug === place.slug && storeRef.current.shopId) {
        setMissing(false);
        setReady(true);
        return { error: "", ownsStore: Boolean(user && storeRef.current.ownerId === user.id) };
      }
      const loaded = await fetchStoreBySlug(place.slug);
      if (current !== ticket.current) return { error: "", ownsStore: false };
      if (loaded.error) {
        setRemoteError(loaded.error);
        setReady(true);
        return { error: loaded.error, ownsStore: false };
      }
      if (!loaded.store) {
        commitStore(blankStore());
        setMissing(true);
        setRemoteError("");
        setReady(true);
        return { error: "", ownsStore: false };
      }
      commitStore(loaded.store);
      setMissing(false);
      setRemoteError("");
      setReady(true);
      return { error: "", ownsStore: Boolean(user && loaded.store.ownerId === user.id) };
    }

    if (place.scope === "directory") {
      setListed(false);
      const list = await fetchShops();
      if (current !== ticket.current) return { error: "", ownsStore: false };
      if (list.error) {
        setRemoteError(list.error);
        setListed(true);
        setReady(true);
        return { error: list.error, ownsStore: false };
      }
      setStores(list.shops);
      setListed(true);
      setRemoteError("");
      setMissing(false);
      if (list.shops.length === 1) {
        const next = singleShopRedirect(window.location.pathname, list.shops[0].slug);
        if (next) {
          history.replaceState(readRoute(next), "", next);
          window.dispatchEvent(new Event("pedido-nav"));
        }
      }
      setReady(true);
      return { error: "", ownsStore: Boolean(owned.store && user && owned.store.ownerId === user.id) };
    }

    setReady(true);
    return { error: "", ownsStore: Boolean(owned.store && user && owned.store.ownerId === user.id) };
  }, []);

  useEffect(() => {
    let cancel = false;

    async function boot() {
      const { data } = await supabase.auth.getSession();
      if (cancel) return;
      const user = toAccount(data.session?.user);
      accountRef.current = user;
      setAccount(user);
      await refresh();
    }

    boot();
    const onNav = () => {
      refresh();
    };
    window.addEventListener("pedido-nav", onNav);
    window.addEventListener("popstate", onNav);
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = toAccount(session?.user);
      accountRef.current = user;
      setAccount(user);
    });

    return () => {
      cancel = true;
      window.removeEventListener("pedido-nav", onNav);
      window.removeEventListener("popstate", onNav);
      data.subscription.unsubscribe();
    };
  }, [refresh]);

  useEffect(() => {
    if (!ready) return;
    refresh();
  }, [account?.id, ready, refresh]);

  const register = useCallback(
    async ({ name, storeName, email, password }) => {
      const cleanName = name.trim();
      const cleanStore = storeName.trim();
      const cleanEmail = email.trim().toLowerCase();
      if (cleanName.length < 2) return { ok: false, error: "Informe seu nome." };
      if (cleanStore.length < 2) return { ok: false, error: "Informe o nome da loja." };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) return { ok: false, error: "Informe um e-mail válido." };
      if (password.length < 6) return { ok: false, error: "A senha precisa ter pelo menos 6 caracteres." };

      const { data, error } = await supabase.auth.signUp({
        email: cleanEmail,
        password,
        options: {
          data: { name: cleanName.slice(0, 60), storeName: cleanStore.slice(0, 80) },
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
      accountRef.current = user;
      setAccount(user);
      const result = await refresh();
      if (result.error) return { ok: false, error: result.error };
      return { ok: true, ownsStore: result.ownsStore };
    },
    [refresh],
  );

  const login = useCallback(
    async ({ email, password }) => {
      const cleanEmail = email.trim().toLowerCase();
      const { data, error } = await supabase.auth.signInWithPassword({ email: cleanEmail, password });
      if (error) return { ok: false, error: explainAuth(error) };
      const user = toAccount(data.user);
      accountRef.current = user;
      setAccount(user);
      const result = await refresh();
      if (result.error) return { ok: false, error: result.error };
      return { ok: true, ownsStore: result.ownsStore };
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    accountRef.current = null;
    setAccount(null);
    setMine(null);
    await supabase.auth.signOut();
    await refresh();
  }, [refresh]);

  const removeAccount = useCallback(async () => {
    if (!account) return "Entre na conta para apagá-la.";
    const error = await deleteMyAccount(account.id);
    if (error) return error;
    accountRef.current = null;
    setAccount(null);
    setMine(null);
    commitStore(blankStore());
    await supabase.auth.signOut().catch(() => {});
    await refresh();
    return "";
  }, [account, refresh]);

  const retryStore = useCallback(async () => {
    if (!accountRef.current) return { error: "Entre na conta para criar a loja.", ownsStore: false };
    return refresh();
  }, [refresh]);

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
      const publishable = String(shop.stripePublishableKey || "").trim();
      if (publishable && !/^pk_(test|live)_/.test(publishable)) {
        return "A chave publicável da Stripe deve começar com pk_test_ ou pk_live_.";
      }
      const nextShop = cleanShop({ ...store.shop, ...shop, whatsapp: digits, stripePublishableKey: publishable });
      nextShop.slug = slugify(nextShop.name);
      const error = await saveShopRow(store.shopId, nextShop);
      if (error) return error;
      const secretError = await saveShopSecret(store.shopId, shop.stripeSecretKey);
      if (secretError) return secretError;
      const nextStore = { ...storeRef.current, shop: nextShop };
      storeRef.current = nextStore;
      setMine((current) => (current ? { ...current, slug: nextShop.slug } : current));
      setStore(nextStore);
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
    shopId: store.shopId,
    categories: store.categories,
    products,
    featured,
    stores,
    listed,
    missing,
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
