import { useEffect, useRef, useState } from "react";
import { loadStripe } from "@stripe/stripe-js";
import { useCatalog } from "../catalog";
import { cepDigits, composeAddress, formatCep, lookupCep } from "../cep";
import { formatPhone, money, phoneDigits, validPhone } from "../format";
import { cleanCouponCode, couponDiscount, findCoupon } from "../coupons";
import { cleanMinOrder, deliveryFeeLabel, deliveryRulesHint } from "../freight";
import { useCart } from "../cart";
import { formatOption } from "../order";
import { checkoutSessionId, fetchCheckoutSession, rememberCheckoutSession } from "../pay";
import { useUI } from "../router";
import { PageHead } from "../ui";

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export default function Checkout() {
  const { shop, ready, missing } = useCatalog();
  const { lines, total, customer, setCustomer } = useCart();
  const { goHome, route, openPaid } = useUI();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [paying, setPaying] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [method, setMethod] = useState("pix");
  const [cardKind, setCardKind] = useState("credit");
  const [wallet, setWallet] = useState(false);
  const [pixCopy, setPixCopy] = useState("");
  const [pixExpiresAt, setPixExpiresAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [copied, setCopied] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [checkoutReady, setCheckoutReady] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [delivery, setDelivery] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [cepError, setCepError] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const box = useRef(null);
  const walletBox = useRef(null);
  const checkoutRef = useRef(null);
  const paymentRef = useRef(null);
  const walletRef = useRef(null);
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

  function goPaid(id = sessionId) {
    if (leaving.current) return;
    leaving.current = true;
    const slug = shop.slug || route.slug;
    const paidId = id || checkoutSessionId(clientSecret);
    rememberCheckoutSession(slug, paidId);
    if (slug) localStorage.removeItem(`pedido-sacola:${slug}`);
    setCompleting(true);
    openPaid(paidId);
  }

  async function confirmCheckout(extra = {}) {
    const checkout = checkoutRef.current;
    if (!checkout) throw new Error("Aguarde o pagamento carregar.");
    const loaded = await checkout.loadActions();
    if (loaded.type === "error") {
      throw new Error(loaded.error?.message || "Não foi possível concluir o pagamento.");
    }
    const result = await loaded.actions.confirm({
      redirect: "if_required",
      ...extra,
    });
    if (result.type === "error") {
      throw new Error(result.error?.message || "Não foi possível concluir o pagamento.");
    }
    if (result.session?.status?.type === "complete" && result.session.status.paymentStatus === "paid") {
      goPaid(result.session.id || sessionId);
    }
  }

  useEffect(
    () => () => {
      paymentRef.current?.unmount?.();
      walletRef.current?.unmount?.();
    },
    [],
  );

  useEffect(() => {
    if (!paying || !clientSecret || !walletBox.current) return undefined;
    let canceled = false;
    setCheckoutReady(false);
    (async () => {
      const stripe = await loadStripe(shop.stripePublishableKey);
      if (!stripe || canceled) return;
      walletRef.current?.unmount?.();
      const dark = document.documentElement.classList.contains("dark");
      let checkout = stripe.initCheckout({
        clientSecret,
        defaultValues: {
          billingAddress: {
            name: customer.name || undefined,
            address: { country: "BR" },
          },
        },
        elementsOptions: {
          appearance: {
            theme: dark ? "night" : "stripe",
            variables: {
              colorPrimary: dark ? "#f2f2f2" : "#1a1a1a",
              colorBackground: dark ? "#1e1e1e" : "#ffffff",
              colorText: dark ? "#f2f2f2" : "#2a2a2a",
              colorTextSecondary: dark ? "#c4c4c4" : "#5a5a5a",
              borderRadius: "8px",
              fontSizeBase: "16px",
            },
          },
        },
      });
      if (checkout && typeof checkout.then === "function") checkout = await checkout;
      if (canceled) return;
      checkoutRef.current = checkout;
      let express = null;
      try {
        express = checkout.createExpressCheckoutElement({
          buttonHeight: 48,
          paymentMethods: { googlePay: "always", applePay: "never", link: "never" },
        });
      } catch {
        express = null;
      }
      if (express && walletBox.current) {
        express.on("ready", (event) => {
          setWallet(Boolean(event.availablePaymentMethods?.googlePay));
        });
        express.on("confirm", async (event) => {
          try {
            await confirmCheckout({ expressCheckoutConfirmEvent: event });
          } catch (failure) {
            setError(failure.message || "Não foi possível pagar com Google Pay.");
          }
        });
        express.mount(walletBox.current);
        walletRef.current = express;
      }
      setCheckoutReady(true);
    })().catch((failure) => {
      if (!canceled) setError(failure?.message || "Não foi possível abrir o pagamento.");
    });
    return () => {
      canceled = true;
      setCheckoutReady(false);
      paymentRef.current?.unmount?.();
      walletRef.current?.unmount?.();
      paymentRef.current = null;
      walletRef.current = null;
      checkoutRef.current = null;
    };
  }, [paying, clientSecret, shop.stripePublishableKey]);

  useEffect(() => {
    if (!paying || method !== "card" || !checkoutReady || !box.current) return;
    const checkout = checkoutRef.current;
    if (!checkout) return;
    try {
      const existing = typeof checkout.getPaymentElement === "function" ? checkout.getPaymentElement() : paymentRef.current;
      if (existing) {
        paymentRef.current = existing;
        return;
      }
      const payment = checkout.createPaymentElement({
        layout: "tabs",
        wallets: { applePay: "never", googlePay: "never" },
        fields: {
          billingDetails: {
            address: { country: "never" },
          },
        },
      });
      payment.mount(box.current);
      paymentRef.current = payment;
    } catch (failure) {
      const existing = checkout.getPaymentElement?.();
      if (existing) {
        paymentRef.current = existing;
        return;
      }
      setError(failure?.message || "Não foi possível abrir o cartão.");
    }
  }, [paying, method, checkoutReady]);

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
        street: found.street,
        neighborhood: found.neighborhood,
        city: found.city,
        uf: found.uf,
      });
    });
    return () => {
      cancel = true;
    };
  }, [customer.mode, customer.cep]);

  useEffect(() => {
    if (customer.mode !== "entrega") return;
    const address = composeAddress(customer);
    if (address !== customer.address) setCustomer({ address });
  }, [
    customer.mode,
    customer.cep,
    customer.number,
    customer.complement,
    customer.street,
    customer.neighborhood,
    customer.city,
    customer.uf,
    customer.address,
  ]);

  useEffect(() => {
    if (customer.mode !== "entrega") {
      setDelivery(null);
      setQuoting(false);
      return undefined;
    }
    const cep = cepDigits(customer.cep);
    if (cep.length !== 8 || !shop.slug || cepError) {
      setDelivery(null);
      setQuoting(false);
      return undefined;
    }
    let cancel = false;
    setQuoting(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch("/api/quote-delivery", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            slug: shop.slug,
            cep,
            address: customer.address,
            number: customer.number,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (cancel) return;
        if (!response.ok) {
          setDelivery({ error: payload.error || "Não foi possível calcular o frete." });
          return;
        }
        setDelivery({ km: payload.km, fee: payload.fee });
      } catch {
        if (!cancel) setDelivery({ error: "Não foi possível calcular o frete." });
      } finally {
        if (!cancel) setQuoting(false);
      }
    }, 700);
    return () => {
      cancel = true;
      clearTimeout(timer);
    };
  }, [customer.mode, customer.cep, customer.address, shop.slug, cepError]);

  useEffect(() => {
    if (!pixExpiresAt) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [pixExpiresAt]);

  useEffect(() => {
    if (!paying || !sessionId || !shop.slug) return undefined;
    let cancel = false;
    async function tick() {
      try {
        const { payload } = await fetchCheckoutSession(sessionId);
        if (cancel) return;
        if (!payload.paid) return;
        goPaid();
      } catch {
        /* o webhook ainda pode confirmar o pedido */
      }
    }
    tick();
    const timer = setInterval(tick, 4000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [paying, sessionId, shop.slug]);

  async function submit(event) {
    event.preventDefault();
    if (!lines.length) {
      setError("Adicione itens na sacola.");
      return;
    }
    if (!shop.open) {
      setError("A loja está fechada no momento.");
      return;
    }
    const minOrder = Math.max(0.5, cleanMinOrder(shop.minOrder));
    if (total < minOrder) {
      setError(`O pedido mínimo é ${money(minOrder)}.`);
      return;
    }
    if (cleanCouponCode(couponInput) && !coupon) {
      setError("Cupom inválido.");
      return;
    }
    if (payTotal < 0.5) {
      setError("O valor com desconto ficou abaixo do mínimo para pagamento.");
      return;
    }
    const name = String(customer.name || "").trim();
    const whatsapp = phoneDigits(whatsappBox.current?.value || customer.whatsapp);
    if (name.length < 2) {
      setError("Informe seu nome.");
      return;
    }
    if (!validPhone(whatsapp)) {
      setError("Informe um WhatsApp válido, com DDD.");
      return;
    }
    if (whatsapp !== customer.whatsapp) setCustomer({ whatsapp });
    if (customer.mode === "entrega") {
      if (deliveryCep.length !== 8) {
        setError("Informe o CEP da entrega.");
        return;
      }
      if (cepError) {
        setError(cepError);
        return;
      }
      if (!String(customer.number || "").trim()) {
        setError("Informe o número da entrega.");
        return;
      }
      if (quoting || !delivery || delivery.error) {
        setError(delivery?.error || "Aguarde o cálculo do frete.");
        return;
      }
    }
    if (!shop.stripePublishableKey) {
      setError("Falta a chave publicável da Stripe nas configurações da loja.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: shop.slug,
          customer: {
            name,
            whatsapp,
            mode: customer.mode,
            cep: deliveryCep,
            address: composeAddress(customer),
            notes: customer.notes,
          },
          lines: lines.map((line) => ({
            productId: line.productId,
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
      const id = checkoutSessionId(payload.clientSecret);
      setClientSecret(payload.clientSecret);
      setSessionId(id);
      rememberCheckoutSession(shop.slug, id);
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
      if (method === "pix") {
        const response = await fetch("/api/create-pix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sessionId }),
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Não foi possível gerar o Pix.");
        if (payload.pixCopy) {
          setPixCopy(payload.pixCopy);
          setPixExpiresAt(Number(payload.expiresAt || 0));
        }
        if (payload.paid) goPaid();
        return;
      }
      await confirmCheckout();
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

  return (
    <div className="checkout-page">
      <PageHead title={paying ? "Pagamento" : "Seus dados"} />
      {waiting ? (
        <div className="empty">
          <h2>Carregando o pedido</h2>
        </div>
      ) : completing ? (
        <div className="empty paid-box">
          <h2>Confirmando o pagamento</h2>
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
          <div ref={walletBox} className={wallet ? "gpay-box" : "gpay-box gpay-pending"} />
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
          {method === "pix" ? (
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
              </div>
            ) : pixCopy || pixExpiresAt ? (
              <p className="hint">Este código Pix expirou. Gere um novo para pagar.</p>
            ) : (
              <p className="hint">Toque em Pagar para gerar o código Pix (copia e cola).</p>
            )
          ) : null}
          {method === "card" ? (
            <>
              <div className="pay-tabs">
                <button
                  type="button"
                  className={cardKind === "credit" ? "choice on" : "choice"}
                  onClick={() => setCardKind("credit")}
                >
                  Crédito
                </button>
                <button
                  type="button"
                  className={cardKind === "debit" ? "choice on" : "choice"}
                  onClick={() => setCardKind("debit")}
                >
                  Débito
                </button>
              </div>
            </>
          ) : null}
          <div ref={box} className="stripe-box" hidden={method !== "card"} />
          {error ? <p className="form-error">{error}</p> : null}
          {method === "pix" && pixAlive ? null : (
            <button type="button" className="primary" disabled={confirming} onClick={confirmPay}>
              <span>
                {confirming ? "Gerando…" : method === "pix" && pixCopy && !pixAlive ? "Gerar novo código Pix" : "Pagar"}
              </span>
              <span>{money(payTotal)}</span>
            </button>
          )}
        </div>
      ) : (
        <form className="form" onSubmit={submit}>
          <p className="hint">Informe seus dados para a loja entrar em contato. Depois você paga no cartão, Pix ou Google Pay.</p>
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
                    maxLength={12}
                    placeholder="123"
                    onChange={(event) => updatePlace({ number: event.target.value })}
                  />
                </label>
              </div>
              <label>
                Complemento
                <input
                  value={customer.complement || ""}
                  maxLength={40}
                  placeholder="Apto, bloco, casa"
                  onChange={(event) => updatePlace({ complement: event.target.value })}
                />
              </label>
              {customer.city ? (
                <p className="hint">
                  {[customer.street, customer.neighborhood, customer.city, customer.uf].filter(Boolean).join(" · ")}
                </p>
              ) : null}
              {cepError ? <p className="form-error">{cepError}</p> : null}
              <p className="hint">{deliveryRulesHint(shop)}</p>
              {quoting ? <p className="hint">Calculando o frete…</p> : null}
              {delivery?.error ? <p className="form-error">{delivery.error}</p> : null}
            </>
          ) : null}

          <label>
            Cupom de desconto
            <input
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck="false"
              maxLength={24}
              value={couponInput}
              onChange={(event) => setCouponInput(cleanCouponCode(event.target.value))}
            />
          </label>
          {coupon ? <p className="hint">{coupon.percent}% de desconto aplicado nos itens.</p> : null}
          {couponInput.length >= 3 && !coupon ? <p className="form-error">Cupom inválido.</p> : null}

          <label>
            Observações do pedido
            <textarea
              rows={2}
              maxLength={200}
              placeholder="Ex.: sem pressa, interfone 2"
              value={customer.notes}
              onChange={(event) => setCustomer({ notes: event.target.value })}
            />
          </label>

          <section className="summary">
            <h2>Seu pedido</h2>
            {lines.map((line) => (
              <p key={line.id}>
                <span>
                  {line.qty}x {line.product.name}
                  {line.options?.length
                    ? ` · ${line.options.map((option) => formatOption(line, option)).join(" · ")}`
                    : ""}
                </span>
                <span>{money(line.total)}</span>
              </p>
            ))}
            {discount > 0 && coupon ? (
              <p>
                <span>Cupom {coupon.code} (−{coupon.percent}%)</span>
                <span>-{money(discount)}</span>
              </p>
            ) : null}
            {customer.mode === "entrega" ? (
              <p>
                <span>Entrega</span>
                <span>
                  {quoting
                    ? "Calculando…"
                    : delivery && !delivery.error
                      ? deliveryFeeLabel(delivery)
                      : "Informe o CEP"}
                </span>
              </p>
            ) : null}
            <p className="sum">
              <span>Total</span>
              <strong>{money(payTotal)}</strong>
            </p>
            {cleanMinOrder(shop.minOrder) > 0 ? (
              <p className="hint">Pedido mínimo: {money(Math.max(0.5, cleanMinOrder(shop.minOrder)))}</p>
            ) : null}
          </section>

          {error ? <p className="form-error">{error}</p> : null}
          <button type="submit" className="primary" disabled={pending || !deliveryReady}>
            <span>{pending ? "Abrindo pagamento…" : "Ir para o pagamento"}</span>
            <span>{money(payTotal)}</span>
          </button>
        </form>
      )}
    </div>
  );
}
