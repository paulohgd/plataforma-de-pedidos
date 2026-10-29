import { useEffect, useRef } from "react";
import { useCatalog } from "../catalog";
import { useUI } from "../router";
import { PageHead } from "../ui";

export default function RequireOwner({ children }) {
  const { account, isOwner, hasOwner, remoteError, retryStore, ready, linking } = useCatalog();
  const { openAccess, goHome, notify } = useUI();
  const sent = useRef(false);

  useEffect(() => {
    if (!ready || account || sent.current || linking) return;
    sent.current = true;
    openAccess();
  }, [ready, account, linking, openAccess]);

  if (!account) return null;

  if (linking || !ready || (hasOwner && !isOwner)) {
    return (
      <div className="admin-page">
        <PageHead title="Área da loja" onBack={goHome} />
        <div className="form">
          <p className="hint">Carregando a loja…</p>
        </div>
      </div>
    );
  }

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

  return children;
}
