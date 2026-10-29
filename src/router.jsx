import { createContext, useContext, useEffect, useRef, useState } from "react";
import { useCatalog } from "./catalog";

const UIContext = createContext(null);

function readRoute() {
  const path = window.location.pathname;
  const editor = path.match(/^\/painel\/produto\/([^/]+)/);
  if (editor) return { name: "product-form", id: decodeURIComponent(editor[1]) };
  if (path.startsWith("/painel/produto")) return { name: "product-form", id: null };
  if (path.startsWith("/painel/categorias")) return { name: "admin", tab: "categorias" };
  if (path.startsWith("/painel/loja")) return { name: "admin", tab: "loja" };
  if (path.startsWith("/painel")) return { name: "admin", tab: "produtos" };
  if (path.startsWith("/acesso")) return { name: "access" };
  const product = path.match(/^\/produto\/([^/]+)/);
  if (product) return { name: "product", id: decodeURIComponent(product[1]), lineId: null };
  if (path.startsWith("/sacola")) return { name: "bag" };
  if (path.startsWith("/checkout")) return { name: "checkout" };
  if (path.startsWith("/busca")) return { name: "search" };
  return { name: "home" };
}

export function UIProvider({ children }) {
  const { shop } = useCatalog();
  const [route, setRoute] = useState(() => (history.state?.name ? history.state : readRoute()));
  const [toast, setToast] = useState("");
  const [theme, setTheme] = useState(() => localStorage.getItem("pedido-tema") || "light");
  const canBack = useRef(false);
  const toastTimer = useRef(null);
  const homeScroll = useRef(0);

  useEffect(() => {
    if (!history.state?.name) history.replaceState(readRoute(), "");
    const onPop = (event) => {
      const next = event.state?.name ? event.state : readRoute();
      setRoute(next);
      if (next.name === "home") {
        requestAnimationFrame(() => window.scrollTo(0, homeScroll.current));
      } else {
        window.scrollTo(0, 0);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("pedido-tema", theme);
  }, [theme]);

  useEffect(() => {
    document.title = shop.name || "Cardápio";
  }, [shop.name]);

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
  }

  function back() {
    if (canBack.current) {
      canBack.current = false;
      history.back();
      return;
    }
    go({ name: "home" }, "/");
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
      if (route.name === "home") {
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      go({ name: "home" }, "/");
    },
    openProduct(id, lineId = null) {
      if (route.name === "home") homeScroll.current = window.scrollY;
      go({ name: "product", id, lineId }, `/produto/${id}`);
    },
    openBag() {
      go({ name: "bag" }, "/sacola");
    },
    openCheckout() {
      go({ name: "checkout" }, "/checkout");
    },
    openSearch() {
      go({ name: "search" }, "/busca");
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
