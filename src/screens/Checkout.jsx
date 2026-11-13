import { useEffect, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { useCatalog } from "../catalog";
import { cepDigits, composeAddress, formatCep, lookupCep } from "../cep";
import { formatPhone, money, phoneDigits, validPhone } from "../format";
import { cleanCouponCode, couponDiscount, findCoupon } from "../coupons";
import { cleanMinOrder, deliveryFeeLabel, deliveryRulesHint } from "../freight";
import { useCart } from "../cart";
import { formatOption } from "../order";
import { upsertMyOrder } from "../myOrders";
import {
  clearParentOrder,
  readParentOrderId,
  rememberCheckoutSession,
} from "../pay";
import { useUI } from "../router";
import { PageHead } from "../ui";

export default function Checkout() {
  const { shop, ready, missing } = useCatalog();
  const { lines, total, customer, setCustomer, clear } = useCart();
  const { goHome, route } = useUI();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [paying, setPaying] = useState(false);
  const [delivery, setDelivery] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [cepError, setCepError] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const whatsappBox = useRef(null);
  const box = useRef(null);
  const checkoutRef = useRef(null);
  const pendingMount = useRef(null);
  const waiting = !ready || (route.slug && shop.slug !== route.slug && !missing);
  const deliveryFee = customer.mode === "entrega" && delivery && !delivery.error ? Number(delivery.fee) || 0 : 0;
  const coupon = findCoupon(shop.coupons, couponInput);
  const discount = couponDiscount(total, coupon);
  const payTotal = Number((total - discount + deliveryFee).toFixed(2));
  const deliveryCep = cepDigits(customer.cep);
  const deliveryReady =
    customer.mode !== "entrega" ||
    Boolean(
      deliveryCep.length === 8 &&
        String(customer.number || "").trim() &&
        customer.city &&
        delivery &&
        !delivery.error &&
        !quoting &&
        !cepError,
    );

  function updatePlace(patch) {
    setCustomer(patch);
  }

  useEffect(
    () => () => {
      checkoutRef.current?.destroy?.();
      pendingMount.current = null;
    },
    [],
  );

  useEffect(() => {
    if (!paying || !pendingMount.current || !box.current) return undefined;
    const checkout = pendingMount.current;
    pendingMount.current = null;
    checkout.mount(box.current);
    return undefined;
  }, [paying]);

  useEffect(() => {
    if (customer.mode !== "entrega") {
      setCepError("");
      return undefined;
    }
    const digits = cepDigits(customer.cep);
    if (digits.length !== 8) {
      setCepError("");
      return undefined;
    }
    let cancel = false;
    lookupCep(digits).then((found) => {
      if (cancel) return;
      if (found.error) {
        setCepError(found.error);
        setCustomer({ street: "", neighborhood: "", city: "", uf: "" });
        return;
      }
      setCepError("");
      setCustomer({
        street: found.street || "",
        neighborhood: found.neighborhood || "",
        city: found.city || "",
        uf: found.uf || "",
      });
    });
    return () => {
      cancel = true;
    };
  }, [customer.cep, customer.mode, setCustomer]);

  useEffect(() => {
    if (customer.mode !== "entrega" || !deliveryReady) {
      if (customer.mode !== "entrega") setDelivery(null);
      return undefined;
    }
    let cancel = false;
    setQuoting(true);
    fetch("/api/quote-delivery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: shop.slug || route.slug,
        cep: customer.cep,
        number: customer.number,
        address: composeAddress(customer),
      }),
    })
      .then((response) => response.json())
      .then((payload) => {
        if (!cancel) setDelivery(payload);
      })
      .catch(() => {
        if (!cancel) setDelivery({ error: "Não foi possível calcular a entrega." });
      })
      .finally(() => {
        if (!cancel) setQuoting(false);
      });
    return () => {
      cancel = true;
    };
  }, [
    customer.mode,
    customer.cep,
    customer.number,
    customer.city,
    customer.uf,
    shop.slug,
    route.slug,
    deliveryReady,
  ]);

  async function submit(event) {
    event.preventDefault();
    setError("");
    if (!validPhone(customer.whatsapp)) {
      setError("Informe um WhatsApp válido.");
      whatsappBox.current?.focus();
      return;
    }
    if (!String(customer.name || "").trim()) {
      setError("Informe seu nome.");
      return;
    }
    if (!deliveryReady) {
      setError(cepError || "Complete o endereço de entrega.");
      return;
    }
    if (!(shop.stripePublishableKey || shop.mpPublicKey)) {
      setError("Esta loja ainda não configurou o pagamento.");
      return;
    }
    setPending(true);
    try {
      const parentOrderId = readParentOrderId(shop.slug || route.slug);
      const response = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: shop.slug || route.slug,
          origin: window.location.origin,
          parentOrderId,
          customer: {
            name: customer.name,
            whatsapp: customer.whatsapp,
            mode: customer.mode,
            notes: customer.notes,
            cep: customer.cep,
            street: customer.street,
            number: customer.number,
            neighborhood: customer.neighborhood,
            city: customer.city,
            uf: customer.uf,
            complement: customer.complement,
          },
          lines: lines.map((line) => ({
            productId: line.productId || line.product?.id,
            qty: line.qty,
            note: line.note,
            options: (line.options || []).map((option) => ({
              groupId: option.groupId,
              itemId: option.itemId,
              qty: option.qty,
            })),
          })),
          coupon: couponInput,
        }),
      });
      const payload = await response.json();
      if (!response.ok || !payload.clientSecret) {
        setError(payload.error || "Não foi possível iniciar o pagamento.");
        return;
      }
      const publishable = payload.publishableKey || payload.publicKey || shop.stripePublishableKey || shop.mpPublicKey;
      const stripe = await loadStripe(publishable);
      if (!stripe) {
        setError("Não foi possível abrir o pagamento.");
        return;
      }
      if (payload.sessionId) {
        rememberCheckoutSession(shop.slug, payload.sessionId);
        upsertMyOrder(shop.slug, {
          id: payload.sessionId,
          status: "pending",
          total: payTotal,
          createdAt: new Date().toISOString(),
        });
      }
      clearParentOrder(shop.slug);
      checkoutRef.current?.destroy?.();
      const clientSecret = payload.clientSecret;
      const checkout = stripe.createEmbeddedCheckoutPage
        ? await stripe.createEmbeddedCheckoutPage({
            fetchClientSecret: async () => clientSecret,
          })
        : await stripe.initEmbeddedCheckout({ clientSecret });
      checkoutRef.current = checkout;
      pendingMount.current = checkout;
      setPaying(true);
      clear();
    } catch {
      setError("Não foi possível falar com o servidor de pagamento. Rode npm run pay.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="checkout-page">
      <PageHead title={paying ? "Pagamento" : "Seus dados"} />
      {waiting ? (
        <div className="empty">
          <h2>Carregando o pedido</h2>
        </div>
      ) : lines.length === 0 && !paying ? (
        <div className="empty">
          <h2>Sua sacola está vazia</h2>
          <button type="button" className="primary" onClick={goHome}>
            Ver cardápio
          </button>
        </div>
      ) : paying ? (
        <div className="form">
          <p className="hint">Pague com Pix ou cartão na Stripe. Ao concluir, o pedido vai para a loja.</p>
          {error ? <p className="form-error">{error}</p> : null}
          <div ref={box} className="stripe-box" />
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <p className="hint">Informe seus dados para a loja entrar em contato. Depois você paga na Stripe, sem sair do site.</p>
          <label>
            Seu nome
            <input
              value={customer.name}
              autoComplete="name"
              maxLength={80}
              placeholder="Nome e sobrenome"
              onChange={(event) => setCustomer({ name: event.target.value })}
            />
          </label>
          <label>
            WhatsApp
            <input
              ref={whatsappBox}
              type="tel"
              name="tel"
              value={formatPhone(customer.whatsapp)}
              inputMode="tel"
              autoComplete="tel"
              maxLength={22}
              placeholder="(11) 99999-9999"
              onChange={(event) => setCustomer({ whatsapp: phoneDigits(event.target.value) })}
              onInput={(event) => setCustomer({ whatsapp: phoneDigits(event.target.value) })}
            />
          </label>

          <div>
            <p className="field-label">Como você quer receber</p>
            <div className="choices">
              <button
                type="button"
                className="choice"
                aria-pressed={customer.mode === "retirada"}
                onClick={() => setCustomer({ mode: "retirada" })}
              >
                <span>Retirada no balcão</span>
                <span className={customer.mode === "retirada" ? "radio on" : "radio"} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="choice"
                aria-pressed={customer.mode === "entrega"}
                onClick={() => setCustomer({ mode: "entrega" })}
              >
                <span>Entrega</span>
                <span className={customer.mode === "entrega" ? "radio on" : "radio"} aria-hidden="true" />
              </button>
            </div>
          </div>

          {customer.mode === "entrega" ? (
            <>
              <div className="cep-row">
                <label>
                  CEP
                  <input
                    value={formatCep(customer.cep)}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    maxLength={9}
                    placeholder="00000-000"
                    onChange={(event) =>
                      updatePlace({
                        cep: cepDigits(event.target.value),
                        street: "",
                        neighborhood: "",
                        city: "",
                        uf: "",
                      })
                    }
                  />
                </label>
                <label>
                  Número
                  <input
                    value={customer.number || ""}
                    inputMode="text"
                    autoComplete="address-line2"
                    maxLength={20}
                    onChange={(event) => updatePlace({ number: event.target.value })}
                  />
                </label>
              </div>
              {cepError ? <p className="form-error">{cepError}</p> : null}
              {customer.street ? (
                <p className="hint">
                  {customer.street}
                  {customer.neighborhood ? ` · ${customer.neighborhood}` : ""}
                  {customer.city ? ` · ${customer.city}/${customer.uf}` : ""}
                </p>
              ) : null}
              <label>
                Complemento
                <input
                  value={customer.complement || ""}
                  maxLength={80}
                  placeholder="Apto, bloco…"
                  onChange={(event) => updatePlace({ complement: event.target.value })}
                />
              </label>
              {quoting ? <p className="hint">Calculando entrega…</p> : null}
              {delivery && !delivery.error ? (
                <p className="hint">
                  {deliveryFeeLabel(delivery.fee)} · {deliveryRulesHint(shop)}
                </p>
              ) : null}
              {delivery?.error ? <p className="form-error">{delivery.error}</p> : null}
            </>
          ) : null}

          <label>
            Observações
            <textarea
              value={customer.notes || ""}
              maxLength={240}
              placeholder="Sem cebola, ponto de referência…"
              onChange={(event) => setCustomer({ notes: event.target.value })}
            />
          </label>

          <label>
            Cupom
            <input
              value={couponInput}
              maxLength={24}
              placeholder="Código"
              onChange={(event) => setCouponInput(cleanCouponCode(event.target.value))}
            />
          </label>
          {coupon ? (
            <p className="hint">
              Cupom {coupon.code}: {coupon.percent}% off
            </p>
          ) : null}
          {cleanMinOrder(shop.minOrder) > 0 && total < cleanMinOrder(shop.minOrder) ? (
            <p className="form-error">Pedido mínimo: {money(cleanMinOrder(shop.minOrder))}</p>
          ) : null}

          {error ? <p className="form-error">{error}</p> : null}
          <button
            type="submit"
            className="primary"
            disabled={
              pending ||
              !deliveryReady ||
              (cleanMinOrder(shop.minOrder) > 0 && total < cleanMinOrder(shop.minOrder))
            }
          >
            <span>{pending ? "Abrindo…" : "Pagar"}</span>
            <span>{money(payTotal)}</span>
          </button>
          {lines.map((line) => (
            <p key={`${line.productId}-${line.note}`} className="muted">
              {line.qty}× {line.product?.name || line.name}
              {(line.options || []).length ? ` · ${line.options.map(formatOption).join(", ")}` : ""}
            </p>
          ))}
        </form>
      )}
    </div>
  );
}
