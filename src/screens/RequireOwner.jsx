import { useEffect, useRef } from "react";
import { useCatalog } from "../catalog";
import { useUI } from "../router";
import { PageHead } from "../ui";

export default function RequireOwner({ children }) {
  const { account, isOwner, hasOwner, remoteError, retryStore, logout, ready } = useCatalog();
  const { openAccess, goHome, notify } = useUI();
  const sent = useRef(false);

  useEffect(() => {
    if (!ready || account || sent.current) return;
    sent.current = true;
    openAccess();
  }, [ready, account, openAccess]);

  if (!ready || !account) return null;

  if (!isOwner && !hasOwner) {
    return (
      <div className="admin-page">
        <PageHead title="Área da loja" onBack={goHome} />
        <div className="form">
          <p className="form-error" role="alert">
            {remoteError || "A loja desta conta ainda não foi gravada."}
          </p>
          <button
            type="button"
            className="primary"
            onClick={async () => {
              const result = await retryStore();
              if (result.ownsStore) notify("Loja vinculada à sua conta.");
            }}
          >
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }

  if (hasOwner && !isOwner) {
    return (
      <div className="admin-page">
        <PageHead title="Área da loja" onBack={goHome} />
        <div className="form">
          <p className="hint">
            Esta conta não é a dona da loja. A loja fica com a conta que a criou e é apagada junto com essa conta.
          </p>
          <button
            type="button"
            className="primary"
            onClick={() => {
              logout();
              openAccess();
            }}
          >
            Entrar com outra conta
          </button>
        </div>
      </div>
    );
  }

  return children;
}
