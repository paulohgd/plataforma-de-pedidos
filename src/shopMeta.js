export function shopSlugFromPath(pathname) {
  try {
    const path = String(pathname || "").startsWith("http")
      ? new URL(pathname).pathname
      : String(pathname || "").split("?")[0];
    const match = decodeURIComponent(path).match(/^\/loja\/([^/]+)/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function replaceNamed(html, key, name, value) {
  const named = new RegExp(`(<meta[^>]+${key}="${name}"[^>]*content=")[^"]*(")`, "i");
  if (named.test(html)) return html.replace(named, `$1${value}$2`);
  const contentFirst = new RegExp(`(<meta[^>]+content=")[^"]*("[^>]+${key}="${name}"[^>]*>)`, "i");
  if (contentFirst.test(html)) return html.replace(contentFirst, `$1${value}$2`);
  return html;
}

function replaceLinkHref(html, rel, href) {
  return html.replace(new RegExp(`(<link[^>]+rel="${rel}"[^>]*href=")[^"]*(")`, "gi"), `$1${href}$2`);
}

export function shopPageTitle(name, { missing = false } = {}) {
  if (missing) return "Loja não encontrada";
  const shopName = String(name || "").trim();
  if (!shopName) return "Pedido online";
  if (/ \| Pedido online$/i.test(shopName)) return shopName;
  return `${shopName} | Pedido online`;
}

export function applyShopMeta(html, shop = {}) {
  const title = escapeHtml(shopPageTitle(shop.name, { missing: Boolean(shop.missing) }));
  const description = escapeHtml(
    String(shop.description || shop.hours || shop.address || "Peça pelo cardápio.").trim() || "Peça pelo cardápio.",
  );
  let next = html.replace(/<title>[^<]*<\/title>/i, `<title>${title}</title>`);
  next = replaceNamed(next, "property", "og:title", title);
  next = replaceNamed(next, "property", "og:description", description);
  next = replaceNamed(next, "name", "description", description);
  if (shop.url) next = replaceNamed(next, "property", "og:url", escapeHtml(shop.url));
  const logo = String(shop.logo || "").trim();
  if (/^https?:\/\//i.test(logo)) {
    const icon = escapeHtml(logo);
    next = replaceNamed(next, "property", "og:image", icon);
    next = replaceLinkHref(next, "icon", icon);
    next = replaceLinkHref(next, "apple-touch-icon", icon);
  }
  return next;
}
