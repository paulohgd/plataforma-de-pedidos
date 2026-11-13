import { useEffect, useRef, useState } from "react";
import { loadMercadoPago } from "@mercadopago/sdk-js";
import { useCatalog } from "../catalog";
import { cepDigits, composeAddress, formatCep, lookupCep } from "../cep";
import { formatCountdown, formatPhone, money, phoneDigits, validEmail, validPhone } from "../format";
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

let mpSdkReady;

function ensureMpSdk() {
  if (!mpSdkReady) mpSdkReady = loadMercadoPago();
  return mpSdkReady;
}

async function readDeviceId() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const id = String(window.MP_DEVICE_SESSION_ID || document.querySelector("#deviceId")?.value || "").trim();
    if (id) return id;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return "";
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
  const [payerEmail, setPayerEmail] = useState("");
  const [cardEmail, setCardEmail] = useState("");
  const [challengeUrl, setChallengeUrl] = useState("");
  const [publicKey, setPublicKey] = useState("");
  const [cardReady, setCardReady] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [delivery, setDelivery] = useState(null);
  const [quoting, setQuoting] = useState(false);
  const [cepError, setCepError] = useState("");
  const [couponInput, setCouponInput] = useState("");
  const brickRef = useRef(null);
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
  const mpKey = publicKey || shop.mpPublicKey;
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

  function rememberOrder(patch) {
    const slug = shop.slug || route.slug;
    upsertMyOrder(slug, {
      id: sessionId,
      shopName: shop.name,
      shopLogo: shop.logo,
      total: payTotal,
      items: lines.map((line) => ({ name: line.product?.name || line.name, qty: line.qty, total: line.total })),
      createdAt: new Date().toISOString(),
      ...patch,
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

  useEffect(
    () => () => {
      brickRef.current?.unmount?.();
      brickRef.current = null;
    },
    [],
  );

  useEffect(() => {
    if (customer.email) setCustomer({ email: "" });
  }, [customer.email]);

  const brickEmail = validEmail(cardEmail) ? cardEmail.trim().toLowerCase() : "";

  useEffect(() => {
    if (!paying || method !== "card" || pixAlive || !mpKey || !sessionId || !brickEmail) {
      brickRef.current?.unmount?.();
      brickRef.current = null;
      setCardReady(false);
      return undefined;
    }
    let canceled = false;
    setCardReady(false);
    (async () => {
      await ensureMpSdk();
      if (canceled || !window.MercadoPago) return;
      brickRef.current?.unmount?.();
      brickRef.current = null;
      const dark = document.documentElement.classList.contains("dark");
      const mp = new window.MercadoPago(mpKey, { locale: "pt-BR" });
      const bricks = mp.bricks();
      const controller = await bricks.create("cardPayment", "mp-card-brick", {
        initialization: {
          amount: payTotal,
          payer: { email: brickEmail },
        },
        customization: {
          paymentMethods: {
            minInstallments: 1,
            maxInstallments: 1,
          },
          visual: {
            hidePaymentButton: true,
            style: { theme: dark ? "dark" : "default" },
          },
        },
        callbacks: {
          onReady: () => {
            if (!canceled) setCardReady(true);
          },
          onError: (failure) => {
            if (canceled) return;
            const text = String(failure?.message || "");
            setError(
              /field|invalid|cpf|card|cvv|expir/i.test(text)
                ? "Confira os dados do cartão. Número, validade, CVV e CPF precisam estar certos."
                : text || "Não foi possível abrir o cartão.",
            );
          },
        },
      });
      if (canceled) {
        controller?.unmount?.();
        return;
      }
      brickRef.current = controller;
    })().catch((failure) => {
      if (!canceled) setError(failure?.message || "Não foi possível abrir o cartão.");
    });
    return () => {
      canceled = true;
      setCardReady(false);
      brickRef.current?.unmount?.();
      brickRef.current = null;
    };
  }, [paying, method, pixAlive, mpKey, sessionId, payTotal, brickEmail]);

  useEffect(() => {
    if (!challengeUrl || !sessionId) return undefined;
    let cancel = false;
    let attempts = 0;
    async function tick() {
      if (cancel) return;
      attempts += 1;
      const { ok, payload } = await fetchCheckoutSession(sessionId);
      if (cancel) return;
      if (ok && payload.paid) {
        setChallengeUrl("");
        goPaid(sessionId);
        return;
      }
      if (ok && payload.canceled) {
        setChallengeUrl("");
        setCompleting(false);
        setError("A autenticação do cartão não foi concluída. Tente de novo ou pague com Pix.");
        return;
      }
      if (attempts >= 90) {
        setChallengeUrl("");
        setCompleting(false);
        setError("Não foi possível confirmar a autenticação do cartão. Tente de novo ou pague com Pix.");
      }
    }
    function onMessage(event) {
      if (event?.data?.status === "COMPLETE") tick();
    }
    window.addEventListener("message", onMessage);
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      cancel = true;
      clearInterval(timer);
      window.removeEventListener("message", onMessage);
    };
  }, [challengeUrl, sessionId]);

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
        if (payload.paid) goPaid();
        else if (completing && payload.canceled) {
          setCompleting(false);
          setError("O pagamento não foi aprovado. Confira os dados ou tente Pix.");
        }
      } catch {
        /* o webhook ainda pode confirmar o pedido */
      }
    }
    tick();
    const timer = setInterval(tick, 2000);
    return () => {
      cancel = true;
      clearInterval(timer);
    };
  }, [paying, sessionId, shop.slug, completing]);

  useEffect(() => {
    if (!completing) return undefined;
    const timer = setTimeout(() => {
      setCompleting(false);
      setError("O banco ainda não confirmou. Confira os dados e tente de novo, ou pague com Pix.");
    }, 35000);
    return () => clearTimeout(timer);
  }, [completing]);

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
    if (!shop.mpPublicKey) {
      setError("Falta a chave pública do Mercado Pago nas configurações da loja.");
      return;
    }
    setPending(true);
    setError("");
    try {
      const parentOrderId = readParentOrderId(shop.slug);
      const response = await fetch("/api/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: shop.slug,
          parentOrderId,
          customer: {
            name,
            whatsapp,
            mode: customer.mode,
            cep: deliveryCep,
            number: customer.number,
            complement: customer.complement,
            street: customer.street,
            neighborhood: customer.neighborhood,
            city: customer.city,
            uf: customer.uf,
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
      if (!response.ok || !payload.sessionId) {
        setError(payload.error || "Não foi possível iniciar o pagamento.");
        return;
      }
      setSessionId(payload.sessionId);
      setPublicKey(payload.publicKey || shop.mpPublicKey);
      setPayerEmail(payload.payerEmail || "");
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
      const deviceId = await readDeviceId();
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
      if (method === "pix") {
        if (pixAlive) return;
        const response = await fetch("/api/create-pix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            deviceId,
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
        return;
      }
      if (!validEmail(cardEmail)) {
        throw new Error("Informe um e-mail válido para pagar com cartão.");
      }
      if (!deviceId) {
        throw new Error("Não foi possível validar este dispositivo. Atualize a página e tente de novo.");
      }
      const brick = brickRef.current;
      if (!brick?.getFormData) throw new Error("Aguarde o cartão carregar.");
      let formData;
      try {
        formData = await brick.getFormData();
      } catch {
        throw new Error("Confira os dados do cartão. Número, validade, CVV e CPF precisam estar certos.");
      }
      if (!formData?.token) {
        throw new Error("Confira os dados do cartão. Número, validade, CVV e CPF precisam estar certos.");
      }
      const extra = (await brick.getAdditionalData?.().catch(() => ({}))) || {};
      const response = await fetch("/api/pay-card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          token: formData.token,
          paymentMethodId: formData.payment_method_id,
          paymentTypeId: extra.paymentTypeId || formData.payment_type_id || "credit_card",
          installments: Number(formData.installments) || 1,
          identification: formData.payer?.identification,
          email: brickEmail || cardEmail.trim(),
          deviceId: extra.deviceId || extra.device_id || deviceId,
          place,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (payload.pixCopy) {
        setPixCopy(payload.pixCopy);
        if (payload.expiresAt) setPixExpiresAt(Number(payload.expiresAt));
      }
      if (payload.paid) {
        goPaid();
        return;
      }
      if (payload.challengeUrl) {
        setChallengeUrl(String(payload.challengeUrl));
        setCompleting(true);
        return;
      }
      if (payload.pending) {
        setCompleting(true);
        return;
      }
      if (!response.ok) {
        if (payload.pixCopy) {
          goPix(payload.pixCopy, payload.expiresAt);
          return;
        }
        // Às vezes o MP devolve high_risk e o webhook confirma pago em seguida.
        for (let attempt = 0; attempt < 4; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          const check = await fetchCheckoutSession(sessionId);
          if (check.ok && check.payload?.paid) {
            goPaid();
            return;
          }
        }
        throw new Error(payload.error || "Não foi possível pagar com cartão.");
      }
      throw new Error(payload.error || "O pagamento não foi aprovado. Confira os dados ou tente Pix.");
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

  return (
    <div className="checkout-page">
      <PageHead title={paying ? "Pagamento" : "Seus dados"} />
      <input id="deviceId" type="hidden" readOnly tabIndex={-1} aria-hidden="true" />
      {challengeUrl ? (
        <div className="card-challenge" role="dialog" aria-modal="true" aria-label="Autenticação do cartão">
          <div className="card-challenge-panel">
            <h2>Confirme no banco</h2>
            <p className="hint">Seu banco pediu uma autenticação extra. Conclua na janela abaixo sem fechar esta tela.</p>
            <iframe title="Autenticação 3DS" src={challengeUrl} className="card-challenge-frame" allow="payment *" />
          </div>
        </div>
      ) : null}
      {busy && !challengeUrl ? (
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
              <p className="hint">Ao gerar o Pix, este pedido fica só no Pix. Cartão exige um novo pedido.</p>
            )
          ) : null}
          {method === "card" && !pixAlive ? (
            <>
              <label>
                E-mail do cartão
                <input
                  type="email"
                  autoComplete="email"
                  maxLength={120}
                  placeholder="seu@email.com"
                  value={cardEmail}
                  onChange={(event) => setCardEmail(event.target.value)}
                />
              </label>
              {!brickEmail ? (
                <p className="hint">Informe um e-mail real para liberar o cartão. No crédito o Mercado Pago usa isso na análise de segurança.</p>
              ) : null}
            </>
          ) : null}
          {method === "card" && !pixAlive && brickEmail && !cardReady ? <p className="hint">Carregando o cartão…</p> : null}
          <div id="mp-card-brick" className="pay-box" hidden={method !== "card" || pixAlive || !brickEmail} />
          {error ? <p className="form-error">{error}</p> : null}
          {pixAlive ? null : (
            <button
              type="button"
              className="primary"
              disabled={confirming || (method === "card" && (!cardReady || !brickEmail))}
              onClick={confirmPay}
            >
              <span>
                {confirming ? "Gerando…" : method === "pix" && pixCopy && !pixAlive ? "Gerar novo código Pix" : "Pagar"}
              </span>
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
