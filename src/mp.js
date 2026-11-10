export function cleanMpKey(value) {
  return String(value || "").trim();
}

export function isMpCredential(value) {
  return /^(TEST|APP_USR)-.+/i.test(cleanMpKey(value));
}

export function asMpKey(value) {
  const text = cleanMpKey(value);
  return isMpCredential(text) ? text : "";
}

export function isMpTestKey(value) {
  return /^TEST-/i.test(cleanMpKey(value));
}
