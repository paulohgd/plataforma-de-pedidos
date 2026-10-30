import { useEffect, useRef, useState } from "react";
import { useCart } from "../cart";
import { paidMessage, paidTitle } from "../config";
import { PaidCopy } from "../PaidCopy";
import { useUI } from "../router";
import { PageHead } from "../ui";

export default function Paid() {
  const { goHome, route } = useUI();
  const { clear } = useCart();
  const [state, setState] = useState({ status: "loading", error: "", title: paidTitle, message: paidMessage });
  const cleared = useRef(false);

  useEffect(() => {
    if (!route.slug) return;
    localStorage.removeItem(`pedido-sacola:${route.slug}`);
    clear();
  }, [route.slug, clear]);

  useEffect(() => {
    const sessionId = new URLSearchParams(window.location.search).get("session_id") || "";
    if (!sessionId) {
      setState({ status: "error", error: "Pagamento não encontrado.", title: paidTitle, message: paidMessage });
      return;
    }

    let cancel = false;
    async function load() {
      try {
        const response = await fetch(`/api/checkout-session?session_id=${encodeURIComponent(sessionId)}`);
        const payload = await response.json();
        if (cancel) return;
        if (!response.ok) {
          setState({
            status: "error",
            error: payload.error || "Não foi possível confirmar o pagamento.",
            title: paidTitle,
            message: paidMessage,
          });
          return;
        }
        if (!payload.paid) {
          setState({
            status: "error",
            error: "O pagamento ainda não foi confirmado.",
            title: paidTitle,
            message: paidMessage,
          });
          return;
        }
        if (!cleared.current) {
          cleared.current = true;
          clear();
        }
        setState({
          status: "paid",
          error: "",
          title: payload.paidTitle || paidTitle,
          message: payload.paidMessage || paidMessage,
        });
      } catch {
        if (!cancel) {
          setState({
            status: "error",
            error: "Não foi possível confirmar o pagamento.",
            title: paidTitle,
            message: paidMessage,
          });
        }
      }
    }
    load();
    return () => {
      cancel = true;
    };
  }, [clear]);

  return (
    <div className="checkout-page">
      <PageHead title="Pedido pago" />
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
            <button type="button" className="primary" onClick={goHome}>
              Voltar ao cardápio
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}
