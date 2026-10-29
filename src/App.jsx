import { CatalogProvider } from "./catalog";
import { CartProvider } from "./cart";
import { UIProvider, useUI } from "./router";
import Home from "./screens/Home";
import Product from "./screens/Product";
import Bag from "./screens/Bag";
import Checkout from "./screens/Checkout";
import Search from "./screens/Search";
import Access from "./screens/Access";
import Admin from "./screens/Admin";
import ProductForm from "./screens/ProductForm";

function Shell() {
  const { route, toast } = useUI();
  return (
    <div className="app">
      {route.name === "home" && <Home />}
      {route.name === "product" && <Product key={`${route.id}-${route.lineId || "new"}`} />}
      {route.name === "bag" && <Bag />}
      {route.name === "checkout" && <Checkout />}
      {route.name === "search" && <Search />}
      {route.name === "access" && <Access />}
      {route.name === "admin" && <Admin />}
      {route.name === "product-form" && <ProductForm key={route.id || "new"} />}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
  );
}

export default function App() {
  return (
    <CatalogProvider>
      <UIProvider>
        <CartProvider>
          <Shell />
        </CartProvider>
      </UIProvider>
    </CatalogProvider>
  );
}
