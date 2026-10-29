import { createContext, useContext, useEffect, useState } from "react";
import { useCatalog } from "./catalog";

const KEY = "pedido-sacola";
const CUSTOMER_KEY = "pedido-cliente";
const CartContext = createContext(null);

const emptyCustomer = {
  name: "",
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

function loadLines() {
  const data = readStorage(KEY, []);
  if (!Array.isArray(data)) return [];
  return data.filter((line) => line && line.productId && line.qty > 0 && Array.isArray(line.options));
}

export function CartProvider({ children }) {
  const { getProduct } = useCatalog();
  const [lines, setLines] = useState(loadLines);
  const [customer, setCustomerState] = useState(() => ({
    ...emptyCustomer,
    ...readStorage(CUSTOMER_KEY, {}),
  }));

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(lines));
  }, [lines]);

  useEffect(() => {
    localStorage.setItem(CUSTOMER_KEY, JSON.stringify(customer));
  }, [customer]);

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
      setLines((current) => [...current, { ...line, id: crypto.randomUUID() }]);
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
    clear() {
      setLines([]);
    },
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  return useContext(CartContext);
}
