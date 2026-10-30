import { useRef, useState } from "react";
import { useCatalog } from "../catalog";
import { fileToImage } from "../images";
import { useUI } from "../router";
import { PageHead, Thumb } from "../ui";
import RequireOwner from "./RequireOwner";

function parsePrice(value) {
  const text = String(value).trim().replace(/\s/g, "").replace(/^R\$/i, "");
  if (!text) return null;
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  const price = Number(normalized);
  if (!Number.isFinite(price) || price < 0 || price > 9999) return null;
  return Math.round(price * 100) / 100;
}

function formatPrice(value) {
  return Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ProductEditor() {
  const { categories, itemTypes, getProduct, saveProduct } = useCatalog();
  const { route, openAdmin, notify } = useUI();
  const existing = route.id ? getProduct(route.id) : null;
  const fileRef = useRef(null);
  const [name, setName] = useState(existing?.name || "");
  const [description, setDescription] = useState(existing?.description || "");
  const [price, setPrice] = useState(existing ? formatPrice(existing.price) : "");
  const [category, setCategory] = useState(categories.some((item) => item.id === existing?.category) ? existing.category : "");
  const [kind, setKind] = useState(
    itemTypes.some((type) => type.id === existing?.kind) ? existing.kind : itemTypes[0]?.id || "simple",
  );
  const [featured, setFeatured] = useState(Boolean(existing?.featured));
  const [active, setActive] = useState(existing?.active !== false);
  const [image, setImage] = useState(existing?.image || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onFile(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      setImage(await fileToImage(file));
    } catch (failure) {
      setError(failure.message || "Não foi possível usar essa imagem.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (!category) {
      setError("Escolha uma categoria cadastrada.");
      return;
    }
    const parsed = parsePrice(price);
    if (parsed == null) {
      setError("Informe um preço válido.");
      return;
    }
    setBusy(true);
    const message = await saveProduct({
      id: existing?.id || "",
      name,
      description,
      price: parsed,
      category,
      kind,
      image,
      featured,
      active,
    });
    setBusy(false);
    if (message) {
      setError(message);
      return;
    }
    notify(existing ? "Produto atualizado." : "Produto adicionado.");
    openAdmin("produtos");
  }

  if (route.id && !existing) {
    return (
      <div className="admin-page">
        <PageHead title="Produto" onBack={() => openAdmin("produtos")} />
        <div className="empty">
          <h2>Produto não encontrado</h2>
          <button type="button" className="primary" onClick={() => openAdmin("produtos")}>
            Voltar aos produtos
          </button>
        </div>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div className="admin-page">
        <PageHead title="Novo produto" onBack={() => openAdmin("produtos")} />
        <div className="empty">
          <h2>Cadastre uma categoria</h2>
          <p>O produto precisa ser vinculado a uma categoria que você já criou.</p>
          <button type="button" className="primary" onClick={() => openAdmin("categorias")}>
            Criar categoria
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <PageHead title={existing ? "Editar produto" : "Novo produto"} onBack={() => openAdmin("produtos")} />
      <form className="form" onSubmit={submit} noValidate>
        <div className="image-row">
          <Thumb src={image} className="image-preview" />
          <div className="image-actions">
            <button type="button" className="ghost" onClick={() => fileRef.current?.click()} disabled={busy}>
              {busy ? "Lendo imagem…" : image ? "Trocar imagem" : "Escolher imagem"}
            </button>
            {image ? (
              <button type="button" className="ghost" onClick={() => setImage("")}>
                Remover foto
              </button>
            ) : null}
          </div>
        </div>
        <input ref={fileRef} className="file-input" tabIndex={-1} type="file" accept="image/*" onChange={onFile} />
        <label>
          Ou cole o link da imagem
          <input
            value={image.startsWith("data:") ? "" : image}
            placeholder="https://"
            inputMode="url"
            onChange={(event) => setImage(event.target.value.trim())}
          />
        </label>

        <label>
          Nome
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
        </label>
        <label>
          Descrição
          <textarea rows={3} maxLength={400} value={description} onChange={(event) => setDescription(event.target.value)} />
        </label>
        <label>
          Preço
          <input inputMode="decimal" placeholder="0,00" value={price} onChange={(event) => setPrice(event.target.value)} />
        </label>
        <label>
          Categoria
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">Selecione uma categoria</option>
            {categories.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">Só entram aqui as categorias que você já cadastrou.</p>
        <label>
          Tipo do item
          <select value={kind} onChange={(event) => setKind(event.target.value)}>
            {itemTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </label>
        <p className="hint">Os tipos e as opções extras são cadastrados na aba Tipo do item.</p>
        <label className="check">
          <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
          Disponível no cardápio
        </label>
        <label className="check">
          <input type="checkbox" checked={featured} onChange={(event) => setFeatured(event.target.checked)} />
          Mostrar nos destaques
        </label>
        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}
        <button type="submit" className="primary" disabled={busy}>
          Salvar produto
        </button>
      </form>
    </div>
  );
}

export default function ProductForm() {
  return (
    <RequireOwner>
      <ProductEditor />
    </RequireOwner>
  );
}
