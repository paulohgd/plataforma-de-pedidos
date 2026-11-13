import { useEffect, useRef, useState } from "react";
import { useCatalog } from "../catalog";
import { formatCountdown } from "../format";
import { refreshMyOrder, upsertMyOrder } from "../myOrders";
import { fetchCheckoutSession, rememberCheckoutSession } from "../pay";
import { useUI } from "../router";
import { PageHead } from "../ui";

export default function PixPay() {
  const { shop } = useCatalog();
  const { route, openPaid, openOrders, goHome } = useUI();
  const sessionId = String(route.id || "").trim();
  const slug = shop.slug || route.slug || "";
  const [pixCopy, setPixCopy] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const leaving = useRef(false);
  const msLeft = expiresAt ? expiresAt - now : 0;
  const alive = Boolean(pixCopy) && msLeft > 0;

  function goPaid() {
    if (leaving.current) return;
    leaving.current = true;
    rememberCheckoutSession(slug, sessionId);
    upsertMyOrder(slug, { id: sessionId, status: "paid", payment: "pix" });
    openPaid(sessionId);
  }

  useEffect(() => {
    if (!expiresAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  useEffect(() => {
    if (!sessionId || !slug) {
      setLoading(false);
      setError("Pedido não encontrado.");
      return undefined;
    }
    rememberCheckoutSession(slug, sessionId);
    let cancel = false;
    async function tick() {
      try {
        const { ok, payload } = await fetchCheckoutSession(sessionId);
        if (cancel) return;
        if (!ok) {
          setError(payload.error || "Não foi possível carregar o Pix.");
          setLoading(false);
          return;
        }
        if (payload.paid) {
          goPaid();
          return;
        }
        if (payload.pixCopy) setPixCopy(payload.pixCopy);
        if (payload.expiresAt) setExpiresAt(Number(payload.expiresAt) || 0);
        await refreshMyOrder(slug, sessionId);
        setError("");
        setLoading(false);
      } catch {
        if (!cancel) setLoading(false);
      }
    }
    tick();
    const timer = setInterval(tick, 2500);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [sessionId, slug]);

  async function copyPix() {
    try {
      await navigator.clipboard.writeText(pixCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar. Selecione o código e copie.");
    }
  }

  return (
    <div className="checkout-page pix-pay-page">
      <PageHead title="Pagamento" onBack={openOrders} />
      {loading ? (
        <div className="empty">
          <h2>Carregando o Pix</h2>
        </div>
      ) : error && !pixCopy ? (
        <div className="empty">
          <h2>Não foi possível abrir o Pix</h2>
          <p>{error}</p>
          <button type="button" className="primary" onClick={openOrders}>
            Ver pedidos
          </button>
        </div>
      ) : (
        <div className="pix-pay">
          <h2>Pedido aguardando pagamento</h2>
          <p className="hint">Copie o código e pague com Pix copia e cola no aplicativo do banco.</p>
          {alive ? (
            <>
              <textarea readOnly value={pixCopy} />
              <p className={msLeft <= 60000 ? "pix-timer ending" : "pix-timer"}>
                O tempo para você pagar acaba em {formatCountdown(msLeft)}
              </p>
              {error ? <p className="form-error">{error}</p> : null}
              <button type="button" className="primary" onClick={copyPix}>
                {copied ? "Código copiado" : "Copiar código"}
              </button>
            </>
          ) : (
            <>
              <p className="form-error">Este Pix expirou. Faça um novo pedido para pagar com Pix ou cartão.</p>
              <button type="button" className="primary" onClick={goHome}>
                Fazer novo pedido
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
