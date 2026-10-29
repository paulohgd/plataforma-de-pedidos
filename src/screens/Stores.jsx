import { useCatalog } from "../catalog";
import { useUI } from "../router";

export default function Stores() {
  const { stores, listed, remoteError } = useCatalog();
  const { openShop, openAccess } = useUI();

  return (
    <div className="directory">
      <h1>Escolha a loja</h1>
      <p className="hint">Cada loja tem o próprio cardápio e o próprio endereço.</p>
      {remoteError ? (
        <p className="form-error" role="alert">
          {remoteError}
        </p>
      ) : null}
      {!listed ? <p className="hint">Carregando lojas…</p> : null}
      {listed && stores.length === 0 ? <p className="hint">Nenhuma loja publicada ainda.</p> : null}
      <div className="shop-list">
        {stores.map((shop) => (
          <button key={shop.slug} type="button" className="shop-link" onClick={() => openShop(shop.slug)}>
            <strong>{shop.name}</strong>
            <span>{shop.open ? shop.openLabel : shop.closedLabel}</span>
          </button>
        ))}
      </div>
      <button type="button" className="primary directory-create" onClick={openAccess}>
        Criar uma loja
      </button>
    </div>
  );
}
