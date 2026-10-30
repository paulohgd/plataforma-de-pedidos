import { useState } from "react";
import { cloneItemType, optionTemplates } from "../menu";
import { norm } from "../format";

function uniqueId(name, used) {
  const base = norm(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
  let id = base;
  let count = 2;
  while (used.has(id)) {
    id = `${base}-${count}`;
    count += 1;
  }
  return id;
}

function blankGroup() {
  return { id: "", name: "Opções", min: 0, max: 8, source: "list", items: [] };
}

function templateLabel(group) {
  if (group.id === "adicionais") {
    if (group.items?.some((item) => item.id === "burger-extra")) return "Adicionais de hambúrguer";
    if (group.items?.some((item) => item.id === "frango-extra")) return "Adicionais de frango";
    return "Adicionais de sanduíche";
  }
  if (group.source === "sides") return "Porção do cardápio";
  if (group.source === "drinks") return "Bebida do cardápio";
  return group.name;
}

function withIds(type, usedTypeIds) {
  const usedGroups = new Set();
  const groups = (type.groups || []).map((group) => {
    const groupId = group.id && !usedGroups.has(group.id) ? group.id : uniqueId(group.name || "grupo", usedGroups);
    usedGroups.add(groupId);
    const usedItems = new Set();
    const items = (group.items || []).map((item) => {
      const itemId = item.id && !usedItems.has(item.id) ? item.id : uniqueId(item.name || "opcao", usedItems);
      usedItems.add(itemId);
      return { ...item, id: itemId, name: String(item.name || "").trim(), price: Number(item.price) || 0, max: Math.max(1, Number(item.max) || 1) };
    });
    return {
      ...group,
      id: groupId,
      name: String(group.name || "").trim() || "Opções",
      min: Math.max(0, Number(group.min) || 0),
      max: Math.max(0, Number(group.max) || 0),
      source: group.source === "sides" || group.source === "drinks" ? group.source : "list",
      items,
    };
  });
  return {
    ...type,
    id: type.id || uniqueId(type.name, usedTypeIds),
    name: String(type.name || "").trim(),
    groups,
  };
}

function GroupEditor({ group, onChange, onRemove }) {
  function setItem(index, patch) {
    onChange({
      ...group,
      items: group.items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item)),
    });
  }

  return (
    <article className="admin-card">
      <label>
        Nome do grupo
        <input value={group.name} maxLength={60} onChange={(event) => onChange({ ...group, name: event.target.value })} />
      </label>
      <div className="type-grid">
        <label>
          Mínimo
          <input
            inputMode="numeric"
            value={group.min}
            onChange={(event) => onChange({ ...group, min: Number(event.target.value) || 0 })}
          />
        </label>
        <label>
          Máximo
          <input
            inputMode="numeric"
            value={group.max}
            onChange={(event) => onChange({ ...group, max: Number(event.target.value) || 0 })}
          />
        </label>
      </div>
      <label>
        Origem das opções
        <select value={group.source || "list"} onChange={(event) => onChange({ ...group, source: event.target.value })}>
          <option value="list">Lista cadastrada abaixo</option>
          <option value="sides">Produtos de porção do cardápio</option>
          <option value="drinks">Produtos de bebida do cardápio</option>
        </select>
      </label>
      {group.source === "list" ? (
        <>
          {group.items.map((item, index) => (
            <div key={`${item.id}-${index}`} className="type-option">
              <input
                placeholder="Nome"
                maxLength={60}
                value={item.name}
                onChange={(event) => setItem(index, { name: event.target.value })}
              />
              <input
                inputMode="decimal"
                placeholder="Preço"
                value={item.price}
                onChange={(event) => setItem(index, { price: event.target.value })}
              />
              <input
                inputMode="numeric"
                placeholder="Máx"
                value={item.max}
                onChange={(event) => setItem(index, { max: event.target.value })}
              />
              <button
                type="button"
                className="text-btn danger"
                onClick={() => onChange({ ...group, items: group.items.filter((_, itemIndex) => itemIndex !== index) })}
              >
                Tirar
              </button>
            </div>
          ))}
          <button
            type="button"
            className="text-btn"
            onClick={() => onChange({ ...group, items: [...group.items, { id: "", name: "", price: 0, max: 1 }] })}
          >
            Adicionar opção
          </button>
        </>
      ) : (
        <p className="hint">
          {group.source === "sides"
            ? "Entram batata, anéis e outras porções já cadastradas."
            : "Entram refrigerantes e bebidas já cadastradas."}
        </p>
      )}
      <button type="button" className="text-btn danger" onClick={onRemove}>
        Remover grupo
      </button>
    </article>
  );
}

