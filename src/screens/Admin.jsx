import { useEffect, useRef, useState } from "react";
import { paidMessage, paidTitle } from "../config";
import { useCatalog } from "../catalog";
import { formatPhone, money, saoPauloDayBounds, slugify } from "../format";
import { PaidCopy } from "../PaidCopy";
import { fetchShopOrders, fetchShopSecretStatus } from "../remote";
import { useUI } from "../router";
import { IconCalendar, PageHead, Thumb } from "../ui";
import ItemTypesPanel from "./ItemTypesPanel";
import RequireOwner from "./RequireOwner";

const ORDER_FILTERS = [
  ["paid", "Pagos"],
  ["pending", "Aguardando pagamento"],
  ["canceled", "Cancelado"],
];
const ORDER_PAGE_SIZE = 5;
const ORDER_DAYS_BACK = 5;

function isPaidOrder(order) {
  return order.status === "paid" || Boolean(order.paid_at);
}

function displayOrderStatus(order) {
  if (isPaidOrder(order)) return "paid";
  if (order.status === "canceled") return "canceled";
  if (new Date(order.created_at).getTime() < Date.now() - 60 * 60 * 1000) return "canceled";
  return "pending";
}

function orderStatusLabel(status) {
  if (status === "paid") return "Pago";
  if (status === "pending") return "Aguardando pagamento";
  return "Cancelado";
}

function formatOrderWhen(order) {
  const raw = order.paid_at || order.created_at;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

function spDayKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function todayHeading() {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "America/Sao_Paulo",
  });
}

function selectedDayHeading(daysBack) {
  return saoPauloDayBounds(daysBack).start.toLocaleDateString("pt-BR", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).replace(".", "");
}

function monthCells(anchor) {
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric" }).format(anchor));
  const month = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", month: "2-digit" }).format(anchor));
  const first = new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00-03:00`);
  const pad = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(year, month, 0).getDate();
  const cells = [];
  for (let index = pad; index > 0; index -= 1) cells.push(new Date(first.getTime() - index * 86400000));
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00-03:00`));
  }
  return {
    title: first.toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "America/Sao_Paulo" }),
    cells,
  };
}

