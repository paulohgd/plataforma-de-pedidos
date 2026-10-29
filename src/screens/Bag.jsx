import { money } from "../format";
import { useCart } from "../cart";
import { useUI } from "../router";
import { BottomNav, PageHead, Thumb } from "../ui";

function summary(line) {
  const parts = line.options.map((option) => (option.qty > 1 ? `${option.qty}x ${option.name}` : option.name));
  if (line.note) parts.push(line.note);
  return parts.join(" · ");
}

export default function Bag() {
  const { lines, total, setLineQty, clear } = useCart();
  const { openProduct, openCheckout, goHome } = useUI();

  return (
    <div className="bag-page">
      <PageHead title="Sacola" />
      {lines.length === 0 ? (
        <div className="empty">
          <h2>Sua sacola está vazia</h2>
          <p>Escolha um lanche no cardápio para montar o pedido.</p>
          <button type="button" className="primary" onClick={goHome}>
            Ver cardápio
          </button>
        </div>
      ) : (
        <>
          <div className="bag-list">
            {lines.map((line) => (
              <article key={line.id} className="bag-item">
                <Thumb src={line.product.image} className="bag-photo" />
                <div className="bag-body">
                  <div className="bag-top">
                    <strong>{line.product.name}</strong>
                    <span>{money(line.total)}</span>
                  </div>
                  {summary(line) ? <p className="muted">{summary(line)}</p> : null}
                  <div className="bag-actions">
                    <div className="mini">
                      <button type="button" onClick={() => setLineQty(line.id, line.qty - 1)} aria-label={`Diminuir ${line.product.name}`}>
                        −
                      </button>
                      <span>{line.qty}</span>
                      <button type="button" onClick={() => setLineQty(line.id, line.qty + 1)} aria-label={`Aumentar ${line.product.name}`}>
                        +
                      </button>
                    </div>
                    <button type="button" className="linkish" onClick={() => openProduct(line.product.id, line.id)}>
                      Editar
                    </button>
                  </div>
                </div>
              </article>
            ))}
            <button type="button" className="linkish clear" onClick={clear}>
              Limpar sacola
            </button>
          </div>
          <div className="bag-footer">
            <div className="total-row">
              <span>Total</span>
              <strong>{money(total)}</strong>
            </div>
            <button type="button" className="primary" onClick={openCheckout}>
              <span>Finalizar pedido</span>
              <span>{money(total)}</span>
            </button>
          </div>
        </>
      )}
      <BottomNav />
    </div>
  );
}
