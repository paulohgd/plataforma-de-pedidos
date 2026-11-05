import { cepDigits, composeAddress, extractCep } from "../src/cep.js";
import { deliveryQuoteFromKm, kmBetween } from "../src/freight.js";

const cache = new Map();
const AGENT = "Pediaqui/1.0 (https://app.pediaqui.dev.br)";

function remember(key, value) {
  if (value == null) return null;
  cache.set(key, value);
  if (cache.size > 400) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  return value;
}

function pointFrom(hit) {
  const lat = Number(hit?.lat);
  const lon = Number(hit?.lon);
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || 8000);
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": AGENT,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
      },
      body: options.body,
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function nominatim(params) {
  const query = new URL("https://nominatim.openstreetmap.org/search");
  query.searchParams.set("format", "jsonv2");
  query.searchParams.set("limit", "1");
  query.searchParams.set("countrycodes", "br");
  for (const [key, value] of Object.entries(params)) {
    if (value) query.searchParams.set(key, value);
  }
  const rows = await fetchJson(query, { timeout: 8000 });
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
  const data = await fetchJson(`https://viacep.com.br/ws/${digits}/json/`);
  if (!data || data.erro) return null;
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

async function geocodeCep(cep, extra = {}) {
  const digits = cepDigits(cep) || extractCep(cep);
  if (digits.length !== 8) return null;
  const number = String(extra.number || "").trim();
  const cacheKey = `cep:${digits}:${number.toLowerCase()}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const place = await lookupViaCep(digits);
  const street = place?.street ? [number, place.street].filter(Boolean).join(" ") : "";
  const query = place ? composeAddress({ ...place, number, cep: digits }) : `${digits}, Brasil`;
  const point =
    (street &&
      (await nominatim({
        street,
        city: place.city || "",
        state: place.uf || "",
        postalcode: digits,
      }))) ||
    (await geocode(query)) ||
    (await nominatim({ postalcode: digits, city: place?.city || "", state: place?.uf || "" })) ||
    (await nominatim({ postalcode: digits }));
  return remember(cacheKey, point);
}

async function locate(place = {}) {
  if (typeof place === "string") {
    const address = place.trim();
    return (extractCep(address) && (await geocodeCep(extractCep(address)))) || geocode(address);
  }
  const address = String(place.address || "").trim();
  const cep = cepDigits(place.cep) || extractCep(address);
  const number = String(place.number || "").trim();
  if (cep) {
    const point = await geocodeCep(cep, { number, address });
    if (point) return point;
  }
  if (address.length >= 6) return geocode(address);
  return null;
}

async function valhallaKm(from, to) {
  const payload = JSON.stringify({
    locations: [
      { lat: from.lat, lon: from.lon },
      { lat: to.lat, lon: to.lon },
    ],
    costing: "auto",
    directions_options: { units: "kilometers" },
  });
  const hosts = ["https://valhalla1.openstreetmap.de", "https://valhalla.routing.osm.de"];
  for (const host of hosts) {
    const data = await fetchJson(`${host}/route?json=${encodeURIComponent(payload)}`);
    const length = Number(data?.trip?.summary?.length);
    if (!Number.isFinite(length) || length <= 0) continue;
    const units = String(data?.trip?.units || "kilometers").toLowerCase();
    return units.startsWith("mile") ? length * 1.60934 : length;
  }
  return null;
}

async function osrmKm(from, to) {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const data = await fetchJson(url);
  const meters = Number(data?.routes?.[0]?.distance);
  return Number.isFinite(meters) && meters > 0 ? meters / 1000 : null;
}

async function drivingKm(from, to) {
  const key = `drv:${from.lat.toFixed(5)},${from.lon.toFixed(5)}:${to.lat.toFixed(5)},${to.lon.toFixed(5)}`;
  if (cache.has(key)) return cache.get(key);
  const km = (await valhallaKm(from, to)) || (await osrmKm(from, to));
  if (!Number.isFinite(km) || km < 0) return null;
  return remember(key, km);
}

function asPlace(value) {
  return typeof value === "string" ? { address: value, cep: extractCep(value) } : value || {};
}

export async function quoteDelivery(shop = {}, dest = {}) {
  const origin = asPlace(shop);
  const target = asPlace(dest);
  const shopCep = cepDigits(origin.cep) || extractCep(origin.address);
  const destCep = cepDigits(target.cep) || extractCep(target.address);

  if (!shopCep && String(origin.address || "").length < 6) {
    return { error: "A loja ainda não cadastrou o CEP para calcular o frete." };
  }
  if (!destCep && String(target.address || "").length < 6) {
    return { error: "Informe o CEP da entrega." };
  }

  const from = await locate(origin);
  const to = await locate(target);
  if (!from || !to) {
    return { error: "Não encontramos esse CEP. Confira os números e tente de novo." };
  }
  const km = (await drivingKm(from, to)) ?? kmBetween(from, to);
  return deliveryQuoteFromKm(km, { maxKm: origin.deliveryMaxKm, fees: origin.deliveryFees });
}
