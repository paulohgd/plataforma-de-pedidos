import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyShopMeta, shopSlugFromPath } from "../src/shopMeta.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const htmlFiles = [
  process.env.APP_INDEX || "",
  "/var/www/pedidos/index.html",
  path.join(root, "dist", "index.html"),
  path.join(root, "index.html"),
].filter(Boolean);

let cached = { path: "", html: "", mtime: 0 };

function readIndexHtml() {
  for (const file of htmlFiles) {
    try {
      const stat = fs.statSync(file);
      if (cached.path === file && cached.mtime === stat.mtimeMs) return cached.html;
      const html = fs.readFileSync(file, "utf8");
      cached = { path: file, html, mtime: stat.mtimeMs };
      return html;
    } catch {
      continue;
    }
  }
  return "";
}

function publicUrl(request, pathname) {
  const proto = String(request.headers["x-forwarded-proto"] || "http")
    .split(",")[0]
    .trim() || "http";
  const host = String(request.headers["x-forwarded-host"] || request.headers.host || "")
    .split(",")[0]
    .trim();
  if (!host) return "";
  return `${proto}://${host}${pathname}`;
}

function sendHtml(response, status, html) {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(html);
}

export function isShopPage(method, pathname) {
  return method === "GET" && shopSlugFromPath(pathname);
}

export async function sendShopPage(request, response, url, supabase) {
  const template = readIndexHtml();
  if (!template) {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: "Página da loja não encontrada." }));
    return;
  }
  const slug = shopSlugFromPath(url.pathname);
  let shop = { name: "Cardápio", description: "Peça pelo cardápio." };
  if (supabase && slug) {
    const { data } = await supabase.from("shops").select("name, hours, address, slug").eq("slug", slug).maybeSingle();
    if (data) {
      shop = {
        name: data.name || "Cardápio",
        description: data.hours || data.address || "Peça pelo cardápio.",
      };
    } else {
      shop = { name: "Loja não encontrada", description: "Essa loja não existe." };
    }
  }
  shop.url = publicUrl(request, url.pathname);
  sendHtml(response, 200, applyShopMeta(template, shop));
}
