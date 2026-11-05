import { money } from "./format.js";

export function kmBetween(from, to) {
  const earth = 6371;
  const rad = (value) => (Number(value) * Math.PI) / 180;
  const dLat = rad(to.lat - from.lat);
  const dLon = rad(to.lon - from.lon);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * earth * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function deliveryQuoteFromKm(km) {
  const distance = Math.round(Number(km) * 10) / 10;
  if (!Number.isFinite(distance) || distance < 0) {
    return { error: "Não foi possível calcular a distância." };
  }
  if (distance <= 2) return { km: distance, fee: 0 };
  if (distance <= 8) return { km: distance, fee: 6 };
  if (distance <= 12) return { km: distance, fee: 10 };
  return { error: "Fora da área de entrega (até 12 km)." };
}

export function formatKm(km) {
  return `${Number(km).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

export function deliveryFeeLabel(quote) {
  if (!quote || quote.error) return "";
  if (quote.fee > 0) return `${money(quote.fee)} · ${formatKm(quote.km)}`;
  return `Grátis · ${formatKm(quote.km)}`;
}
