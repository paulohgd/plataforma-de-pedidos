export function cleanCouponCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 24);
}

export function cleanCouponPercent(value) {
  const percent = Math.round(Number(String(value ?? "").replace(",", ".").replace(/[^\d.-]/g, "")));
  if (!Number.isFinite(percent) || percent < 1) return 0;
  return Math.min(percent, 100);
}

export function cleanCoupons(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const coupons = [];
  const used = new Set();
  for (const row of list) {
    const code = cleanCouponCode(row?.code);
    const percent = cleanCouponPercent(row?.percent);
    if (code.length < 3 || !percent || used.has(code)) continue;
    used.add(code);
    coupons.push({ code, percent });
    if (coupons.length >= 20) break;
  }
  return coupons;
}

export function findCoupon(list, code) {
  const needle = cleanCouponCode(code);
  if (!needle) return null;
  return cleanCoupons(list).find((row) => row.code === needle) || null;
}

export function couponDiscount(subtotal, coupon) {
  if (!coupon) return 0;
  const base = Math.max(0, Number(subtotal) || 0);
  const amount = Math.round(base * (coupon.percent / 100) * 100) / 100;
  return Math.min(base, Math.max(0, amount));
}