export default function ItemTypesPanel({ types, products, onSave, onRemove, onError, notify }) {
  const [editing, setEditing] = useState(null);
  const [mix, setMix] = useState([]);
  const [busy, setBusy] = useState(false);

  const catalogGroups = types.flatMap((type) =>
    (type.groups || []).map((group, index) => ({
      key: `${type.id}:${group.id}:${index}`,
      typeName: type.name,
      group,
    })),
  );

  async function commit(draft) {
    const used = new Set(types.map((type) => type.id));
    if (draft.id) used.delete(draft.id);
    const next = withIds(draft, used);
    if (next.groups.some((group) => group.source === "list" && group.items.some((item) => !String(item.name || "").trim()))) {
      onError("Preencha o nome de todas as opções.");
      return;
    }
    setBusy(true);
    const message = await onSave(next);
    setBusy(false);
    if (message) {
      onError(message);
      return;
    }
    setEditing(null);
    setMix([]);
    notify(draft.id ? "Tipo atualizado." : "Tipo adicionado.");
  }

  function startMix() {
    const picked = catalogGroups.filter((entry) => mix.includes(entry.key)).map((entry) => cloneItemType({ groups: [entry.group] }).groups[0]);
    setEditing({
      id: "",
      name: "",
      groups: picked,
    });
  }

  return (
    <div className="admin-list">
      <p className="hint">
        O tipo define as escolhas do cliente no produto: ponto da carne, adicionais, molho, porção ou bebida. Você pode
        criar um tipo novo misturando grupos que já existem.
      </p>
      {editing ? (
        <form
          className="form inset"
          onSubmit={(event) => {
            event.preventDefault();
            commit(editing);
          }}
        >
          <label>
            Nome do tipo
            <input
              value={editing.name}
              maxLength={80}
              placeholder="Ex.: Hambúrguer com molho"
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
          </label>
          {editing.groups.map((group, index) => (
            <GroupEditor
              key={`${group.id}-${index}`}
              group={group}
              onChange={(next) =>
                setEditing({
                  ...editing,
                  groups: editing.groups.map((item, itemIndex) => (itemIndex === index ? next : item)),
                })
              }
              onRemove={() => setEditing({ ...editing, groups: editing.groups.filter((_, itemIndex) => itemIndex !== index) })}
            />
          ))}
          <div className="featured-pick">
            <label className="grow">
              Adicionar grupo pronto
              <select
                defaultValue=""
                onChange={(event) => {
                  const template = optionTemplates[Number(event.target.value)];
                  event.target.value = "";
                  if (!template) return;
                  setEditing({ ...editing, groups: [...editing.groups, cloneItemType({ groups: [template] }).groups[0]] });
                }}
              >
                <option value="">Escolha um grupo</option>
                {optionTemplates.map((group, index) => (
                  <option key={`${group.id}-${index}`} value={index}>
                    {templateLabel(group)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="ghost" onClick={() => setEditing({ ...editing, groups: [...editing.groups, blankGroup()] })}>
              Grupo vazio
            </button>
          </div>
          <button type="submit" className="primary" disabled={busy}>
            Salvar tipo
          </button>
          <button type="button" className="ghost" onClick={() => setEditing(null)}>
            Cancelar
          </button>
        </form>
      ) : (
        <>
          <form
            className="form inset"
            onSubmit={(event) => {
              event.preventDefault();
              startMix();
            }}
          >
            <p className="hint">Marque grupos de tipos já cadastrados para montar um tipo novo.</p>
            {catalogGroups.length === 0 ? <p className="empty-inline">Nenhum grupo para misturar ainda.</p> : null}
            {catalogGroups.map((entry) => (
              <label key={entry.key} className="check">
                <input
                  type="checkbox"
                  checked={mix.includes(entry.key)}
                  onChange={(event) =>
                    setMix((current) =>
                      event.target.checked ? [...current, entry.key] : current.filter((key) => key !== entry.key),
                    )
                  }
                />
                {entry.typeName} · {entry.group.name}
              </label>
            ))}
            <button type="submit" className="primary" disabled={mix.length === 0}>
              Criar tipo com esses grupos
            </button>
            <button type="button" className="ghost" onClick={() => setEditing({ id: "", name: "", groups: [] })}>
              Criar tipo vazio
            </button>
          </form>
          {types.map((type) => (
            <article key={type.id} className="admin-card">
              <strong>{type.name}</strong>
              <p className="muted">
                {type.groups.length === 0
                  ? "Sem opções extras"
                  : type.groups.map((group) => group.name).join(" · ")}
                {` · ${products.filter((product) => product.kind === type.id).length} produto(s)`}
              </p>
              <div className="featured-actions">
                <button type="button" className="text-btn" onClick={() => setEditing(cloneItemType(type))}>
                  Editar
                </button>
                <button
                  type="button"
                  className="text-btn danger"
                  onClick={async () => {
                    const message = await onRemove(type.id);
                    if (message) onError(message);
                    else notify("Tipo removido.");
                  }}
                >
                  Remover
                </button>
              </div>
            </article>
          ))}
        </>
      )}
    </div>
  );
}
