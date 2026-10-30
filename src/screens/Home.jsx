import { useEffect, useState } from "react";
import { useCatalog } from "../catalog";
import { money } from "../format";
import { useCart } from "../cart";
import { useUI } from "../router";
import { BottomNav, IconMenu, IconMoon, IconSearch, IconShare, IconSun, ItemLink, Thumb } from "../ui";

export default function Home() {
  const { shop, categories, featured, productsIn, ready, missing, remoteError, retryStore } = useCatalog();
  const { route, openProduct, openSearch, openBag, openDirectory, share, toggleTheme, theme } = useUI();
  const { count, total } = useCart();
  const [active, setActive] = useState(categories[0]?.id || "");
  const [menuOpen, setMenuOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    const nodes = categories
      .map((category) => document.querySelector(`#cat-${category.id} .block-title`))
      .filter(Boolean);
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const current = visible[0]?.target.closest(".category");
        if (current) setActive(current.id.replace("cat-", ""));
      },
      { rootMargin: "-150px 0px -65% 0px", threshold: [0, 1] },
    );
    nodes.forEach((node) => observer.observe(node));
    return () => observer.disconnect();
  }, [categories]);

  useEffect(() => {
    document.body.classList.toggle("sheet-open", menuOpen || infoOpen);
    return () => document.body.classList.remove("sheet-open");
  }, [menuOpen, infoOpen]);

  useEffect(() => {
    document.querySelector(".tab.on")?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [active]);

  function jump(id) {
    setActive(id);
    setMenuOpen(false);
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (remoteError && shop.slug !== route.slug) {
    return (
      <div className="empty">
        <h2>Não foi possível abrir a loja</h2>
        <p>{remoteError}</p>
        <button type="button" className="primary" onClick={retryStore}>
          Tentar de novo
        </button>
      </div>
    );
  }

  if (!ready || (route.slug && shop.slug !== route.slug && !missing)) {
    return (
      <div className="empty">
        <h2>Carregando o cardápio</h2>
      </div>
    );
  }

  if (missing) {
    return (
      <div className="empty">
        <h2>Loja não encontrada</h2>
        <p>Confira o nome no endereço. Cada loja tem o próprio cardápio.</p>
        <button type="button" className="primary" onClick={openDirectory}>
          Ver lojas
        </button>
      </div>
    );
  }

  return (
    <>
      <header className="store-top">
        <div className="brand">
          <h1>{shop.name}</h1>
          <div className="actions">
            <button type="button" className="icon-btn" aria-label="Buscar" onClick={openSearch}>
              <IconSearch />
            </button>
            <button type="button" className="icon-btn" aria-label="Aparência" onClick={toggleTheme}>
              {theme === "dark" ? <IconSun /> : <IconMoon />}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Compartilhar"
              onClick={() => share(`${window.location.origin}/loja/${shop.slug}`, shop.name)}
            >
              <IconShare />
            </button>
          </div>
        </div>
        <p className="status">{shop.open ? shop.openLabel : shop.closedLabel}</p>
        <button type="button" className="info-btn" onClick={() => setInfoOpen(true)}>
          Mais informações
        </button>
        <div className="tabs">
          <button type="button" className="tabs-btn" aria-label="Ver categorias" onClick={() => setMenuOpen(true)}>
            <IconMenu />
          </button>
          <div className="tab-scroll">
            {categories.map((category) => (
              <button
                key={category.id}
                type="button"
                className={active === category.id ? "tab on" : "tab"}
                onClick={() => jump(category.id)}
              >
                {category.name}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className={count > 0 ? "home has-bag" : "home"}>
        {featured.length > 0 ? (
          <section>
            <h2 className="block-title">Destaques</h2>
            <div className="hl-row">
              {featured.map((product) => (
                <a
                  key={product.id}
                  className="hl"
                  href={`/loja/${shop.slug}/produto/${product.id}`}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                    event.preventDefault();
                    openProduct(product.id);
                  }}
                >
                  <span className="hl-media">
                    <Thumb src={product.image} className="hl-photo" />
                    <span className="plus" aria-hidden="true">
                      +
                    </span>
                  </span>
                  <strong>{product.name}</strong>
                  <em>{money(product.price)}</em>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        {categories.length === 0 ? (
          <div className="empty">
            <h2>Cardápio vazio</h2>
            <p>As categorias e os produtos aparecem aqui depois do cadastro na área da loja.</p>
          </div>
        ) : null}

        {categories.map((category) => (
          <section key={category.id} id={`cat-${category.id}`} className="category">
            <h2 className="block-title">{category.name}</h2>
            <div className="panel">
              {productsIn(category.id).length === 0 ? <p className="empty-inline">Nenhum produto nesta categoria.</p> : null}
              {productsIn(category.id).map((product) => (
                <ItemLink key={product.id} product={product} />
              ))}
            </div>
          </section>
        ))}
      </main>

      {count > 0 ? (
        <button type="button" className="bag-bar" onClick={openBag}>
          <span>
            {count} {count === 1 ? "item" : "itens"}
          </span>
          <strong>Ver sacola</strong>
          <span>{money(total)}</span>
        </button>
      ) : null}

      <BottomNav />

      {menuOpen ? (
        <div className="backdrop" onClick={() => setMenuOpen(false)}>
          <div className="sheet" role="dialog" aria-label="Categorias" onClick={(event) => event.stopPropagation()}>
            <div className="handle" />
            <h2>Categorias</h2>
            {categories.map((category) => (
              <button key={category.id} type="button" className="sheet-link" onClick={() => jump(category.id)}>
                {category.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {infoOpen ? (
        <div className="backdrop" onClick={() => setInfoOpen(false)}>
          <div className="sheet" role="dialog" aria-label="Informações" onClick={(event) => event.stopPropagation()}>
            <div className="handle" />
            <h2>{shop.name}</h2>
            <p>
              <strong>Endereço</strong>
              <br />
              {shop.address}
            </p>
            <p>
              <strong>Horário</strong>
              <br />
              {shop.hours}
            </p>
            <p>
              <strong>Pedidos</strong>
              <br />
              Monte o lanche, escolha os adicionais e envie a comanda no WhatsApp. O pagamento é combinado na conversa.
            </p>
            <button type="button" className="primary sheet-close" onClick={() => setInfoOpen(false)}>
              Fechar
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
