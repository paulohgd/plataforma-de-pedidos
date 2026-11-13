import { useEffect, useRef, useState } from "react";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useCatalog } from "../catalog";
import { cepDigits, composeAddress, formatCep, lookupCep } from "../cep";
import { formatCountdown, formatPhone, money, phoneDigits, validPhone } from "../format";
import { cleanCouponCode, couponDiscount, findCoupon } from "../coupons";
import { cleanMinOrder, deliveryFeeLabel, deliveryRulesHint } from "../freight";
import { useCart } from "../cart";
import { formatOption } from "../order";
import { upsertMyOrder } from "../myOrders";
import {
  clearParentOrder,
  fetchCheckoutSession,
  readParentOrderId,
  rememberCheckoutSession,
  rememberParentOrder,
} from "../pay";
import { useUI } from "../router";
import { PageHead } from "../ui";

const stripeCache = new Map();

function stripePromiseFor(key) {
  const publishable = String(key || "").trim();
  if (!publishable) return null;
  if (!stripeCache.has(publishable)) stripeCache.set(publishable, loadStripe(publishable));
  return stripeCache.get(publishable);
}

function CardPayForm({
  confirming,
  onError,
  onPaid,
  onPending,
  payerEmail = "",
  payerName = "",
  payerPhone = "",
  billingAddress = null,
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [elementReady, setElementReady] = useState(false);
  const billingName = String(payerName || "Cliente").trim().slice(0, 120) || "Cliente";
  const billingEmail = String(payerEmail || "").trim();
  const digits = String(payerPhone || "").replace(/\D/g, "");
  const billingPhone = digits ? (digits.startsWith("55") ? `+${digits}` : `+55${digits}`) : "+5511999999999";
  const address = {
    country: "BR",
    postal_code: String(billingAddress?.postal_code || "").replace(/\D/g, "").slice(0, 8) || "01001000",
    state: String(billingAddress?.state || "SP").trim().slice(0, 2).toUpperCase() || "SP",
    city: String(billingAddress?.city || "São Paulo").trim().slice(0, 100) || "São Paulo",
    line1: String(billingAddress?.line1 || "Brasil").trim().slice(0, 120) || "Brasil",
  };

  async function pay() {
    if (!stripe || !elements || !elementReady) throw new Error("Aguarde o cartão carregar.");
    const result = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: {
        return_url: `${window.location.origin}${window.location.pathname}`,
        payment_method_data: {
          billing_details: {
            name: billingName,
            email: billingEmail || undefined,
            phone: billingPhone,
            address,
          },
        },
      },
    });
    if (result.error) throw new Error(result.error.message || "Não foi possível pagar com cartão.");
    if (result.paymentIntent?.status === "succeeded") {
      onPaid();
      return;
    }
    onPending();
  }

  return (
    <div className="pay-box stripe-card-box">
      <PaymentElement
        options={{
          layout: "tabs",
          wallets: { applePay: "auto", googlePay: "auto" },
          fields: { billingDetails: { email: "never", name: "never", phone: "never", address: "never" } },
        }}
        onReady={() => setElementReady(true)}
        onLoadError={() => onError("Não foi possível abrir o cartão.")}
      />
      {elementReady ? (
        <button type="button" className="primary" disabled={confirming || !stripe} onClick={() => pay().catch((err) => onError(err.message))}>
          <span>{confirming ? "Processando…" : "Pagar"}</span>
        </button>
      ) : (
        <p className="hint">Carregando os dados do cartão…</p>
      )}
    </div>
  );
}

