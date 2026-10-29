import { useState } from "react";
import { useCart } from "./cart";
import { useCatalog } from "./catalog";
import { money } from "./format";
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

export function IconMenu() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" />
    </svg>
  );
}

export function Thumb({ src, alt = "", className = "thumb" }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <span className={`${className} thumb-empty`} aria-hidden="true" />;
  return <img className={className} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
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
  const { route, goHome, openBag } = useUI();
  const { count } = useCart();
  return (
    <nav className="nav" aria-label="Principal">
      <button type="button" className={route.name === "home" ? "on" : ""} onClick={goHome}>
        <IconHome filled={route.name === "home"} />
        Início
      </button>
      <button type="button" className={route.name === "bag" ? "on" : ""} onClick={openBag}>
        <IconBag />
        {count > 0 ? <span className="badge">{count}</span> : null}
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
