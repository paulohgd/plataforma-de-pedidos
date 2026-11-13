import { useEffect, useState } from "react";
import { useCart } from "./cart";
import { useCatalog } from "./catalog";
import { money } from "./format";
import { catalogImage } from "./images";
import { pendingOrderCount } from "./myOrders";
import { useUI } from "./router";

export function IconHome({ filled }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5Z"
        fill={filled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function IconBag() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M7 8V7a5 5 0 0 1 10 0v1" />
      <path d="M5.5 8h13l-1 12h-11l-1-12Z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconOrders({ filled }) {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M7 3.8h10v16.4l-2.1-1.1-2.1 1.1-1.8-1.1-1.8 1.1-2.1-1.1-2.1 1.1V3.8Z" strokeLinejoin="round" />
      <path d="M9.2 8.5h5.6M9.2 12h5.6" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function IconSearch() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.2-3.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconMoon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M21 14.5A8.5 8.5 0 1 1 9.5 3 7 7 0 0 0 21 14.5Z" strokeLinejoin="round" />
    </svg>
  );
}

export function IconSun() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" strokeLinecap="round" />
    </svg>
  );
}

export function IconShare() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <circle cx="6" cy="12" r="2.2" />
      <circle cx="17" cy="7" r="2.2" />
      <circle cx="17" cy="17" r="2.2" />
      <path d="m8 11.2 7-3.2M8 12.8l7 3.2" />
    </svg>
  );
}

export function IconBack() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
      <path d="M15 5 8 12l7 7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconCalendar() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M4 10h16" strokeLinecap="round" />
    </svg>
  );
}

export function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}

export function Thumb({ src, alt = "", className = "thumb", size = 360, eager = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [src, size]);
  const display = catalogImage(src);
  if (!display || failed) return <span className={`${className} thumb-empty`} aria-hidden="true" />;
  return (
    <img
      className={className}
      src={display}
      alt={alt}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={eager ? "high" : "auto"}
      onError={() => setFailed(true)}
    />
  );
}

export function ItemLink({ product }) {
  const { openProduct } = useUI();
  const { shop } = useCatalog();
  const href = shop.slug ? `/loja/${shop.slug}/produto/${product.id}` : `/produto/${product.id}`;
  return (
    <a
      className="item"
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault();
        openProduct(product.id);
      }}
    >
      <span className="copy">
        <h3>{product.name}</h3>
        {product.description ? <p className="desc">{product.description}</p> : null}
        <span className="price">{money(product.price)}</span>
      </span>
      <Thumb src={product.image} className="photo" />
    </a>
  );
}

export function BottomNav() {
  const { route, goHome, openBag, openOrders } = useUI();
  const { shop } = useCatalog();
  const { count } = useCart();
  const [ongoing, setOngoing] = useState(() => pendingOrderCount(shop.slug));

  useEffect(() => {
    function refresh() {
      setOngoing(pendingOrderCount(shop.slug));
    }
    refresh();
    window.addEventListener("pedido-meus", refresh);
    const timer = setInterval(refresh, 1000);
    return () => {
      window.removeEventListener("pedido-meus", refresh);
      clearInterval(timer);
    };
  }, [shop.slug]);

  return (
    <nav className="nav" aria-label="Principal">
      <button type="button" className={route.name === "home" ? "on" : ""} onClick={goHome}>
        <IconHome filled={route.name === "home"} />
        Início
      </button>
      <button type="button" className={route.name === "bag" ? "on" : ""} onClick={openBag}>
        <IconBag />
        {count > 0 ? <span className="badge">{count}</span> : null}
        Sacola
      </button>
      <button type="button" className={route.name === "orders" || route.name === "pix-pay" ? "on" : ""} onClick={openOrders}>
        <IconOrders filled={route.name === "orders" || route.name === "pix-pay"} />
        {ongoing > 0 ? <span className="badge">{ongoing}</span> : null}
        Pedidos
      </button>
    </nav>
  );
}

export function PageHead({ title, onBack }) {
  const { back } = useUI();
  return (
    <header className="page-head">
      <button type="button" className="icon-btn" onClick={onBack || back} aria-label="Voltar">
        <IconBack />
      </button>
      <h1>{title}</h1>
    </header>
  );
}
