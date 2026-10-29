import { useEffect, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { useCatalog } from "../catalog";
import { money } from "../format";
import { buildOrderText } from "../order";
import { useCart } from "../cart";
import { useUI } from "../router";
import { PageHead } from "../ui";

export default function Checkout() {
  const { shop, ready, missing } = useCatalog();
  const { lines, total, customer, setCustomer } = useCart();
  const { goHome, route } = useUI();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [paying, setPaying] = useState(false);
  const box = useRef(null);
  const checkoutRef = useRef(null);
  const waiting = !ready || (route.slug && shop.slug !== route.slug && !missing);
  const text = lines.length ? buildOrderText({ shop, customer, lines, total }) : "";

  useEffect(
    () => () => {
      checkoutRef.current?.destroy?.();
    },
    [],
  );

  async function submit(event) {
    event.preventDefault();
    if (!lines.length) {
      setError("Adicione itens na sacola.");
      return;
    }
    if (!shop.open) {
      setError("A loja está fechada no momento.");
      return;
    }
    if (customer.name.trim().length < 2) {
      setError("Informe seu nome.");
      return;
    }
    if (customer.mode === "entrega" && customer.address.trim().length < 6) {
      setError("Informe o endereço da entrega.");
      return;
    }
    if (!shop.stripePublishableKey) {
      setError("Falta a chave publicável da Stripe nas configurações da loja.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: shop.slug,
          origin: window.location.origin,
          customer,
          lines: lines.map((line) => ({
            productId: line.productId,
            qty: line.qty,
            note: line.note,
            options: line.options,
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.clientSecret) {
        setError(payload.error || "Não foi possível iniciar o pagamento.");
        return;
      }
      const stripe = await loadStripe(payload.publishableKey || shop.stripePublishableKey);
      if (!stripe) {
        setError("Não foi possível abrir o pagamento.");
        return;
      }
      checkoutRef.current?.destroy?.();
      const checkout = await stripe.initEmbeddedCheckout({ clientSecret: payload.clientSecret });
      checkoutRef.current = checkout;
      setPaying(true);
      checkout.mount(box.current);
    } catch {
      setError("Não foi possível falar com o servidor de pagamento. Rode npm run pay.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="checkout-page">
      <PageHead title="Finalizar pedido" />
      {waiting ? (
        <div className="empty">
          <h2>Carregando o pedido</h2>
        </div>
      ) : lines.length === 0 ? (
        <div className="empty">
          <h2>Sua sacola está vazia</h2>
          <button type="button" className="primary" onClick={goHome}>
            Ver cardápio
          </button>
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <label>
            Seu nome
            <input
              value={customer.name}
              autoComplete="name"
              maxLength={80}
              placeholder="Nome e sobrenome"
              disabled={paying}
              onChange={(event) => setCustomer({ name: event.target.value })}
            />
          </label>

          <div>
            <p className="field-label">Como você quer receber</p>
            <div className="choices">
              <button
                type="button"
                className="choice"
                aria-pressed={customer.mode === "retirada"}
                disabled={paying}
                onClick={() => setCustomer({ mode: "retirada" })}
              >
                <span>Retirada no balcão</span>
                <span className={customer.mode === "retirada" ? "radio on" : "radio"} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="choice"
                aria-pressed={customer.mode === "entrega"}
                disabled={paying}
                onClick={() => setCustomer({ mode: "entrega" })}
              >
                <span>Entrega</span>
                <span className={customer.mode === "entrega" ? "radio on" : "radio"} aria-hidden="true" />
              </button>
            </div>
          </div>

          {customer.mode === "entrega" ? (
            <label>
              Endereço
              <input
                value={customer.address}
                autoComplete="street-address"
                maxLength={160}
                placeholder="Rua, número e bairro"
                disabled={paying}
                onChange={(event) => setCustomer({ address: event.target.value })}
              />
            </label>
          ) : null}

          <label>
            Observações do pedido
            <textarea
              rows={2}
              maxLength={200}
              placeholder="Ex.: sem pressa, interfone 2"
              value={customer.notes}
              disabled={paying}
              onChange={(event) => setCustomer({ notes: event.target.value })}
            />
          </label>

          <section className="summary">
            <h2>Seu pedido</h2>
            {lines.map((line) => (
              <p key={line.id}>
                <span>
                  {line.qty}x {line.product.name}
                </span>
                <span>{money(line.total)}</span>
              </p>
            ))}
            <p className="sum">
              <span>Total</span>
              <strong>{money(total)}</strong>
            </p>
          </section>

          {!paying ? <pre className="preview">{text}</pre> : null}

          {error ? <p className="form-error">{error}</p> : null}
          <p className="hint">Pague agora. Depois da confirmação, o pedido vai direto para a loja.</p>

          {paying ? null : (
            <button type="submit" className="primary" disabled={pending}>
              <span>{pending ? "Abrindo pagamento…" : "Pagar"}</span>
              <span>{money(total)}</span>
            </button>
          )}
          <div ref={box} className="stripe-box" hidden={!paying} />
        </form>
      )}
    </div>
  );
}
