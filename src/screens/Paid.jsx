import { useEffect, useRef, useState } from "react";
import { useCart } from "../cart";
import { paidMessage, paidTitle } from "../config";
import { PaidCopy } from "../PaidCopy";
import { upsertMyOrder } from "../myOrders";
import { fetchCheckoutSession, readCheckoutSessionId } from "../pay";
import { useUI } from "../router";
import { PageHead } from "../ui";

export default function Paid() {
  const { goHome, route } = useUI();
  const { clear } = useCart();
  const [state, setState] = useState({
    status: "loading",
    error: "",
    title: paidTitle,
    message: paidMessage,
    whatsappUrl: "",
  });
  const cleared = useRef(false);

  useEffect(() => {
    if (!route.slug) return;
    localStorage.removeItem(`pedido-sacola:${route.slug}`);
    clear();
  }, [route.slug, clear]);

  useEffect(() => {
    const sessionId = readCheckoutSessionId(route.slug);
    if (!sessionId) {
      setState({
        status: "error",
        error: "Não encontramos a sessão deste pagamento. Se o valor foi cobrado, o pedido já chegou na loja.",
        title: paidTitle,
        message: paidMessage,
        whatsappUrl: "",
      });
      return;
    }

    let cancel = false;
    async function load() {
      for (let attempt = 0; attempt < 8 && !cancel; attempt += 1) {
        try {
          const { payload } = await fetchCheckoutSession(sessionId);
          if (cancel) return;
          if (payload.paid) {
            if (!cleared.current) {
              cleared.current = true;
              clear();
            }
            upsertMyOrder(route.slug, { id: sessionId, status: "paid" });
            setState({
              status: "paid",
              error: "",
              title: payload.paidTitle || paidTitle,
              message: payload.paidMessage || paidMessage,
              whatsappUrl: payload.whatsappUrl || "",
            });
            return;
          }
        } catch {
          /* o webhook ainda pode confirmar o pedido */
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      if (!cancel) {
        setState({
          status: "error",
          error: "O pagamento ainda não foi confirmado. Se o valor foi cobrado, aguarde um instante e atualize a página.",
          title: paidTitle,
          message: paidMessage,
          whatsappUrl: "",
        });
      }
    }
    load();
    return () => {
      cancel = true;
    };
  }, [clear, route.slug]);

  return (
    <div className="checkout-page">
      <PageHead title="Pedido pago" onBack={goHome} />
      <div className="empty paid-box">
        {state.status === "loading" ? <h2>Confirmando o pagamento</h2> : null}
        {state.status === "error" ? (
          <>
            <h2>Não foi possível confirmar</h2>
            <p>{state.error}</p>
            <button type="button" className="primary" onClick={goHome}>
              Voltar ao cardápio
            </button>
          </>
        ) : null}
        {state.status === "paid" ? (
          <>
            <PaidCopy title={state.title} message={state.message} />
            {state.whatsappUrl ? (
              <a className="primary" href={state.whatsappUrl} target="_blank" rel="noopener noreferrer">
                Enviar pedido no WhatsApp
              </a>
            ) : null}
            <button type="button" className={state.whatsappUrl ? "ghost" : "primary"} onClick={goHome}>
              Voltar ao cardápio
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
