import { useEffect, useState } from "react";
import { useCatalog } from "../catalog";
import { money } from "../format";
import { useUI } from "../router";
import { PageHead, Thumb } from "../ui";
import RequireOwner from "./RequireOwner";

function CategoryRow({ category, count, onRename, onRemove }) {
  const [name, setName] = useState(category.name);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setName(category.name);
  }, [category.name]);

  async function commit() {
    const next = name.trim();
    if (!next || next === category.name) {
      setName(category.name);
      return;
    }
    const error = await onRename(category.id, next);
    if (error) setName(category.name);
  }

  return (
    <article className="admin-card">
      <label className="grow">
        Nome da categoria
        <input
          value={name}
          maxLength={40}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </label>
      <p className="muted">
        {count === 1 ? "1 produto vinculado" : `${count} produtos vinculados`}
      </p>
      {confirming ? (
        <div className="confirm-row">
          <span>Remover {category.name}?</span>
          <button type="button" className="text-btn danger" onClick={() => onRemove(category.id)}>
            Remover
          </button>
          <button type="button" className="text-btn" onClick={() => setConfirming(false)}>
            Cancelar
          </button>
        </div>
      ) : (
        <button type="button" className="text-btn danger" onClick={() => setConfirming(true)}>
          Remover categoria
        </button>
      )}
    </article>
  );
}

function ProductRow({ product, categoryName, onEdit, onRemove }) {
  const [confirming, setConfirming] = useState(false);

  return (
    <article className="admin-card product-card">
      <Thumb src={product.image} className="thumb" />
      <div className="grow">
        <strong>{product.name}</strong>
        <p className="muted">
          {categoryName} · {money(product.price)}
        </p>
        {confirming ? (
          <div className="confirm-row">
            <span>Remover este produto?</span>
            <button type="button" className="text-btn danger" onClick={() => onRemove(product.id)}>
              Remover
            </button>
            <button type="button" className="text-btn" onClick={() => setConfirming(false)}>
              Cancelar
            </button>
          </div>
        ) : (
          <div className="confirm-row">
            <button type="button" className="text-btn" onClick={() => onEdit(product.id)}>
              Editar
            </button>
            <button type="button" className="text-btn danger" onClick={() => setConfirming(true)}>
              Remover
            </button>
          </div>
        )}
      </div>
    </article>
  );
}

