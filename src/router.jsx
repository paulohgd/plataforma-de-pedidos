import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useCatalog } from "./catalog";
import { readRoute } from "./place";

const UIContext = createContext(null);

function shopPath(slug, suffix = "") {
  if (!slug) return "/";
  return `/loja/${encodeURIComponent(slug)}${suffix}`;
}

function setMeta(attr, name, content) {
  const selector = `meta[${attr}="${name}"]`;
  let node = document.head.querySelector(selector);
  if (!node) {
    node = document.createElement("meta");
    node.setAttribute(attr, name);
    document.head.appendChild(node);
  }
  node.setAttribute("content", content);
}

export function UIProvider({ children }) {
  const { shop, missing } = useCatalog();
  const [route, setRoute] = useState(() => readRoute());
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState(() => localStorage.getItem("pedido-tema") || "light");
  const canBack = useRef(false);
  const toastTimer = useRef(null);
  const homeScroll = useRef(0);

  useEffect(() => {
    if (!history.state?.name) history.replaceState(readRoute(), "");
    const onPop = (event) => {
      const fromUrl = readRoute();
      const fromState = event.state?.name === fromUrl.name ? event.state : null;
      const next = fromState ? { ...fromUrl, ...fromState, slug: fromUrl.slug } : fromUrl;
      setRoute(next);
      if (next.name === "home") {
        requestAnimationFrame(() => window.scrollTo(0, homeScroll.current));
      } else {
        window.scrollTo(0, 0);
      }
    };
    const onNav = () => {
      setRoute((current) => {
        const next = readRoute();
        if (current?.lineId && current.name === next.name && current.slug === next.slug && current.id === next.id) {
          return { ...next, lineId: current.lineId };
        }
        return next;
      });
    };
    window.addEventListener("popstate", onPop);
    window.addEventListener("pedido-nav", onNav);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("pedido-nav", onNav);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("pedido-tema", theme);
  }, [theme]);

  useEffect(() => {
    const area = route.name === "access" || route.name === "admin" || route.name === "product-form";
    const title =
      route.name === "stores"
        ? "Lojas"
        : route.name === "paid"
          ? "Pedido pago"
          : area
            ? "Área da loja"
            : missing
              ? "Loja não encontrada"
              : shop.name || "Cardápio";
    document.title = title;
    const description = missing
      ? "Loja não encontrada."
      : shop.hours || shop.address || "Peça pelo cardápio.";
    setMeta("name", "description", description);
    setMeta("property", "og:title", title);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", window.location.href);
  }, [route.name, shop.name, shop.hours, shop.address, missing]);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  function notify(text) {
    setToast(text);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(""), 2400);
  }

  function go(next, url, replace = false) {
    canBack.current = true;
    if (replace) history.replaceState(next, "", url);
    else history.pushState(next, "", url);
    setRoute(next);
    window.scrollTo(0, 0);
    window.dispatchEvent(new Event("pedido-nav"));
  }

  function currentSlug() {
    return route.slug || shop.slug || "";
  }

  function back() {
    if (canBack.current) {
      canBack.current = false;
      history.back();
      return;
    }
    const slug = currentSlug();
    go(slug ? { name: "home", slug } : { name: "stores", slug: null }, shopPath(slug));
  }

  async function share(url, title) {
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
    } catch (error) {
      if (error?.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(url);
      notify("Link copiado.");
    } catch {
      notify("Não foi possível copiar o link.");
    }
  }

  const value = {
    route,
    toast,
    theme,
    notify,
    share,
    toggleTheme() {
      setTheme((current) => (current === "dark" ? "light" : "dark"));
    },
    goHome() {
      const slug = currentSlug();
      if (route.name === "home" && route.slug === slug) {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      go(slug ? { name: "home", slug } : { name: "stores", slug: null }, shopPath(slug));
    },
    openShop(slug) {
      go({ name: "home", slug }, shopPath(slug));
    },
    openDirectory() {
      go({ name: "stores", slug: null }, "/");
    },
    openProduct(id, lineId = null) {
      const slug = currentSlug();
      if (route.name === "home") homeScroll.current = window.scrollY;
      go({ name: "product", id, lineId, slug }, shopPath(slug, `/produto/${encodeURIComponent(id)}`));
    },
    openBag() {
      const slug = currentSlug();
      go({ name: "bag", slug }, shopPath(slug, "/sacola"));
    },
    openCheckout() {
      const slug = currentSlug();
      go({ name: "checkout", slug }, shopPath(slug, "/checkout"));
    },
    openSearch() {
      const slug = currentSlug();
      go({ name: "search", slug }, shopPath(slug, "/busca"));
    },
    openAccess() {
      go({ name: "access" }, "/acesso");
    },
    openAdmin(tab = "produtos", replace = false) {
      const url = tab === "produtos" ? "/painel" : `/painel/${tab}`;
      go({ name: "admin", tab }, url, replace);
    },
    openProductForm(id = null) {
      if (id) go({ name: "product-form", id }, `/painel/produto/${encodeURIComponent(id)}`);
      else go({ name: "product-form", id: null }, "/painel/produto");
    },
    back,
  };

  return <UIContext.Provider value={value}>{children}</UIContext.Provider>;
}

export function useUI() {
  return useContext(UIContext);
}