export default function Checkout() {
  const { shop, ready, missing } = useCatalog();
  const { lines, total, customer, setCustomer, clear } = useCart();
  const { goHome, route, openPaid, openPixPay } = useUI();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [paying, setPaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [method, setMethod] = useState("pix");
  const [pixCopy, setPixCopy] = useState("");
  const [pixExpiresAt, setPixExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [cardReady, setCardReady] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [delivery, setDelivery] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [cepError, setCepError] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const whatsappBox = useRef(null);
  const leaving = useRef(false);
  const waiting = !ready || (route.slug && shop.slug !== route.slug && !missing);
  const pixMsLeft = pixExpiresAt ? pixExpiresAt - now : 0;
  const pixAlive = Boolean(pixCopy) && pixMsLeft > 0;
  const deliveryFee = customer.mode === "entrega" && delivery && !delivery.error ? Number(delivery.fee) || 0 : 0;
  const coupon = findCoupon(shop.coupons, couponInput);
  const discount = couponDiscount(total, coupon);
  const payTotal = Number((total - discount + deliveryFee).toFixed(2));
  const deliveryCep = cepDigits(customer.cep);
  const stripeKey = publicKey || shop.stripePublishableKey || shop.mpPublicKey;
  const addressReady =
    customer.mode !== "entrega" ||
    Boolean(
      deliveryCep.length === 8 &&
        String(customer.number || "").trim() &&
        customer.city &&
        !cepError,
    );
  const deliveryReady =
    customer.mode !== "entrega" ||
    Boolean(addressReady && delivery && !delivery.error && !quoting);

  function updatePlace(patch) {
    setCustomer(patch);
  }

  function rememberOrder(patch) {
    const slug = shop.slug || route.slug;
    upsertMyOrder(slug, {
      id: sessionId,
      shopName: shop.name,
      shopLogo: shop.logo,
      total: payTotal,
      items: lines.map((line) => ({ name: line.product?.name || line.name, qty: line.qty, total: line.total })),
      ...patch,
      createdAt: patch.createdAt || new Date().toISOString(),
    });
  }

  function goPaid(id = sessionId) {
    if (leaving.current) return;
    leaving.current = true;
    const slug = shop.slug || route.slug;
    rememberCheckoutSession(slug, id);
    rememberOrder({ id, status: "paid", payment: method === "card" ? "card" : "pix" });
    if (slug) localStorage.removeItem(`pedido-sacola:${slug}`);
    setCompleting(true);
    openPaid(id);
  }

  function goPix(copy, expiresAt) {
    if (leaving.current) return;
    leaving.current = true;
    const slug = shop.slug || route.slug;
    rememberCheckoutSession(slug, sessionId);
    rememberParentOrder(slug, sessionId);
    rememberOrder({
      payment: "pix",
      pixCopy: copy,
      expiresAt: Number(expiresAt) || 0,
      status: "pending",
    });
    setCompleting(true);
    openPixPay(sessionId);
    clear();
  }

  function startNewCheckoutForCard() {
    const slug = shop.slug || route.slug;
    if (sessionId) rememberParentOrder(slug, sessionId);
    setError("Você já iniciou um pagamento via Pix. Monte a sacola de novo e pague com cartão em um novo pedido.");
    goHome();
  }

  useEffect(() => {
    if (customer.email) setCustomer({ email: "" });
  }, [customer.email]);

  useEffect(() => {
    if (!pixExpiresAt) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pixExpiresAt]);

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
  }, [customer.cep, customer.mode]);

  useEffect(() => {
    if (customer.mode !== "entrega") {
      setDelivery(null);
      setQuoting(false);
      return undefined;
    }
    if (!addressReady) {
      setDelivery(null);
      setQuoting(false);
      return undefined;
    }
    let cancel = false;
    setQuoting(true);
    setDelivery(null);
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
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (cancel) return;
        if (!response.ok) {
          setDelivery({ error: payload.error || "Não foi possível calcular a entrega." });
          return;
        }
        setDelivery(payload);
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
    customer.street,
    customer.neighborhood,
    customer.city,
    customer.uf,
    customer.complement,
    shop.slug,
    route.slug,
    addressReady,
  ]);

  useEffect(() => {
    if (!paying || method !== "card" || pixAlive || !sessionId) {
      setClientSecret("");
      setPayerEmail("");
      setCardReady(false);
      return undefined;
    }
    let cancel = false;
    setCardReady(false);
    setClientSecret("");
    setPayerEmail("");
    (async () => {
      const response = await fetch("/api/pay-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const payload = await response.json().catch(() => ({}));
      if (cancel) return;
      if (payload.paid) {
        goPaid();
        return;
      }
      if (!response.ok || !payload.clientSecret) {
        setError(payload.error || "Não foi possível preparar o cartão.");
        return;
      }
      setClientSecret(payload.clientSecret);
      setPayerEmail(String(payload.payerEmail || "").trim());
      setCardReady(true);
    })().catch(() => {
      if (!cancel) setError("Não foi possível preparar o cartão.");
    });
    return () => {
      cancel = true;
    };
  }, [paying, method, pixAlive, sessionId]);

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
    if (!(shop.stripePublishableKey || shop.mpPublicKey || publicKey)) {
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
      if (!response.ok || !payload.sessionId) {
        setError(payload.error || "Não foi possível iniciar o pagamento.");
        return;
      }
      setSessionId(payload.sessionId);
      setPublicKey(payload.publicKey || shop.stripePublishableKey || shop.mpPublicKey);
      rememberCheckoutSession(shop.slug, payload.sessionId);
      clearParentOrder(shop.slug);
      setPaying(true);
    } catch {
      setError("Não foi possível falar com o servidor de pagamento. Rode npm run pay.");
    } finally {
      setPending(false);
    }
  }

  async function confirmPay() {
    setConfirming(true);
    setError("");
    try {
      const place = {
        cep: customer.cep,
        street: customer.street,
        number: customer.number,
        neighborhood: customer.neighborhood,
        city: customer.city,
        uf: customer.uf,
        complement: customer.complement,
      };
      if (method === "card" && pixAlive) {
        setMethod("pix");
        throw new Error("Você já iniciou um pagamento via Pix. Para pagar com cartão, inicie um novo pedido.");
      }
      if (method !== "pix") return;
      if (pixAlive) return;
      const response = await fetch("/api/create-pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          place,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Não foi possível gerar o Pix.");
      if (payload.paid) {
        goPaid();
        return;
      }
      if (payload.pending) {
        setCompleting(true);
        return;
      }
      if (!payload.pixCopy) {
        throw new Error(payload.error || "Não foi possível gerar o Pix. Tente de novo.");
      }
      goPix(payload.pixCopy, payload.expiresAt);
    } catch (failure) {
      setError(failure.message || "Não foi possível concluir o pagamento.");
    } finally {
      setConfirming(false);
    }
  }

  async function copyPix() {
    try {
      await navigator.clipboard.writeText(pixCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Não foi possível copiar. Selecione o código e copie.");
    }
  }

  const busy = pending || confirming || completing;
  const stripePromise = stripePromiseFor(stripeKey);

  return (
    <div className="checkout-page">
      <PageHead title={paying ? "Pagamento" : "Seus dados"} />
      {busy ? (
        <div className="pay-loading" role="status" aria-live="polite">
          <span className="pay-spinner" aria-hidden="true" />
          <h2>
            {completing
              ? "Confirmando o pagamento"
              : confirming && method === "pix"
                ? "Gerando o Pix"
                : confirming
                  ? "Processando o cartão"
                  : "Preparando o pagamento"}
          </h2>
          <p>Aguarde alguns segundos. Não feche esta tela.</p>
        </div>
      ) : null}
      {waiting ? (
        <div className="empty">
          <h2>Carregando o pedido</h2>
        </div>
      ) : lines.length === 0 ? (
        <div className="empty">
          <h2>Sua sacola está vazia</h2>
          <button type="button" className="primary" onClick={goHome}>
            Ver cardápio
          </button>
        </div>
      ) : paying ? (
        <div className="form">
          <p className="hint">
            {customer.name} · {formatPhone(customer.whatsapp)} · {money(payTotal)}
          </p>
          {pixAlive ? null : (
            <div className="pay-tabs">
              <button
                type="button"
                className={method === "pix" ? "choice on" : "choice"}
                onClick={() => {
                  setMethod("pix");
                  setError("");
                }}
              >
                Pix
              </button>
              <button
                type="button"
                className={method === "card" ? "choice on" : "choice"}
                onClick={() => {
                  setMethod("card");
                  setError("");
                }}
              >
                Cartão
              </button>
            </div>
          )}
          {method === "pix" || pixAlive ? (
            pixAlive ? (
              <div className="pix-copy">
                <p className="hint">Cole este código no app do banco. Não usamos QR Code.</p>
                <textarea readOnly value={pixCopy} />
                <button type="button" className="ghost" onClick={copyPix}>
                  {copied ? "Código copiado" : "Copiar código Pix"}
                </button>
                <p className={pixMsLeft <= 60000 ? "pix-timer ending" : "pix-timer"}>
                  Código válido por {formatCountdown(pixMsLeft)}
                </p>
                <p className="hint">Aguardando o pagamento…</p>
                <p className="hint">Você já iniciou um pagamento via Pix. Para pagar com cartão, será necessário iniciar um novo pedido.</p>
                <button type="button" className="ghost" onClick={startNewCheckoutForCard}>
                  Iniciar novo pedido com cartão
                </button>
              </div>
            ) : pixCopy || pixExpiresAt ? (
              <p className="hint">Este código Pix expirou. Faça um novo pedido para pagar com Pix ou cartão.</p>
            ) : (
              <p className="hint">Se gerar o Pix, este pedido fica só no Pix. Antes disso, você ainda pode tentar o cartão.</p>
            )
          ) : null}
          {method === "card" && !pixAlive ? (
            <>
              {!cardReady ? <p className="hint">Carregando o cartão…</p> : null}
              {cardReady && clientSecret && stripePromise ? (
                <Elements
                  stripe={stripePromise}
                  options={{
                    clientSecret,
                    appearance: { theme: document.documentElement.classList.contains("dark") ? "night" : "stripe" },
                  }}
                >
                  <CardPayForm
                    confirming={confirming}
                    payerEmail={payerEmail}
                    payerName={customer.name}
                    payerPhone={customer.whatsapp}
                    billingAddress={{
                      postal_code: deliveryCep.length === 8 ? deliveryCep : cepDigits(shop.cep),
                      state: customer.uf || "",
                      city: customer.city || "",
                      line1: [customer.street, customer.number].filter(Boolean).join(", ") || customer.address || "",
                    }}
                    onError={setError}
                    onPaid={() => goPaid()}
                    onPending={async () => {
                      setCompleting(true);
                      for (let attempt = 0; attempt < 20; attempt += 1) {
                        await new Promise((resolve) => setTimeout(resolve, 1500));
                        const check = await fetchCheckoutSession(sessionId);
                        if (check.ok && check.payload?.paid) {
                          goPaid();
                          return;
                        }
                        if (check.ok && check.payload?.canceled) {
                          setCompleting(false);
                          setError("O pagamento não foi aprovado. Tente de novo ou pague com Pix.");
                          return;
                        }
                      }
                      setCompleting(false);
                      setError("Ainda estamos confirmando o cartão. Veja em Pedidos.");
                    }}
                  />
                </Elements>
              ) : null}
            </>
          ) : null}
          {error ? <p className="form-error">{error}</p> : null}
          {pixAlive || method === "card" ? null : (
            <button type="button" className="primary" disabled={confirming} onClick={confirmPay}>
              <span>{confirming ? "Gerando…" : pixCopy && !pixAlive ? "Gerar novo código Pix" : "Pagar"}</span>
              <span>{money(payTotal)}</span>
            </button>
          )}
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <p className="hint">Informe seus dados para a loja entrar em contato. Depois você paga no cartão ou Pix, sem sair do site.</p>
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
                <p className="hint">{deliveryFeeLabel(delivery.fee)} · {deliveryRulesHint(shop)}</p>
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
          {coupon ? <p className="hint">Cupom {coupon.code}: {coupon.percent}% off</p> : null}
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
            <span>{pending ? "Abrindo…" : "Continuar para pagar"}</span>
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
