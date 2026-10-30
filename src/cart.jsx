import { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import { useCatalog } from "./catalog";

const CartContext = createContext(null);

function createId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else {
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256);
  }
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function cartKey(slug) {
  return `pedido-sacola:${slug}`;
}

function customerKey(slug) {
  return `pedido-cliente:${slug}`;
}

const emptyCustomer = {
  name: "",
  whatsapp: "",
  mode: "retirada",
  address: "",
  notes: "",
};

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function loadLines(slug) {
  const data = readStorage(cartKey(slug), []);
  if (!Array.isArray(data)) return [];
  return data.filter((line) => line && line.productId && line.qty > 0 && Array.isArray(line.options));
}

export function CartProvider({ children }) {
  const { getProduct, shop } = useCatalog();
  const slug = shop.slug || "";
  const [lines, setLines] = useState([]);
  const [customer, setCustomerState] = useState(emptyCustomer);
  const skipSave = useRef(false);

  useEffect(() => {
    skipSave.current = true;
    if (!slug) {
      setLines([]);
      setCustomerState(emptyCustomer);
      return;
    }
    setLines(loadLines(slug));
    setCustomerState({ ...emptyCustomer, ...readStorage(customerKey(slug), {}) });
  }, [slug]);

  useEffect(() => {
    if (!slug) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    localStorage.setItem(cartKey(slug), JSON.stringify(lines));
  }, [lines, slug]);

  useEffect(() => {
    if (!slug || skipSave.current) return;
    localStorage.setItem(customerKey(slug), JSON.stringify(customer));
  }, [customer, slug]);

  const clear = useCallback(() => {
    setLines([]);
  }, []);

  const detailed = lines
    .map((line) => {
      const product = getProduct(line.productId);
      if (!product) return null;
      const unit = product.price + line.options.reduce((sum, option) => sum + option.price * option.qty, 0);
      return { ...line, product, unit, total: unit * line.qty };
    })
    .filter(Boolean);

  const value = {
    lines: detailed,
    count: detailed.reduce((sum, line) => sum + line.qty, 0),
    total: detailed.reduce((sum, line) => sum + line.total, 0),
    customer,
    setCustomer(patch) {
      setCustomerState((current) => ({ ...current, ...patch }));
    },
    addLine(line) {
      setLines((current) => [...current, { ...line, id: createId() }]);
    },
    updateLine(id, line) {
      setLines((current) => current.map((item) => (item.id === id ? { ...line, id } : item)));
    },
    setLineQty(id, qty) {
      setLines((current) => {
        if (qty <= 0) return current.filter((item) => item.id !== id);
        return current.map((item) => (item.id === id ? { ...item, qty: Math.min(qty, 20) } : item));
      });
    },
    clear,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  return useContext(CartContext);
}
