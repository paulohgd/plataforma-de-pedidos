import { useState } from "react";
import { useCatalog } from "../catalog";
import { money } from "../format";
import { buildOrderText, openWhatsApp, shopWhatsapp } from "../order";
import { useCart } from "../cart";
import { useUI } from "../router";
import { PageHead } from "../ui";

export default function Checkout() {
  const { shop, ready, missing } = useCatalog();
  const { lines, total, customer, setCustomer } = useCart();
  const { goHome, notify, route } = useUI();
  const [error, setError] = useState("");
  const configured = shopWhatsapp(shop).length >= 12;
  const waiting = !ready || (route.slug && shop.slug !== route.slug && !missing);
  const text = lines.length ? buildOrderText({ shop, customer, lines, total }) : "";

  async function submit(event) {
    event.preventDefault();
    if (!lines.length) {
      setError("Adicione itens na sacola.");
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
    setError("");
    const opened = openWhatsApp(shop, text);
    if (opened) {
      notify("Pedido aberto no WhatsApp.");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setError("Mensagem copiada. Para abrir o WhatsApp direto, cadastre o número na área da loja.");
    } catch {
      setError("Cadastre o número da loja na área da loja para enviar pelo WhatsApp.");
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
                onClick={() => setCustomer({ mode: "retirada" })}
              >
                <span>Retirada no balcão</span>
                <span className={customer.mode === "retirada" ? "radio on" : "radio"} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="choice"
                aria-pressed={customer.mode === "entrega"}
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

          <pre className="preview">{text}</pre>

          {error ? <p className="form-error">{error}</p> : null}
          {!configured ? (
            <p className="hint">O número de WhatsApp da loja ainda não foi configurado. Cadastre em Mais informações, Configurar a loja.</p>
          ) : (
            <p className="hint">Ao continuar, o pedido abre no WhatsApp de {shop.name}, pronto para enviar.</p>
          )}

          <button type="submit" className="primary">
            <span>Enviar no WhatsApp</span>
            <span>{money(total)}</span>
          </button>
        </form>
      )}
    </div>
  );
}
