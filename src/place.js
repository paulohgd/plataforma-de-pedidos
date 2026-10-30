export function readRoute(path = window.location.pathname) {
  const editor = path.match(/^\/painel\/produto\/([^/]+)/);
  if (editor) return { name: "product-form", id: decodeURIComponent(editor[1]), slug: null, lineId: null };
  if (path.startsWith("/painel/produto")) return { name: "product-form", id: null, slug: null, lineId: null };
  if (path.startsWith("/painel/categorias")) return { name: "admin", tab: "categorias", slug: null };
  if (path.startsWith("/painel/tipos")) return { name: "admin", tab: "tipos", slug: null };
  if (path.startsWith("/painel/loja")) return { name: "admin", tab: "loja", slug: null };
  if (path.startsWith("/painel/pedidos")) return { name: "admin", tab: "pedidos", slug: null };
  if (path.startsWith("/painel")) return { name: "admin", tab: "produtos", slug: null };
  if (path.startsWith("/acesso")) return { name: "access", slug: null };

  const shop = path.match(/^\/loja\/([^/]+)(.*)$/);
  if (shop) {
    const slug = decodeURIComponent(shop[1]);
    const rest = shop[2] || "/";
    const product = rest.match(/^\/produto\/([^/]+)/);
    if (product) return { name: "product", slug, id: decodeURIComponent(product[1]), lineId: null };
    if (rest.startsWith("/sacola")) return { name: "bag", slug };
    if (rest.startsWith("/checkout")) return { name: "checkout", slug };
    if (rest.startsWith("/pedido-pago")) return { name: "paid", slug };
    if (rest.startsWith("/busca")) return { name: "search", slug };
    return { name: "home", slug };
  }

  const legacyProduct = path.match(/^\/produto\/([^/]+)/);
  if (legacyProduct) return { name: "product", slug: null, id: decodeURIComponent(legacyProduct[1]), lineId: null };
  if (path.startsWith("/sacola")) return { name: "bag", slug: null };
  if (path.startsWith("/checkout")) return { name: "checkout", slug: null };
  if (path.startsWith("/pedido-pago")) return { name: "paid", slug: null };
  if (path.startsWith("/busca")) return { name: "search", slug: null };
  return { name: "stores", slug: null };
}

export function readPlace(path = window.location.pathname) {
  if (path.startsWith("/painel")) return { scope: "admin" };
  if (path.startsWith("/acesso")) return { scope: "access" };
  const route = readRoute(path);
  if (route.slug) return { scope: "shop", slug: route.slug };
  return { scope: "directory" };
}

export function singleShopRedirect(pathname, slug) {
  if (!slug) return "";
  if (pathname === "/" || pathname === "") return `/loja/${encodeURIComponent(slug)}`;
  if (/^\/(produto|sacola|checkout|pedido-pago|busca)(\/|$)/.test(pathname)) {
    return `/loja/${encodeURIComponent(slug)}${pathname}`;
  }
  return "";
}
