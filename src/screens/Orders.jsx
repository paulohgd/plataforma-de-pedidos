import { useEffect, useState } from "react";
import { useCatalog } from "../catalog";
import { formatCountdown, money } from "../format";
import { myOrderStatus, readMyOrders, refreshMyOrder } from "../myOrders";
import { useUI } from "../router";
import { BottomNav, PageHead, Thumb } from "../ui";

function shortPix(code) {
  const value = String(code || "").trim();
  if (value.length <= 28) return value;
  return `${value.slice(0, 22)}…`;
}

function OrderCard({ order, now, onPay, onCopy, copiedId }) {
  const status = myOrderStatus(order, now);
  const msLeft = Number(order.expiresAt || 0) - now;
  const pixOpen = (status === "pending" || status === "awaiting") && order.payment === "pix" && Boolean(order.pixCopy);
  const pixAlive = status === "pending" && order.payment === "pix" && msLeft > 0;
  const items = Array.isArray(order.items) ? order.items.filter((item) => Number(item.qty) > 0) : [];
  return (
    <article className="my-order">
      <div className="my-order-head">
        <Thumb src={order.shopLogo} className="my-order-logo" size={96} />
        <div>
          <strong>{order.shopName || "Pedido"}</strong>
          <p className="muted">
            {order.payment === "card" ? "Pagamento via cartão" : "Pagamento via Pix"}
            {order.total ? ` · ${money(Number(order.total) || 0)}` : ""}
          </p>
        </div>
      </div>
      {pixAlive ? (
        <>
          <p className="my-order-timer">
            Conclua o pagamento em até: <strong>{formatCountdown(msLeft)}</strong>
          </p>
          {order.pixCopy ? (
            <div className="my-order-pix">
              <code>{shortPix(order.pixCopy)}</code>
              <button type="button" className="linkish" onClick={() => onCopy(order)}>
                {copiedId === order.id ? "Copiado" : "Copiar"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {status === "awaiting" ? (
        <>
          <p className="my-order-status">Aguardando confirmação do Pix. Se você já pagou, aguarde.</p>
          {order.pixCopy ? (
            <div className="my-order-pix">
              <code>{shortPix(order.pixCopy)}</code>
              <button type="button" className="linkish" onClick={() => onCopy(order)}>
                {copiedId === order.id ? "Copiado" : "Copiar"}
              </button>
            </div>
          ) : null}
        </>
      ) : null}
      {status === "paid" ? <p className="my-order-status ok">Pedido confirmado</p> : null}
      {order.paymentDuplicate ? (
        <p className="my-order-status">Atenção: outro pedido relacionado também foi pago. A loja vai conferir.</p>
      ) : null}
      {status === "expired" ? <p className="my-order-status">Pix expirado. Faça um novo pedido para pagar.</p> : null}
      {status === "canceled" ? <p className="my-order-status">Pedido cancelado</p> : null}
      {pixAlive ? (
        <p className="muted">Para pagar com cartão, inicie um novo pedido. Este Pix continua válido.</p>
      ) : null}
      {items.length ? (
        <p className="muted">
          {items
            .slice(0, 3)
            .map((item) => `${item.qty || 1}× ${item.name}`)
            .join(" · ")}
        </p>
      ) : null}
      {pixOpen ? (
        <div className="my-order-actions">
          <button type="button" className="primary" onClick={() => onPay(order)}>
            {status === "awaiting" ? "Ver pagamento" : "Pagar agora"}
          </button>
        </div>
      ) : null}
    </article>
  );
}

export default function Orders() {
  const { shop, ready, missing } = useCatalog();
  const { route, openPixPay, goHome } = useUI();
  const slug = shop.slug || route.slug || "";
  const [orders, setOrders] = useState(() => readMyOrders(slug));
  const [now, setNow] = useState(() => Date.now());
  const [copiedId, setCopiedId] = useState("");
  const waiting = !ready || (route.slug && shop.slug !== route.slug && !missing);

  useEffect(() => {
    setOrders(readMyOrders(slug));
  }, [slug]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!slug) return undefined;
    let cancel = false;
    async function tick() {
      const rows = readMyOrders(slug);
      for (const row of rows) {
        if (cancel) return;
        const status = myOrderStatus(row);
        if (status !== "pending" && status !== "awaiting") continue;
        await refreshMyOrder(slug, row.id);
      }
      if (!cancel) setOrders(readMyOrders(slug));
    }
    tick();
    const timer = setInterval(tick, 2000);
    function onChange() {
      setOrders(readMyOrders(slug));
    }
    window.addEventListener("pedido-meus", onChange);
    return () => {
      cancel = true;
      clearInterval(timer);
      window.removeEventListener("pedido-meus", onChange);
    };
  }, [slug]);

  async function copyPix(order) {
    try {
      await navigator.clipboard.writeText(order.pixCopy);
      setCopiedId(order.id);
      setTimeout(() => setCopiedId(""), 2000);
    } catch {
      /* o cliente ainda pode abrir Pagar agora */
    }
  }

  const ongoing = orders.filter((row) => {
    const status = myOrderStatus(row, now);
    return status === "pending" || status === "awaiting";
  });
  const history = orders.filter((row) => {
    const status = myOrderStatus(row, now);
    return status !== "pending" && status !== "awaiting";
  });

  return (
    <div className="orders-page">
      <PageHead title="Pedidos" onBack={goHome} />
      {waiting ? (
        <div className="empty">
          <h2>Carregando os pedidos</h2>
        </div>
      ) : orders.length === 0 ? (
        <div className="empty">
          <h2>Nenhum pedido ainda</h2>
          <p>Quando você gerar um Pix ou pagar, o pedido aparece aqui.</p>
          <button type="button" className="primary" onClick={goHome}>
            Ver cardápio
          </button>
        </div>
      ) : (
        <div className="orders-list">
          {ongoing.length ? (
            <section>
              <h2 className="block-title">Em andamento</h2>
              {ongoing.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  now={now}
                  copiedId={copiedId}
                  onPay={(row) => openPixPay(row.id)}
                  onCopy={copyPix}
                />
              ))}
            </section>
          ) : null}
          {history.length ? (
            <section>
              <h2 className="block-title">Histórico</h2>
              {history.map((order) => (
                <OrderCard key={order.id} order={order} now={now} copiedId={copiedId} onPay={() => {}} onCopy={copyPix} />
              ))}
            </section>
          ) : null}
        </div>
      )}
      <BottomNav />
    </div>
  );
}
