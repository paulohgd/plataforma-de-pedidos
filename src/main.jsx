import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

if (localStorage.getItem("pedido-tema") === "dark") {
  document.documentElement.classList.add("dark");
}

function keepPageCentered() {
  if (window.scrollX) window.scrollTo(0, window.scrollY);
}

window.addEventListener("scroll", keepPageCentered, { passive: true });
window.addEventListener("focusin", keepPageCentered);
window.visualViewport?.addEventListener("scroll", keepPageCentered, { passive: true });
window.visualViewport?.addEventListener("resize", keepPageCentered, { passive: true });

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
