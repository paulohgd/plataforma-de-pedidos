import { lazy, Suspense } from "react";
import { CatalogProvider } from "./catalog";
import { CartProvider } from "./cart";
import { UIProvider, useUI } from "./router";
import Home from "./screens/Home";
import Stores from "./screens/Stores";
import Product from "./screens/Product";
import Bag from "./screens/Bag";
import Orders from "./screens/Orders";
import Search from "./screens/Search";

const Checkout = lazy(() => import("./screens/Checkout"));
const PixPay = lazy(() => import("./screens/PixPay"));
const Paid = lazy(() => import("./screens/Paid"));
const Access = lazy(() => import("./screens/Access"));
const Admin = lazy(() => import("./screens/Admin"));
const ProductForm = lazy(() => import("./screens/ProductForm"));

function ScreenFallback() {
  return <p className="empty-inline">Carregando…</p>;
}

function Shell() {
  const { route, toast } = useUI();
  return (
    <div className="app">
      {route.name === "stores" && <Stores />}
      {route.name === "home" && <Home />}
      {route.name === "product" && <Product key={`${route.id}-${route.lineId || "new"}`} />}
      {route.name === "bag" && <Bag />}
      {route.name === "orders" && <Orders />}
      {route.name === "search" && <Search />}
      <Suspense fallback={<ScreenFallback />}>
        {route.name === "checkout" && <Checkout />}
        {route.name === "pix-pay" && <PixPay />}
        {route.name === "paid" && <Paid />}
        {route.name === "access" && <Access />}
        {route.name === "admin" && <Admin />}
        {route.name === "product-form" && <ProductForm key={route.id || "new"} />}
      </Suspense>
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
