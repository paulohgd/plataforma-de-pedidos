import { money } from "./format.js";

export const defaultDeliveryFees = [
  { upTo: 3, fee: 0 },
  { upTo: 7, fee: 8 },
  { upTo: 10, fee: 12 },
];

export const defaultDeliveryMaxKm = 10;

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

function toNumber(value) {
  if (typeof value === "number") return value;
  return Number(String(value || "").trim().replace(/\s/g, "").replace(",", "."));
}

export function cleanMinOrder(value) {
  const amount = Math.round(toNumber(value) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.min(amount, 9999);
}

export function cleanDeliveryMaxKm(value) {
  const km = Math.round(toNumber(value) * 10) / 10;
  if (!Number.isFinite(km) || km <= 0) return defaultDeliveryMaxKm;
  return Math.min(km, 80);
}

export function cleanDeliveryFees(raw) {
  const list = Array.isArray(raw) ? raw : defaultDeliveryFees;
  const fees = list
    .map((row) => ({
      upTo: Math.round(toNumber(row?.upTo) * 10) / 10,
      fee: Math.round(toNumber(row?.fee) * 100) / 100,
    }))
    .filter((row) => Number.isFinite(row.upTo) && row.upTo > 0 && Number.isFinite(row.fee) && row.fee >= 0)
    .sort((a, b) => a.upTo - b.upTo)
    .slice(0, 8);
  const unique = [];
  for (const row of fees) {
    const last = unique[unique.length - 1];
    if (last && last.upTo === row.upTo) unique[unique.length - 1] = row;
    else unique.push(row);
  }
  return unique.length ? unique : defaultDeliveryFees.map((row) => ({ ...row }));
}

export function deliveryQuoteFromKm(km, rules = {}) {
  const distance = Math.round(Number(km) * 10) / 10;
  if (!Number.isFinite(distance) || distance < 0) {
    return { error: "Não foi possível calcular a distância." };
  }
  const fees = cleanDeliveryFees(rules.fees || rules.deliveryFees);
  const maxKm = cleanDeliveryMaxKm(rules.maxKm || rules.deliveryMaxKm || fees[fees.length - 1].upTo);
  if (distance > maxKm) {
    return { error: `Fora da área de entrega (até ${formatKm(maxKm)}).` };
  }
  const band = fees.find((row) => distance <= row.upTo) || (distance <= maxKm ? fees[fees.length - 1] : null);
  if (!band) {
    return { error: `Fora da área de entrega (até ${formatKm(maxKm)}).` };
  }
  return { km: distance, fee: band.fee };
}

export function formatKm(km) {
  const value = Number(km);
  const digits = Number.isInteger(value) ? 0 : 1;
  return `${value.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: 1 })} km`;
}

export function deliveryFeeLabel(quote) {
  if (!quote || quote.error) return "";
  if (quote.fee > 0) return `${money(quote.fee)} · ${formatKm(quote.km)}`;
  return `Grátis · ${formatKm(quote.km)}`;
}

export function deliveryRulesHint(rules = {}) {
  const fees = cleanDeliveryFees(rules.fees || rules.deliveryFees);
  const parts = fees.map((row, index) => {
    const from = index === 0 ? 0 : Math.floor(fees[index - 1].upTo) + 1;
    const price = row.fee > 0 ? money(row.fee) : "grátis";
    return `${from} a ${row.upTo} km = ${price}`;
  });
  return `Frete: ${parts.join(" · ")}`;
}
