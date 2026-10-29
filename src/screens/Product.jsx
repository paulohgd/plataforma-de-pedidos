import { useEffect, useMemo, useState } from "react";
import { useCatalog } from "../catalog";
import { groupHint, money, norm } from "../format";
import { useCart } from "../cart";
import { useUI } from "../router";
import { IconBack, IconSearch, IconShare, Thumb } from "../ui";

function countSelected(group, picked) {
  const map = picked[group.id] || {};
  return group.items.reduce((sum, item) => sum + (map[item.id] || 0), 0);
}

function fromLine(line) {
  const picked = {};
  if (!line) return picked;
  for (const option of line.options) {
    picked[option.groupId] = picked[option.groupId] || {};
    picked[option.groupId][option.itemId] = option.qty;
  }
  return picked;
}

export default function Product() {
  const { route, back, share } = useUI();
  const { lines, addLine, updateLine } = useCart();
  const { shop, getProduct } = useCatalog();
  const product = getProduct(route.id);
  const line = lines.find((item) => item.id === route.lineId);
  const [qty, setQty] = useState(line?.qty || 1);
  const [note, setNote] = useState(line?.note || "");
  const [picked, setPicked] = useState(() => fromLine(line));
  const [query, setQuery] = useState("");
  const [compact, setCompact] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    const onScroll = () => setCompact(window.scrollY > 120);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const groups = product?.groups || [];
  const ready = groups.every((group) => {
    const count = countSelected(group, picked);
    return count >= (group.min || 0) && count <= group.max;
  });

  const unit = useMemo(() => {
    if (!product) return 0;
    const extras = groups.reduce((sum, group) => {
      const map = picked[group.id] || {};
      return sum + group.items.reduce((inner, item) => inner + item.price * (map[item.id] || 0), 0);
    }, 0);
    return product.price + extras;
  }, [product, groups, picked]);

  if (!product) {
    return (
      <div className="product-page">
        <header className="page-head">
          <button type="button" className="icon-btn" onClick={back} aria-label="Voltar">
            <IconBack />
          </button>
          <h1>Produto</h1>
        </header>
        <div className="empty">
          <h2>Produto não encontrado</h2>
          <button type="button" className="primary" onClick={back}>
            Voltar ao cardápio
          </button>
        </div>
      </div>
    );
  }

  const needle = norm(query.trim());
  const visibleGroups = groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !needle || norm(item.name).includes(needle)),
    }))
    .filter((group) => group.items.length > 0);

  function chooseOne(group, item) {
    setPicked((current) => {
      const selected = current[group.id] || {};
      if ((group.min || 0) === 0 && selected[item.id]) {
        return { ...current, [group.id]: {} };
      }
      return { ...current, [group.id]: { [item.id]: 1 } };
    });
  }

  function bump(group, item, delta) {
    const source = groups.find((entry) => entry.id === group.id) || group;
    setPicked((current) => {
      const selected = { ...(current[group.id] || {}) };
      const next = (selected[item.id] || 0) + delta;
      if (next < 0) return current;
      if (item.max && next > item.max) return current;
      const others = source.items.reduce((sum, option) => sum + (option.id === item.id ? 0 : selected[option.id] || 0), 0);
      if (next + others > source.max) return current;
      if (next === 0) delete selected[item.id];
      else selected[item.id] = next;
      return { ...current, [group.id]: selected };
    });
  }

  function submit() {
    if (!shop.open) return;
    if (!ready) {
      setShowErrors(true);
      const missing = groups.find((group) => countSelected(group, picked) < (group.min || 0));
      if (missing) {
        document.getElementById(`group-${missing.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return;
    }

    const options = [];
    for (const group of groups) {
      const selected = picked[group.id] || {};
      for (const item of group.items) {
        const itemQty = selected[item.id] || 0;
        if (itemQty > 0) {
          options.push({
            groupId: group.id,
            groupName: group.label || group.name,
            itemId: item.id,
            name: item.name,
            price: item.price,
            qty: itemQty,
          });
        }
      }
    }

    const payload = {
      productId: product.id,
      qty,
      note: note.trim(),
      options,
    };

    if (line) updateLine(line.id, payload);
    else addLine(payload);
    back();
  }

  return (
    <div className="product-page">
      <header className={compact ? "p-bar compact" : "p-bar"}>
        <button type="button" className="circle" onClick={back} aria-label="Voltar">
          <IconBack />
        </button>
        <strong className="p-bar-title">{product.name}</strong>
        {groups.length > 0 ? (
          <button
            type="button"
            className="circle"
            aria-label="Buscar adicional"
            onClick={() => document.getElementById("option-search")?.focus()}
          >
            <IconSearch />
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="circle"
          aria-label="Compartilhar"
          onClick={() => share(window.location.href, product.name)}
        >
          <IconShare />
        </button>
      </header>

      <section className="hero">
        <Thumb src={product.image} alt={product.name} className="hero-photo" />
        <div>
          <h1>{product.name}</h1>
          <span className="price">{money(product.price)}</span>
          {product.description ? <p className="desc">{product.description}</p> : null}
        </div>
      </section>

      {groups.length > 0 ? (
        <label className="search">
          <IconSearch />
          <input
            id="option-search"
            type="search"
            placeholder="Pesquise pelo nome"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
      ) : null}

      {needle && visibleGroups.length === 0 ? <p className="empty-inline">Nenhum item com esse nome.</p> : null}

      {visibleGroups.map((group) => {
        const invalid = showErrors && countSelected(group, picked) < (group.min || 0);
        const selectedCount = countSelected(group, picked);
        return (
          <section key={group.id} id={`group-${group.id}`} className={invalid ? "group is-invalid" : "group"}>
            <div className="group-head">
              <h2>{group.name}</h2>
              <p>{groupHint(group)}</p>
            </div>
            {group.items.map((item) => {
              const itemQty = (picked[group.id] || {})[item.id] || 0;
              const single = group.max === 1;
              const atMax = (item.max && itemQty >= item.max) || selectedCount >= group.max;
              if (single) {
                return (
                  <button
                    key={item.id}
                    type="button"
                    className="opt"
                    aria-pressed={itemQty > 0}
                    onClick={() => chooseOne(group, item)}
                  >
                    <Thumb src={item.image} />
                    <span className="opt-copy">
                      <strong>{item.name}</strong>
                      {item.price > 0 ? <span>{money(item.price)}</span> : null}
                    </span>
                    <span className={itemQty > 0 ? "radio on" : "radio"} aria-hidden="true" />
                  </button>
                );
              }
              return (
                <div key={item.id} className="opt">
                  <button type="button" className="opt-hit" onClick={() => bump(group, item, 1)}>
                    <Thumb src={item.image} />
                    <span className="opt-copy">
                      <strong>{item.name}</strong>
                      {item.price > 0 ? <span>{money(item.price)}</span> : null}
                      {item.max ? <small>Máx {item.max}</small> : null}
                    </span>
                  </button>
                  {itemQty > 0 ? (
                    <span className="mini">
                      <button type="button" onClick={() => bump(group, item, -1)} aria-label={`Diminuir ${item.name}`}>
                        −
                      </button>
                      <span>{itemQty}</span>
                      <button
                        type="button"
                        onClick={() => bump(group, item, 1)}
                        disabled={atMax}
                        aria-label={`Aumentar ${item.name}`}
                      >
                        +
                      </button>
                    </span>
                  ) : (
                    <button type="button" className="plus-btn" onClick={() => bump(group, item, 1)} aria-label={`Adicionar ${item.name}`}>
                      +
                    </button>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}

      <section className="obs">
        <h2>Observações</h2>
        <textarea
          maxLength={200}
          rows={2}
          placeholder="Ex.: Tirar cebola, ovo, etc."
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </section>

      {shop.open ? (
        <footer className="p-footer">
          <div className="qty">
            <button type="button" onClick={() => setQty((value) => Math.max(1, value - 1))} aria-label="Diminuir quantidade">
              −
            </button>
            <span>{qty}</span>
            <button type="button" onClick={() => setQty((value) => Math.min(20, value + 1))} aria-label="Aumentar quantidade">
              +
            </button>
          </div>
          <button type="button" className={ready ? "add-btn" : "add-btn is-disabled"} onClick={submit}>
            <span>{ready ? (line ? "Atualizar" : "Adicionar") : "Escolha as opções"}</span>
            {ready ? <span>{money(unit * qty)}</span> : null}
          </button>
        </footer>
      ) : (
        <div className="closed-bar">{shop.closedLabel}</div>
      )}
    </div>
  );
}