function OrderDayPicker({ daysBack, onChange }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const today = saoPauloDayBounds(0).start;
  const allowed = new Set(Array.from({ length: ORDER_DAYS_BACK + 1 }, (_, index) => spDayKey(saoPauloDayBounds(index).start)));
  const selectedKey = spDayKey(saoPauloDayBounds(daysBack).start);
  const todayKey = spDayKey(today);
  const month = monthCells(today);

  useEffect(() => {
    function close(event) {
      if (event.type === "keydown" && event.key !== "Escape") return;
      if (event.type === "pointerdown" && box.current?.contains(event.target)) return;
      setOpen(false);
    }
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);

  return (
    <div className="order-day" ref={box}>
      <div className="order-day-bar">
        <div>
          <p className="order-today">{todayHeading()}</p>
          {daysBack > 0 ? <p className="muted">Mostrando {selectedDayHeading(daysBack)}</p> : null}
        </div>
        <button
          type="button"
          className="icon-btn"
          aria-label="Abrir calendário"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <IconCalendar />
        </button>
      </div>
      {open ? (
        <div className="mini-cal" role="dialog" aria-label="Escolher o dia dos pedidos">
          <p className="mini-cal-title">{month.title}</p>
          <div className="mini-cal-week">
            {["S", "T", "Q", "Q", "S", "S", "D"].map((label, index) => (
              <span key={`${label}-${index}`}>{label}</span>
            ))}
          </div>
          <div className="mini-cal-grid">
            {month.cells.map((date) => {
              const key = spDayKey(date);
              const pickable = allowed.has(key);
              const sameMonth = date.getUTCMonth() === today.getUTCMonth();
              return (
                <button
                  key={key}
                  type="button"
                  className={`${key === selectedKey ? "on" : pickable ? "pick" : ""}${key === todayKey ? " is-today" : ""}`.trim()}
                  disabled={!pickable}
                  onClick={() => {
                    const diff = Math.round((today.getTime() - date.getTime()) / 86400000);
                    onChange(Math.min(ORDER_DAYS_BACK, Math.max(0, diff)));
                    setOpen(false);
                  }}
                >
                  <span className={sameMonth ? "" : "faint"}>{date.getUTCDate()}</span>
                </button>
              );
            })}
          </div>
          <p className="hint">Só os últimos {ORDER_DAYS_BACK} dias.</p>
        </div>
      ) : null}
    </div>
  );
}

function CategoryRow({ category, count, index, total, onRename, onRemove, onMove }) {
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
      <div className="featured-actions">
        <button type="button" className="text-btn" disabled={index === 0} onClick={() => onMove(index, -1)}>
          Subir
        </button>
        <button type="button" className="text-btn" disabled={index === total - 1} onClick={() => onMove(index, 1)}>
          Descer
        </button>
      </div>
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

function FeaturedEditor({ products, featured, onSave, onError, notify }) {
  const [pick, setPick] = useState("");
  const [busy, setBusy] = useState(false);
  const available = products
    .filter((product) => !product.featured && product.active !== false)
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "pt-BR"));

  async function commit(ids, okText) {
    setBusy(true);
    const message = await onSave(ids);
    setBusy(false);
    if (message) {
      onError(message);
      return;
    }
    notify(okText);
  }

  function ids() {
    return featured.map((product) => product.id);
  }

  return (
    <div className="form">
      <h3 className="admin-subtitle">Destaques</h3>
      <p className="hint">Esses produtos aparecem no topo do cardápio. Marque, tire ou use as setas para mudar a ordem.</p>
      {featured.length === 0 ? <p className="empty-inline">Nenhum destaque ainda.</p> : null}
      {featured.map((product, index) => (
        <article key={product.id} className="admin-card product-card">
          <Thumb src={product.image} className="thumb" />
          <div className="grow">
            <strong>{product.name}</strong>
            <div className="featured-actions">
              <button
                type="button"
                className="text-btn"
                disabled={busy || index === 0}
                onClick={() => {
                  const next = ids();
                  [next[index - 1], next[index]] = [next[index], next[index - 1]];
                  commit(next, "Ordem dos destaques atualizada.");
                }}
              >
                Subir
              </button>
              <button
                type="button"
                className="text-btn"
                disabled={busy || index === featured.length - 1}
                onClick={() => {
                  const next = ids();
                  [next[index + 1], next[index]] = [next[index], next[index + 1]];
                  commit(next, "Ordem dos destaques atualizada.");
                }}
              >
                Descer
              </button>
              <button
                type="button"
                className="text-btn danger"
                disabled={busy}
                onClick={() => commit(ids().filter((id) => id !== product.id), "Destaque removido.")}
              >
                Tirar
              </button>
            </div>
          </div>
        </article>
      ))}
      {available.length > 0 ? (
        <div className="featured-pick">
          <label className="grow">
            Adicionar destaque
            <select value={pick} onChange={(event) => setPick(event.target.value)} disabled={busy}>
              <option value="">Escolha um produto</option>
              {available.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="ghost"
            disabled={busy || !pick}
            onClick={() => {
              if (!pick) return;
              const id = pick;
              setPick("");
              commit([...ids(), id], "Destaque adicionado.");
            }}
          >
            Adicionar
          </button>
        </div>
      ) : (
        <p className="hint">
          {products.length === 0
            ? "Cadastre produtos na aba Produtos para escolher os destaques."
            : "Todos os produtos já estão nos destaques."}
        </p>
      )}
    </div>
  );
}

function ProductRow({ product, categoryName, onEdit, onRemove, onToggle }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const available = product.active !== false;

  async function toggle() {
    if (busy) return;
    setBusy(true);
    await onToggle(product.id, !available);
    setBusy(false);
  }

  return (
    <article className={available ? "admin-card product-card" : "admin-card product-card off"}>
      <Thumb src={product.image} className="thumb" />
      <div className="grow">
        <strong>{product.name}</strong>
        <p className="muted">
          {categoryName} · {money(product.price)}
          {available ? "" : " · Fora do cardápio"}
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
            <button type="button" className="text-btn" disabled={busy} onClick={toggle}>
              {available ? "Desativar" : "Ativar"}
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
  const {
    shop,
    shopId,
    categories,
    products,
    featured,
    itemTypes,
    account,
    logout,
    updateShop,
    addCategory,
    renameCategory,
    removeCategory,
    setCategoryOrder,
    saveItemType,
    removeItemType,
    removeProduct,
    setProductActive,
    removeAccount,
    setFeaturedOrder,
  } = useCatalog();
  const { route, goHome, openAdmin, openProductForm, notify } = useUI();
  const [tab, setTab] = useState(route.tab || "produtos");
  const [error, setError] = useState("");
  const [orders, setOrders] = useState([]);
  const [categoryName, setCategoryName] = useState("");
  const [orderFilter, setOrderFilter] = useState("paid");
  const [orderDay, setOrderDay] = useState(0);
  const [orderPage, setOrderPage] = useState(1);
  const [confirmAccount, setConfirmAccount] = useState(false);
  const [secretsSaved, setSecretsSaved] = useState({ stripe: false, discord: false });
  const [shopForm, setShopForm] = useState({
    name: shop.name,
    whatsapp: shop.whatsapp,
    address: shop.address,
    hours: shop.hours,
    open: shop.open,
    openLabel: shop.openLabel,
    closedLabel: shop.closedLabel,
    stripePublishableKey: shop.stripePublishableKey || "",
    stripeSecretKey: "",
    discordWebhookUrl: "",
    paidTitle: shop.paidTitle || paidTitle,
    paidMessage: shop.paidMessage || paidMessage,
  });

  useEffect(() => {
    if (route.tab) setTab(route.tab);
  }, [route.tab]);

  useEffect(() => {
    setShopForm({
      name: shop.name,
      whatsapp: shop.whatsapp,
      address: shop.address,
      hours: shop.hours,
      open: shop.open,
      openLabel: shop.openLabel,
      closedLabel: shop.closedLabel,
      stripePublishableKey: shop.stripePublishableKey || "",
      stripeSecretKey: "",
      discordWebhookUrl: "",
      paidTitle: shop.paidTitle || paidTitle,
      paidMessage: shop.paidMessage || paidMessage,
    });
  }, [shop]);

  useEffect(() => {
    if (tab !== "loja" || !shopId) return;
    let cancel = false;
    fetchShopSecretStatus(shopId).then((result) => {
      if (cancel || result.error) return;
      setSecretsSaved({ stripe: result.stripe, discord: result.discord });
    });
    return () => {
      cancel = true;
    };
  }, [tab, shopId]);

  useEffect(() => {
    if (tab !== "pedidos") return;
    setOrderDay(0);
    setOrderPage(1);
    setOrderFilter("paid");
  }, [tab]);

  useEffect(() => {
    if (tab !== "pedidos" || !shopId) return;
    let cancel = false;
    fetchShopOrders(shopId, orderDay).then((result) => {
      if (cancel) return;
      if (result.error) showError(result.error);
      else setOrders(result.orders);
    });
    return () => {
      cancel = true;
    };
  }, [tab, shopId, orderDay]);

  function showError(message) {
    setError(message);
    return message;
  }

  async function toggleProduct(id, active) {
    const message = await setProductActive(id, active);
    if (message) showError(message);
    else {
      setError("");
      notify(active ? "Produto no cardápio." : "Produto fora do cardápio.");
    }
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
    setShopForm((current) => ({ ...current, stripeSecretKey: "", discordWebhookUrl: "" }));
    setSecretsSaved((current) => ({
      stripe: current.stripe || Boolean(shopForm.stripeSecretKey.trim()),
      discord: current.discord || Boolean(shopForm.discordWebhookUrl.trim()),
    }));
    notify("Dados da loja salvos.");
  }

  const loose = products.filter((product) => !categories.some((category) => category.id === product.category));
  const visibleOrders = orders.filter((order) => displayOrderStatus(order) === orderFilter);
  const orderPages = Math.max(1, Math.ceil(visibleOrders.length / ORDER_PAGE_SIZE));
  const currentOrderPage = Math.min(orderPage, orderPages);
  const pagedOrders = visibleOrders.slice((currentOrderPage - 1) * ORDER_PAGE_SIZE, currentOrderPage * ORDER_PAGE_SIZE);

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
          ["tipos", "Tipo do item"],
          ["pedidos", "Pedidos"],
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
            <p className="hint">Desative para tirar do cardápio sem apagar. Depois é só ativar de novo.</p>
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
                    onToggle={toggleProduct}
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
                  onToggle={toggleProduct}
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
          {categories.map((category, index) => (
            <CategoryRow
              key={category.id}
              category={category}
              index={index}
              total={categories.length}
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
              onMove={async (from, step) => {
                const next = categories.map((item) => item.id);
                const to = from + step;
                if (to < 0 || to >= next.length) return;
                [next[from], next[to]] = [next[to], next[from]];
                const message = await setCategoryOrder(next);
                if (message) showError(message);
                else setError("");
              }}
            />
          ))}
        </div>
      ) : null}

      {tab === "tipos" ? (
        <ItemTypesPanel
          types={itemTypes}
          products={products}
          onSave={saveItemType}
          onRemove={removeItemType}
          onError={showError}
          notify={(text) => {
            setError("");
            notify(text);
          }}
        />
      ) : null}

      {tab === "pedidos" ? (
        <div className="admin-list">
          <p className="hint">Pedidos pagos também vão para o Discord da loja. Sem pagamento em 1 hora, o pedido entra em Cancelado.</p>
          <OrderDayPicker
            daysBack={orderDay}
            onChange={(daysBack) => {
              setOrderDay(daysBack);
              setOrderPage(1);
            }}
          />
          <div className="admin-tabs order-filters" role="tablist" aria-label="Filtro de pedidos">
            {ORDER_FILTERS.map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={orderFilter === id}
                className={orderFilter === id ? "on" : ""}
                onClick={() => {
                  setOrderFilter(id);
                  setOrderPage(1);
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {visibleOrders.length === 0 ? (
            <p className="empty-inline">
              {orders.length === 0 ? "Nenhum pedido neste dia." : "Nenhum pedido neste filtro."}
            </p>
          ) : null}
          {pagedOrders.map((order) => {
              const when = formatOrderWhen(order);
              return (
            <article key={order.id} className="admin-card">
              <strong>
                {orderStatusLabel(displayOrderStatus(order))} · {money(Number(order.total))}
                {when ? ` · ${when}` : ""}
              </strong>
              <p className="muted">
                {order.customer_name}
                {order.customer_whatsapp ? ` · ${formatPhone(order.customer_whatsapp)}` : ""}
                {` · ${order.customer_mode === "entrega" ? "Entrega" : "Retirada"}`}
              </p>
              {order.customer_mode === "entrega" && order.customer_address ? <p className="muted">{order.customer_address}</p> : null}
              <p className="muted">
                {(order.items || []).map((item) => `${item.qty}x ${item.name}`).join(" · ")}
              </p>
            </article>
              );
            })}
          {visibleOrders.length > ORDER_PAGE_SIZE ? (
            <div className="pager">
              <button type="button" className="text-btn" disabled={currentOrderPage <= 1} onClick={() => setOrderPage(currentOrderPage - 1)}>
                Voltar
              </button>
              <p className="pager-status">
                Página {currentOrderPage} de {orderPages}
              </p>
              <button type="button" className="text-btn" disabled={currentOrderPage >= orderPages} onClick={() => setOrderPage(currentOrderPage + 1)}>
                Avançar
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "loja" ? (
        <>
        <FeaturedEditor
          products={products}
          featured={featured}
          onSave={setFeaturedOrder}
          onError={showError}
          notify={(text) => {
            setError("");
            notify(text);
          }}
        />
        <form className="form" onSubmit={submitShop}>
          <label>
            Nome da loja
            <input value={shopForm.name} maxLength={60} onChange={(event) => setShopForm({ ...shopForm, name: event.target.value })} />
          </label>
          <p className="hint">Cardápio público: /loja/{slugify(shopForm.name)}</p>
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
          <h3 className="admin-subtitle">Pagamento</h3>
          <p className="hint">Cole as chaves da conta Stripe desta loja. A chave secreta não aparece de novo depois de salvar.</p>
          <label>
            Chave publicável
            <input
              autoComplete="off"
              spellCheck="false"
              placeholder="pk_..."
              value={shopForm.stripePublishableKey}
              onChange={(event) => setShopForm({ ...shopForm, stripePublishableKey: event.target.value })}
            />
          </label>
          <label>
            Chave secreta
            <input
              type="password"
              autoComplete="new-password"
              spellCheck="false"
              placeholder={secretsSaved.stripe ? "Salva. Cole outra só se for trocar." : "sk_ ou pk_..."}
              value={shopForm.stripeSecretKey}
              onChange={(event) => setShopForm({ ...shopForm, stripeSecretKey: event.target.value })}
            />
          </label>
          <label>
            Webhook do Discord
            <input
              type="password"
              autoComplete="off"
              spellCheck="false"
              placeholder={secretsSaved.discord ? "Salvo. Cole outro só se for trocar." : "https://discord.com/api/webhooks/..."}
              value={shopForm.discordWebhookUrl}
              onChange={(event) => setShopForm({ ...shopForm, discordWebhookUrl: event.target.value })}
            />
          </label>
          <p className="hint">O pedido pago é enviado neste webhook da loja.</p>
          <h3 className="admin-subtitle">Pedido pago</h3>
          <p className="hint">Essa é a mensagem que o cliente vê depois que o pagamento confirma. Use **texto** para negrito.</p>
          <label>
            Título
            <input
              maxLength={80}
              value={shopForm.paidTitle}
              onChange={(event) => setShopForm({ ...shopForm, paidTitle: event.target.value })}
            />
          </label>
          <label>
            Mensagem
            <textarea
              rows={5}
              maxLength={800}
              value={shopForm.paidMessage}
              onChange={(event) => setShopForm({ ...shopForm, paidMessage: event.target.value })}
            />
          </label>
          <div className="empty paid-box paid-preview">
            <PaidCopy title={shopForm.paidTitle || paidTitle} message={shopForm.paidMessage || paidMessage} />
          </div>
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
