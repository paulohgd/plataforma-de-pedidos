import { useEffect, useState } from "react";
import { useCatalog } from "../catalog";
import { useUI } from "../router";
import { PageHead } from "../ui";

export default function Access() {
  const { account, hasOwner, remoteError, authNotice, ready, linking, retryStore, register, login, resendConfirmation, logout } = useCatalog();
  const { goHome, openAdmin, notify } = useUI();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [storeName, setStoreName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (authNotice) setError(authNotice);
  }, [authNotice]);

  function switchMode(next) {
    setMode(next);
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = mode === "register" ? await register({ name, storeName, email, password }) : await login({ email, password });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      notify(result.ownsStore ? "Loja vinculada à sua conta." : "Conta acessada.");
      openAdmin();
    } catch {
      setError("Não foi possível acessar agora.");
    } finally {
      setPending(false);
    }
  }

  if (account) {
    if (pending || linking || !ready) {
      return (
        <div className="admin-page">
          <PageHead title="Área da loja" onBack={goHome} />
          <div className="form">
            <p className="hint">Carregando a loja…</p>
          </div>
        </div>
      );
    }
    return (
      <div className="admin-page">
        <PageHead title="Área da loja" onBack={goHome} />
        <div className="form">
          <p className="hint">
            Você está na conta {account.name} ({account.email}).
          </p>
          {hasOwner ? (
            <button type="button" className="primary" onClick={() => openAdmin()}>
              Configurar a loja
            </button>
          ) : (
            <>
              <p className="form-error" role="alert">
                {remoteError || "A loja desta conta ainda não foi gravada."}
              </p>
              <button
                type="button"
                className="primary"
                disabled={pending}
                onClick={async () => {
                  setPending(true);
                  const result = await retryStore();
                  setPending(false);
                  if (!result.error && result.ownsStore) {
                    notify("Loja vinculada à sua conta.");
                    openAdmin();
                  }
                }}
              >
                Tentar de novo
              </button>
            </>
          )}
          <button
            type="button"
            className="ghost"
            onClick={() => {
              logout();
              setError("");
            }}
          >
            Sair desta conta
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <PageHead title="Área da loja" onBack={goHome} />
      <div className="admin-tabs" role="tablist" aria-label="Acesso">
        <button type="button" role="tab" aria-selected={mode === "login"} className={mode === "login" ? "on" : ""} onClick={() => switchMode("login")}>
          Entrar
        </button>
        <button type="button" role="tab" aria-selected={mode === "register"} className={mode === "register" ? "on" : ""} onClick={() => switchMode("register")}>
          Criar conta
        </button>
      </div>
      <form className="form" onSubmit={submit} noValidate>
        <p className="hint">
          {mode === "register"
            ? "Cada conta cria a própria loja. O cardápio fica em /loja/nome-da-loja. Se a conta for apagada, a loja também é."
            : "Entre para alterar produtos, fotos e categorias da sua loja."}
        </p>
        {mode === "register" ? (
          <>
            <label>
              Nome
              <input value={name} autoComplete="name" maxLength={60} onChange={(event) => setName(event.target.value)} />
            </label>
            <label>
              Nome da loja
              <input value={storeName} maxLength={80} placeholder="Ex.: Mustacho Sandwich" onChange={(event) => setStoreName(event.target.value)} />
            </label>
          </>
        ) : null}
        <label>
          E-mail
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Senha
          <input
            type="password"
            autoComplete={mode === "register" ? "new-password" : "current-password"}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {mode === "register" ? <p className="hint">Mínimo de 6 caracteres.</p> : null}
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="primary" disabled={pending}>
          {pending ? "Aguarde…" : mode === "register" ? "Criar conta e abrir a loja" : "Entrar"}
        </button>
        {mode === "login" && /confirm|expirou|expir/i.test(error) ? (
          <button
            type="button"
            className="ghost"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              const message = await resendConfirmation(email);
              setPending(false);
              if (message) {
                setError(message);
                return;
              }
              setError("");
              notify("Enviamos outro e-mail de confirmação.");
            }}
          >
            Reenviar e-mail de confirmação
          </button>
        ) : null}
      </form>
    </div>
  );
}
