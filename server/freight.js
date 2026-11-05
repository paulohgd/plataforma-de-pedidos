import { cepDigits, composeAddress, extractCep } from "../src/cep.js";
import { deliveryQuoteFromKm, kmBetween } from "../src/freight.js";

const cache = new Map();

function remember(key, point) {
  if (!point) return null;
  cache.set(key, point);
  if (cache.size > 400) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  return point;
}

function pointFrom(hit) {
  const lat = Number(hit?.lat);
  const lon = Number(hit?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

async function nominatim(params) {
  const query = new URL("https://nominatim.openstreetmap.org/search");
  query.searchParams.set("format", "jsonv2");
  query.searchParams.set("limit", "1");
  query.searchParams.set("countrycodes", "br");
  for (const [key, value] of Object.entries(params)) {
    if (value) query.searchParams.set(key, value);
  }
  const response = await fetch(query, {
    headers: {
      Accept: "application/json",
      "User-Agent": "Pediaqui/1.0 (https://app.pediaqui.dev.br)",
    },
  });
  if (!response.ok) return null;
  const rows = await response.json();
  return pointFrom(Array.isArray(rows) ? rows[0] : null);
}

async function geocode(address) {
  const key = String(address || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (key.length < 6) return null;
  if (cache.has(key)) return cache.get(key);
  const point = await nominatim({ q: `${key}, Brasil` });
  return remember(key, point);
}

async function lookupViaCep(cep) {
  const digits = cepDigits(cep);
  if (digits.length !== 8) return null;
  const cacheKey = `via:${digits}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  const response = await fetch(`https://viacep.com.br/ws/${digits}/json/`);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.erro) return null;
  const place = {
    cep: digits,
    street: String(data.logradouro || "").trim(),
    neighborhood: String(data.bairro || "").trim(),
    city: String(data.localidade || "").trim(),
    uf: String(data.uf || "").trim(),
  };
  cache.set(cacheKey, place);
  return place;
}

async function geocodeCep(cep) {
  const digits = cepDigits(cep) || extractCep(cep);
  if (digits.length !== 8) return null;
  const cacheKey = `cep:${digits}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const place = await lookupViaCep(digits);
  const query = place
    ? composeAddress({ ...place, cep: digits })
    : `${digits}, Brasil`;
  const point =
    (await geocode(query)) ||
    (await nominatim({ postalcode: digits, city: place?.city || "", state: place?.uf || "" })) ||
    (await nominatim({ postalcode: digits }));
  return remember(cacheKey, point);
}

export async function quoteDelivery(shop = {}, dest = {}) {
  const shopAddress = typeof shop === "string" ? shop : String(shop?.address || "").trim();
  const destAddress = typeof dest === "string" ? dest : String(dest?.address || "").trim();
  const shopCep = cepDigits(typeof shop === "string" ? extractCep(shop) : shop?.cep) || extractCep(shopAddress);
  const destCep = cepDigits(typeof dest === "string" ? extractCep(dest) : dest?.cep) || extractCep(destAddress);

  if (!shopCep && shopAddress.length < 6) {
    return { error: "A loja ainda não cadastrou o CEP para calcular o frete." };
  }
  if (!destCep && destAddress.length < 6) {
    return { error: "Informe o CEP da entrega." };
  }

  const from = (shopCep && (await geocodeCep(shopCep))) || (await geocode(shopAddress));
  const to = (destCep && (await geocodeCep(destCep))) || (await geocode(destAddress));
  if (!from || !to) {
    return { error: "Não encontramos esse CEP. Confira os números e tente de novo." };
  }
  return deliveryQuoteFromKm(kmBetween(from, to));
}
