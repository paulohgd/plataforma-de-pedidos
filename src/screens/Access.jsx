import { useState } from "react";
import { useCatalog } from "../catalog";
import { useUI } from "../router";
import { PageHead } from "../ui";

export default function Access() {
  const { account, isOwner, hasOwner, remoteError, retryStore, register, login, logout } = useCatalog();
  const { goHome, openAdmin, notify } = useUI();
  const [mode, setMode] = useState("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  function switchMode(next) {
    setMode(next);
    setError("");
  }

  async function submit(event) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = mode === "register" ? await register({ name, email, password }) : await login({ email, password });
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
    return (
      <div className="admin-page">
        <PageHead title="Área da loja" onBack={goHome} />
        <div className="form">
          <p className="hint">
            Você está na conta {account.name} ({account.email}).
          </p>
          {isOwner ? (
            <button type="button" className="primary" onClick={() => openAdmin()}>
              Configurar a loja
            </button>
          ) : hasOwner ? (
            <p className="hint">Esta conta não é a dona da loja. A loja não passa para outra conta.</p>
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
            ? hasOwner
              ? "Esta loja já tem uma conta. Entre com ela para alterar o cardápio."
              : "A conta fica com a loja. Se a conta for apagada, a loja e o cardápio também são."
            : "Entre para alterar produtos, fotos e categorias da sua loja."}
        </p>
        {mode === "register" ? (
          <label>
            Nome
            <input value={name} autoComplete="name" maxLength={60} onChange={(event) => setName(event.target.value)} />
          </label>
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
      </form>
    </div>
  );
}
