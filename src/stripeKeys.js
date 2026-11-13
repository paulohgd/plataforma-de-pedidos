export function cleanStripeKey(value) {
  return String(value || "").trim();
}

export function isStripePublishableKey(value) {
  return /^pk_(test|live)_[A-Za-z0-9]+$/.test(cleanStripeKey(value));
}

export function isStripeSecretKey(value) {
  return /^sk_(test|live)_[A-Za-z0-9]+$/.test(cleanStripeKey(value));
}

export function asStripePublishableKey(value) {
  const text = cleanStripeKey(value);
  return isStripePublishableKey(text) ? text : "";
}

export function asStripeSecretKey(value) {
  const text = cleanStripeKey(value);
  return isStripeSecretKey(text) ? text : "";
}

export function isStripeTestKey(value) {
  return /^(pk|sk)_test_/i.test(cleanStripeKey(value));
}
