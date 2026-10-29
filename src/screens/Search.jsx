import { useState } from "react";
import { useCatalog } from "../catalog";
import { norm } from "../format";
import { ItemLink, PageHead } from "../ui";

export default function Search() {
  const { categories, products, productsIn } = useCatalog();
  const [query, setQuery] = useState("");
  const needle = norm(query.trim());
  const results = needle
    ? products.filter((product) => norm(`${product.name} ${product.description}`).includes(needle))
    : [];

  return (
    <div className="search-page">
      <PageHead title="Buscar" />
      <label className="search">
        <input
          autoFocus
          type="search"
          placeholder="Buscar no cardápio"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      {needle ? (
        <div className="panel search-results">
          {results.length === 0 ? <p className="empty-inline">Nenhum produto encontrado.</p> : null}
          {results.map((product) => (
            <ItemLink key={product.id} product={product} />
          ))}
        </div>
      ) : (
        categories.map((category) => (
          <section key={category.id}>
            <h2 className="block-title">{category.name}</h2>
            <div className="panel">
              {productsIn(category.id).map((product) => (
                <ItemLink key={product.id} product={product} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
