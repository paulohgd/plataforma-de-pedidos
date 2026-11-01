import fs from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { applyShopMeta, shopSlugFromPath } from "./src/shopMeta.js";

function shopOrigin(env) {
  return String(env.APP_ORIGIN || env.VITE_APP_ORIGIN || "https://app.pediaqui.dev.br").replace(/\/$/, "");
}

async function fetchShops(env, slug = "") {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return [];
  const query = new URL(`${url}/rest/v1/shops`);
  query.searchParams.set("select", "name,slug,hours,address,logo");
  if (slug) query.searchParams.set("slug", `eq.${slug}`);
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  let response = await fetch(query, { headers });
  if (!response.ok) {
    query.searchParams.set("select", "name,slug,hours,address");
    response = await fetch(query, { headers });
  }
  if (!response.ok) return [];
  const rows = await response.json();
  return Array.isArray(rows) ? rows.filter((row) => row?.slug && row?.name) : [];
}

function shopMetaFrom(shop, env) {
  return {
    name: shop.name,
    description: shop.hours || shop.address || "Peça pelo cardápio.",
    url: `${shopOrigin(env)}/loja/${encodeURIComponent(shop.slug)}`,
    logo: shop.logo || "",
  };
}

function shopTitlePlugin(env) {
  return {
    name: "shop-title",
    transformIndexHtml: {
      order: "pre",
      async handler(html, ctx) {
        const slug = shopSlugFromPath(ctx.originalUrl || ctx.path || "");
        if (!slug) return html;
        const [shop] = await fetchShops(env, slug);
        if (!shop) {
          return applyShopMeta(html, { name: "Loja não encontrada", description: "Essa loja não existe.", missing: true });
        }
        return applyShopMeta(html, shopMetaFrom(shop, env));
      },
    },
    async closeBundle() {
      const outDir = path.resolve("dist");
      const indexPath = path.join(outDir, "index.html");
      if (!fs.existsSync(indexPath)) return;
      const template = fs.readFileSync(indexPath, "utf8");
      const shops = await fetchShops(env);
      for (const shop of shops) {
        const dir = path.join(outDir, "loja", shop.slug);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "index.html"), applyShopMeta(template, shopMetaFrom(shop, env)));
      }
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), shopTitlePlugin(env)],
    server: {
      port: 5173,
      host: true,
      proxy: {
        "/api": "http://127.0.0.1:8787",
      },
    },
  };
});