function AdminPanel() {
  const { shop, categories, products, account, logout, updateShop, addCategory, renameCategory, removeCategory, removeProduct, removeAccount } = useCatalog();
  const { route, goHome, openAdmin, openProductForm, notify } = useUI();
  const [tab, setTab] = useState(route.tab || "produtos");
  const [error, setError] = useState("");
  const [categoryName, setCategoryName] = useState("");
  const [confirmAccount, setConfirmAccount] = useState(false);
  const [shopForm, setShopForm] = useState({
    name: shop.name,
    whatsapp: shop.whatsapp,
    address: shop.address,
    hours: shop.hours,
    open: shop.open,
    openLabel: shop.openLabel,
    closedLabel: shop.closedLabel,
  });

  useEffect(() => {
    if (route.tab) setTab(route.tab);
  }, [route.tab]);

  function showError(message) {
    setError(message);
    return message;
  }

  function changeTab(next) {
    setError("");
    setTab(next);
    openAdmin(next, true);
  }

  async function submitCategory(event) {
    event.preventDefault();
    const message = await addCategory(categoryName);
    if (message) {
      showError(message);
      return;
    }
    setCategoryName("");
    setError("");
    notify("Categoria adicionada.");
  }

  async function submitShop(event) {
    event.preventDefault();
    const message = await updateShop(shopForm);
    if (message) {
      showError(message);
      return;
    }
    setError("");
    notify("Dados da loja salvos.");
  }

  const loose = products.filter((product) => !categories.some((category) => category.id === product.category));

  return (
    <div className="admin-page">
      <PageHead title="Configurar loja" onBack={goHome} />
      <div className="admin-session">
        <span>
          {account.name}
          <small>{account.email}</small>
        </span>
        <button type="button" className="text-btn" onClick={() => { logout(); goHome(); }}>
          Sair
        </button>
      </div>
      <div className="admin-tabs" role="tablist" aria-label="Configuração">
        {[
          ["produtos", "Produtos"],
          ["categorias", "Categorias"],
          ["loja", "Loja"],
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? "on" : ""} onClick={() => changeTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {error ? (
        <p className="form-error admin-alert" role="alert">
          {error}
        </p>
      ) : null}

      {tab === "produtos" ? (
        <div className="admin-list">
          <button type="button" className="primary" disabled={categories.length === 0} onClick={() => openProductForm()}>
            Novo produto
          </button>
          {categories.length === 0 ? (
            <p className="hint">Crie uma categoria antes de cadastrar um produto. No cadastro, ela aparece para vincular o item.</p>
          ) : (
            <p className="hint">Toque em editar para trocar a foto, o preço, o texto ou a categoria.</p>
          )}
          {categories.map((category) => {
            const items = products.filter((product) => product.category === category.id);
            return (
              <section key={category.id}>
                <h2 className="block-title">{category.name}</h2>
                {items.length === 0 ? <p className="empty-inline">Nenhum produto nesta categoria.</p> : null}
                {items.map((product) => (
                  <ProductRow
                    key={product.id}
                    product={product}
                    categoryName={category.name}
                    onEdit={openProductForm}
                    onRemove={async (id) => {
                      const message = await removeProduct(id);
                      if (message) showError(message);
                      else notify("Produto removido.");
                    }}
                  />
                ))}
              </section>
            );
          })}
          {loose.length > 0 ? (
            <section>
              <h2 className="block-title">Sem categoria</h2>
              {loose.map((product) => (
                <ProductRow
                  key={product.id}
                  product={product}
                  categoryName="Sem categoria"
                  onEdit={openProductForm}
                  onRemove={async (id) => {
                    const message = await removeProduct(id);
                    if (message) showError(message);
                    else notify("Produto removido.");
                  }}
                />
              ))}
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "categorias" ? (
        <div className="admin-list">
          <form className="form inset" onSubmit={submitCategory}>
            <label>
              Nova categoria
              <input
                value={categoryName}
                maxLength={40}
                placeholder="Ex.: Combos"
                onChange={(event) => setCategoryName(event.target.value)}
              />
            </label>
            <button type="submit" className="primary">
              Adicionar categoria
            </button>
            <p className="hint">Essas categorias aparecem no cadastro do produto para você vincular o item.</p>
          </form>
          {categories.length === 0 ? <p className="empty-inline">Nenhuma categoria cadastrada.</p> : null}
          {categories.map((category) => (
            <CategoryRow
              key={category.id}
              category={category}
              count={products.filter((product) => product.category === category.id).length}
              onRename={async (id, name) => {
                const message = await renameCategory(id, name);
                if (message) showError(message);
                else setError("");
                return message;
              }}
              onRemove={async (id) => {
                const message = await removeCategory(id);
                if (message) showError(message);
                else {
                  setError("");
                  notify("Categoria removida.");
                }
              }}
            />
          ))}
        </div>
      ) : null}

      {tab === "loja" ? (
        <>
        <form className="form" onSubmit={submitShop}>
          <label>
            Nome da loja
            <input value={shopForm.name} maxLength={60} onChange={(event) => setShopForm({ ...shopForm, name: event.target.value })} />
          </label>
          <label>
            WhatsApp
            <input
              inputMode="numeric"
              placeholder="5511987654321"
              value={shopForm.whatsapp}
              onChange={(event) => setShopForm({ ...shopForm, whatsapp: event.target.value })}
            />
          </label>
          <p className="hint">DDI e DDD, só números. O pedido do cliente abre nesse WhatsApp.</p>
          <label>
            Endereço
            <input value={shopForm.address} maxLength={120} onChange={(event) => setShopForm({ ...shopForm, address: event.target.value })} />
          </label>
          <label>
            Horário
            <input value={shopForm.hours} maxLength={80} onChange={(event) => setShopForm({ ...shopForm, hours: event.target.value })} />
          </label>
          <label>
            Texto com a loja aberta
            <input value={shopForm.openLabel} maxLength={60} onChange={(event) => setShopForm({ ...shopForm, openLabel: event.target.value })} />
          </label>
          <label>
            Texto com a loja fechada
            <input value={shopForm.closedLabel} maxLength={80} onChange={(event) => setShopForm({ ...shopForm, closedLabel: event.target.value })} />
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={shopForm.open}
              onChange={(event) => setShopForm({ ...shopForm, open: event.target.checked })}
            />
            Aceitando pedidos agora
          </label>
          <button type="submit" className="primary">
            Salvar dados da loja
          </button>
        </form>
        <div className="form">
          <p className="hint">Esta conta é a dona da loja. Apagar a conta apaga a loja, os produtos e as fotos.</p>
          {confirmAccount ? (
            <div className="confirm-row">
              <span>Apagar a conta e a loja?</span>
              <button
                type="button"
                className="text-btn danger"
                onClick={async () => {
                  const message = await removeAccount();
                  if (message) {
                    showError(message);
                    return;
                  }
                  notify("Conta e loja apagadas.");
                  goHome();
                }}
              >
                Apagar
              </button>
              <button type="button" className="text-btn" onClick={() => setConfirmAccount(false)}>
                Cancelar
              </button>
            </div>
          ) : (
            <button type="button" className="text-btn danger" onClick={() => setConfirmAccount(true)}>
              Apagar conta e loja
            </button>
          )}
        </div>
        </>
      ) : null}
    </div>
  );
}

export default function Admin() {
  return (
    <RequireOwner>
      <AdminPanel />
    </RequireOwner>
  );
}
