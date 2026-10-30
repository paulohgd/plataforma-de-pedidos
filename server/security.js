const DEFAULT_ORIGINS = [
  "https://app.pediaqui.dev.br",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
];

const extraOrigins = String(process.env.APP_ORIGIN || "")
  .split(",")
  .map((item) => item.trim().replace(/\/$/, ""))
  .filter(Boolean);

export const allowedOrigins = new Set([...DEFAULT_ORIGINS, ...extraOrigins]);

export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Resource-Policy": "same-origin",
};

const hits = new Map();

export function clientIp(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return forwarded || request.socket?.remoteAddress || "";
}

export function allowedOrigin(request) {
  const candidates = [
    request.headers.origin,
    request.headers.referer,
    `${String(request.headers["x-forwarded-proto"] || "http").split(",")[0].trim()}://${String(request.headers["x-forwarded-host"] || request.headers.host || "").split(",")[0].trim()}`,
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const origin = new URL(raw).origin;
      if (allowedOrigins.has(origin)) return origin;
    } catch {
      /* ignore invalid origin */
    }
  }
  return [...allowedOrigins][0];
}

export function tooMany(request, limit, windowMs) {
  const now = Date.now();
  const key = `${request.url || ""}:${clientIp(request)}`;
  const recent = (hits.get(key) || []).filter((time) => now - time < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return true;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 4000) {
    for (const [item, list] of hits) {
      if (!list.length || now - list[list.length - 1] > windowMs) hits.delete(item);
    }
  }
  return false;
}

export function readBody(request, maxBytes = 32_768) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        request.destroy();
        const error = new Error("too large");
        error.code = "PAYLOAD_TOO_LARGE";
        reject(error);
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

export async function readJson(request, maxBytes) {
  const raw = await readBody(request, maxBytes);
  try {
    return JSON.parse(raw.toString("utf8") || "{}");
  } catch {
    const error = new Error("invalid json");
    error.code = "INVALID_JSON";
    throw error;
  }
}

export function publicError(error, fallback) {
  const code = error?.code || "";
  if (code === "PAYLOAD_TOO_LARGE") return "Pedido grande demais.";
  if (code === "INVALID_JSON") return "Pedido inválido.";
  return fallback;
}
