import { deliveryQuoteFromKm, kmBetween } from "../src/freight.js";

const cache = new Map();

async function geocode(address) {
  const key = String(address || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (key.length < 6) return null;
  if (cache.has(key)) return cache.get(key);

  const query = new URL("https://nominatim.openstreetmap.org/search");
  query.searchParams.set("format", "jsonv2");
  query.searchParams.set("limit", "1");
  query.searchParams.set("countrycodes", "br");
  query.searchParams.set("q", `${key}, Brasil`);

  const response = await fetch(query, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Pediaqui/1.0 (https://app.pediaqui.dev.br)",
    },
  });
  if (!response.ok) return null;
  const rows = await response.json();
  const hit = Array.isArray(rows) ? rows[0] : null;
  const point = hit
    ? { lat: Number(hit.lat), lon: Number(hit.lon) }
    : null;
  const ok = point && Number.isFinite(point.lat) && Number.isFinite(point.lon) ? point : null;
  if (ok) {
    cache.set(key, ok);
    if (cache.size > 400) {
      const first = cache.keys().next().value;
      cache.delete(first);
    }
  }
  return ok;
}

export async function quoteDelivery(shopAddress, customerAddress) {
  const origin = String(shopAddress || "").trim();
  const dest = String(customerAddress || "").trim();
  if (origin.length < 6) {
    return { error: "A loja ainda não cadastrou o endereço para calcular o frete." };
  }
  if (dest.length < 6) {
    return { error: "Informe o endereço da entrega, com rua, número e bairro." };
  }
  const from = await geocode(origin);
  const to = await geocode(dest);
  if (!from || !to) {
    return { error: "Não encontramos esse endereço. Inclua rua, número e bairro." };
  }
  return deliveryQuoteFromKm(kmBetween(from, to));
}
