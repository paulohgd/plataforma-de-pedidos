import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { applyShopMeta, shopSlugFromPath } from "./src/shopMeta.js";

async function shopPreview(env, slug) {
  const url = env.VITE_SUPABASE_URL;
  const key = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key || !slug) return null;
  const query = new URL(`${url}/rest/v1/shops`);
  query.searchParams.set("slug", `eq.${slug}`);
  query.searchParams.set("select", "name,hours,address");
  const response = await fetch(query, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return rows[0] || null;
}

function shopTitlePlugin(env) {
  return {
    name: "shop-title",
    transformIndexHtml: {
      order: "pre",
      async handler(html, ctx) {
        const slug = shopSlugFromPath(ctx.originalUrl || ctx.path || "");
        if (!slug) return html;
        const shop = await shopPreview(env, slug);
        if (!shop) {
          return applyShopMeta(html, { name: "Loja não encontrada", description: "Essa loja não existe." });
        }
        return applyShopMeta(html, {
          name: shop.name,
          description: shop.hours || shop.address || "Peça pelo cardápio.",
        });
      },
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
