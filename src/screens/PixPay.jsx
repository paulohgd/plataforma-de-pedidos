import { useEffect, useRef, useState } from "react";
import { useCatalog } from "../catalog";
import { formatCountdown } from "../format";
import { refreshMyOrder, upsertMyOrder } from "../myOrders";
import { fetchCheckoutSession, rememberCheckoutSession, rememberParentOrder } from "../pay";
import { useUI } from "../router";
import { PageHead } from "../ui";

export default function PixPay() {
  const { shop } = useCatalog();
  const { route, openPaid, openOrders, goHome, openBag } = useUI();
  const sessionId = String(route.id || "").trim();
  const slug = shop.slug || route.slug || "";
  const [pixCopy, setPixCopy] = useState("");
  const [expiresAt, setExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [canceled, setCanceled] = useState(false);
  const leaving = useRef(false);
  const msLeft = expiresAt ? expiresAt - now : 0;
  const offerAlive = Boolean(pixCopy) && msLeft > 0;
  const waitingConfirm = Boolean(pixCopy) && !offerAlive && !canceled;

  function goPaid() {
    if (leaving.current) return;
    leaving.current = true;
    rememberCheckoutSession(slug, sessionId);
    upsertMyOrder(slug, { id: sessionId, status: "paid", paid: true, payment: "pix", expiresAt: 0, pixCopy: "" });
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
        if (payload.canceled) {
          setCanceled(true);
          await refreshMyOrder(slug, sessionId);
          setLoading(false);
          return;
        }
        if (payload.pixCopy) setPixCopy(payload.pixCopy);
        if (payload.expiresAt) setExpiresAt(Number(payload.expiresAt) || 0);
        setCanceled(false);
        await refreshMyOrder(slug, sessionId);
        setError("");
        setLoading(false);
      } catch {
        if (!cancel) setLoading(false);
      }
    }
    tick();
    const timer = setInterval(tick, 2000);
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
          <h2>{waitingConfirm ? "Confirmando o pagamento" : "Pedido aguardando pagamento"}</h2>
          <p className="hint">
            {waitingConfirm
              ? "Se você já pagou no banco, aguarde a confirmação. Não feche esta tela."
              : "Copie o código e pague com Pix copia e cola no aplicativo do banco."}
          </p>
          {pixCopy && !canceled ? (
            <>
              <textarea readOnly value={pixCopy} />
              {offerAlive ? (
                <p className={msLeft <= 60000 ? "pix-timer ending" : "pix-timer"}>
                  O tempo para você pagar acaba em {formatCountdown(msLeft)}
                </p>
              ) : (
                <p className="hint">O tempo da oferta acabou, mas se o Pix já foi pago estamos confirmando.</p>
              )}
              {error ? <p className="form-error">{error}</p> : null}
              <button type="button" className="primary" onClick={copyPix}>
                {copied ? "Código copiado" : "Copiar código"}
              </button>
              {offerAlive ? (
                <>
                  <p className="hint">
                    Você já iniciou um pagamento via Pix. Para pagar com cartão, será necessário iniciar um novo pedido. O
                    Pix anterior continua válido até o Mercado Pago encerrar.
                  </p>
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      rememberParentOrder(slug, sessionId);
                      openBag();
                    }}
                  >
                    Iniciar novo pedido com cartão
                  </button>
                </>
              ) : null}
            </>
          ) : (
            <>
              <p className="form-error">Este Pix expirou ou foi cancelado. Faça um novo pedido para pagar.</p>
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
