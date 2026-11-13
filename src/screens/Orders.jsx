import { useEffect, useState } from "react";
import { useCatalog } from "../catalog";
import { formatCountdown, money } from "../format";
import { myOrderStatus, orderExpiresAt, readMyOrders, refreshMyOrder } from "../myOrders";
import { useUI } from "../router";
import { BottomNav, PageHead, Thumb } from "../ui";

function OrderCard({ order, now, onPay, onCopy, copiedId, onNewOrder }) {
  const status = myOrderStatus(order, now);
  const expiresAt = orderExpiresAt(order);
  const msLeft = expiresAt ? expiresAt - now : 0;
  const pixAlive = status === "pending" && order.payment === "pix" && Boolean(order.pixCopy) && msLeft > 0;
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
            Tempo restante: <strong>{formatCountdown(msLeft)}</strong>
          </p>
          <p className="hint">Chave Pix copia e cola</p>
          <textarea className="my-order-pix-code" readOnly value={order.pixCopy} rows={3} />
          <div className="my-order-actions">
            <button type="button" className="primary" onClick={() => onCopy(order)}>
              {copiedId === order.id ? "Código copiado" : "Copiar código Pix"}
            </button>
            <button type="button" className="ghost" onClick={() => onPay(order)}>
              Abrir pagamento
            </button>
          </div>
          <p className="muted">Para pagar com cartão, inicie um novo pedido. Este Pix continua válido.</p>
        </>
      ) : null}
      {status === "paid" ? (
        <p className="my-order-status ok">Pago. Seu pedido já está sendo preparado.</p>
      ) : null}
      {order.paymentDuplicate ? (
        <p className="my-order-status">Atenção: outro pedido relacionado também foi pago. A loja vai conferir.</p>
      ) : null}
      {status === "expired" ? (
        <>
          <p className="my-order-status">Código Pix expirado.</p>
          <p className="muted">Faça um novo pedido para gerar outro código e pagar.</p>
          <div className="my-order-actions">
            <button type="button" className="primary" onClick={onNewOrder}>
              Fazer novo pedido
            </button>
          </div>
        </>
      ) : null}
      {status === "canceled" ? <p className="my-order-status">Pedido cancelado</p> : null}
      {status === "pending" && order.payment === "card" ? (
        <p className="my-order-status">Aguardando pagamento no cartão.</p>
      ) : null}
      {items.length ? (
        <p className="muted">
          {items
            .slice(0, 3)
            .map((item) => `${item.qty || 1}× ${item.name}`)
            .join(" · ")}
        </p>
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
        if (status !== "pending") continue;
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
      /* o cliente ainda pode abrir o pagamento */
    }
  }

  const ongoing = orders.filter((row) => myOrderStatus(row, now) === "pending");
  const history = orders.filter((row) => myOrderStatus(row, now) !== "pending");

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
                  onNewOrder={goHome}
                />
              ))}
            </section>
          ) : null}
          {history.length ? (
            <section>
              <h2 className="block-title">Histórico</h2>
              {history.map((order) => (
                <OrderCard
                  key={order.id}
                  order={order}
                  now={now}
                  copiedId={copiedId}
                  onPay={() => {}}
                  onCopy={copyPix}
                  onNewOrder={goHome}
                />
              ))}
            </section>
          ) : null}
        </div>
      )}
      <BottomNav />
    </div>
  );
}
