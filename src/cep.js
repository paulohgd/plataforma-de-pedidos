export function cepDigits(value) {
  return String(value || "").replace(/\D/g, "").slice(0, 8);
}

export function formatCep(value) {
  const digits = cepDigits(value);
  if (digits.length <= 5) return digits;
  return `${digits.slice(0, 5)}-${digits.slice(5)}`;
}

export function extractCep(value) {
  const digits = String(value || "").replace(/\D/g, "");
  const match = digits.match(/(\d{8})/);
  return match ? match[1] : "";
}

export function composeAddress({ street, number, complement, neighborhood, city, uf, cep } = {}) {
  const line = [String(street || "").trim(), String(number || "").trim()].filter(Boolean).join(", ");
  const extra = [String(complement || "").trim(), String(neighborhood || "").trim()].filter(Boolean).join(" — ");
  const cityUf = [String(city || "").trim(), String(uf || "").trim()].filter(Boolean).join(" - ");
  return [line, extra, cityUf, formatCep(cep)].filter(Boolean).join(", ");
}

export async function lookupCep(value) {
  const cep = cepDigits(value);
  if (cep.length !== 8) return { error: "Informe um CEP com 8 números." };
  const response = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
  const data = await response.json().catch(() => null);
  if (!response.ok || !data || data.erro) return { error: "CEP não encontrado." };
  return {
    cep,
    street: String(data.logradouro || "").trim(),
    neighborhood: String(data.bairro || "").trim(),
    city: String(data.localidade || "").trim(),
    uf: String(data.uf || "").trim(),
  };
}
