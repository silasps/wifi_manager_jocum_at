"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabase/client";

type SignupPayload = {
  nome: string;
  whatsApp: string;
  categoria: string;
  nacionalidade: string;
  tipo_plano: string;
  tempo: string;
  tempo_numero: number;
  email: string;
  senha: string;
  qtd_pessoas_ministerio: number;
  quota: number;
  valor: number;
  aceite_de_termo?: boolean;
  transicao_pgto?: string;
};

type AsaasPaymentLink = {
  id?: string;
  reference: string;
  url: string;
};

type PixData = {
  chargeId: string;
  qrCodeImage: string;
  copyPasteCode: string;
  reference: string;
};

type PaymentMethod = "PIX" | "CREDIT_CARD";

const paymentMethods: Array<{ label: string; value: PaymentMethod }> = [
  { label: "Pix", value: "PIX" },
  { label: "Cartão de crédito", value: "CREDIT_CARD" },
];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function createPaymentReference() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function PaymentPage() {
  const [payload, setPayload] = useState<SignupPayload | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("PIX");
  const [pixData, setPixData] = useState<PixData | null>(null);
  const [copied, setCopied] = useState(false);
  const [showCardForm, setShowCardForm] = useState(false);
  const [cardData, setCardData] = useState({ holderName: "", number: "", expiry: "", cvv: "", cpf: "" });

  const registerPendingAccess = async (signupPayload: SignupPayload, asaasPayment: AsaasPaymentLink) => {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: signupPayload.email.trim(),
      password: signupPayload.senha,
      options: {
        data: {
          nome: signupPayload.nome,
          categoria: signupPayload.categoria,
        },
      },
    });

    if (authError || !authData.user?.id) {
      setMessage("Não foi possível criar o acesso. Entre em contato com a equipe.");
      return false;
    }

    const userId = authData.user.id;

    const { error: clientError } = await supabase.from("clientes").insert({
      nome: signupPayload.nome,
      whatsApp: signupPayload.whatsApp,
      categoria: signupPayload.categoria,
      ativo: true,
      user_id: userId,
      tipo_plano: signupPayload.tipo_plano,
      tempo: signupPayload.tempo,
      email: signupPayload.email,
      aceite_de_termo: true,
      senha: signupPayload.senha,
    });

    if (clientError) {
      setMessage("O pagamento foi confirmado, mas não consegui finalizar o cadastro. Entre em contato com a equipe.");
      return false;
    }

    const { error: voucherError } = await supabase.from("vouchers").insert({
      cliente_id: userId,
      status: "pendente",
      tempo_desc: signupPayload.tempo,
      quota: signupPayload.quota,
      qtdObreiros: signupPayload.qtd_pessoas_ministerio || 3,
    });

    const { error: financeError } = await supabase.from("financas").insert({
      cliente_id: userId,
      plano_escolhido: signupPayload.tempo,
      comprovante_pgto: `${asaasPayment.reference} | ${asaasPayment.id || "asaas"} | ${asaasPayment.url}`,
      valor_pago: signupPayload.valor,
    });

    if (voucherError || financeError) {
      setMessage("Cadastro criado, mas houve falha ao registrar o voucher ou financeiro. Entre em contato com a equipe.");
      return false;
    }

    return true;
  };

  // Poll for PIX payment confirmation
  useEffect(() => {
    if (!pixData) return;

    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/asaas/pix/${pixData.chargeId}`);
        const data = (await res.json()) as { status?: string };
        if (cancelled) return;

        if (data.status === "RECEIVED" || data.status === "CONFIRMED") {
          const currentPayload = JSON.parse(sessionStorage.getItem("wf_signup") || "null") as SignupPayload | null;
          const storedAsaas = sessionStorage.getItem("wf_asaas");

          if (!currentPayload || !storedAsaas) {
            setMessage("Pagamento confirmado! Entre em contato com a equipe para ativar o acesso.");
            return;
          }

          const asaasData = JSON.parse(storedAsaas) as AsaasPaymentLink;
          const ok = await registerPendingAccess(currentPayload, asaasData);
          if (ok && !cancelled) {
            sessionStorage.removeItem("wf_signup");
            sessionStorage.removeItem("wf_asaas");
            setCompleted(true);
          }
        }
      } catch {
        // ignore transient polling errors
      }
    };

    const interval = setInterval(() => { void poll(); }, 5000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [pixData]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);

    if (params.get("asaas") === "success") {
      const storedSignup = sessionStorage.getItem("wf_signup");
      const storedAsaas = sessionStorage.getItem("wf_asaas");

      if (storedSignup && storedAsaas) {
        try {
          const signupData = JSON.parse(storedSignup) as SignupPayload;
          const asaasData = JSON.parse(storedAsaas) as AsaasPaymentLink;

          void registerPendingAccess(signupData, asaasData).then((ok) => {
            if (ok) {
              sessionStorage.removeItem("wf_signup");
              sessionStorage.removeItem("wf_asaas");
            }
          });
        } catch {
          sessionStorage.removeItem("wf_signup");
          sessionStorage.removeItem("wf_asaas");
        }
      }

      setCompleted(true);
      return;
    }

    const stored = sessionStorage.getItem("wf_signup");
    if (!stored) return;

    try {
      setPayload(JSON.parse(stored) as SignupPayload);
    } catch {
      sessionStorage.removeItem("wf_signup");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const ministryPeople = useMemo(() => {
    if (payload?.categoria !== "Ministério") return null;
    return payload.qtd_pessoas_ministerio || 3;
  }, [payload]);

  const copyPixCode = async () => {
    if (!pixData) return;
    try {
      await navigator.clipboard.writeText(pixData.copyPasteCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      // silently fail — user can select text manually
    }
  };

  const startAsaasPayment = async () => {
    if (!payload) {
      setMessage("Não encontrei um cadastro em andamento.");
      return;
    }

    if (!payload.aceite_de_termo) {
      window.location.href = "/termos-de-uso";
      return;
    }

    setLoading(true);
    setMessage(null);

    const reference = createPaymentReference();

    if (paymentMethod === "PIX") {
      const response = await fetch("/api/asaas/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference,
          nome: payload.nome,
          email: payload.email,
          whatsApp: payload.whatsApp,
          valor: payload.valor,
        }),
      });

      const data = (await response.json()) as {
        chargeId?: string;
        qrCodeImage?: string;
        copyPasteCode?: string;
        error?: string;
      };

      setLoading(false);

      if (!response.ok || !data.chargeId || !data.qrCodeImage || !data.copyPasteCode) {
        setMessage(data.error || "Não foi possível gerar o PIX. Tente novamente.");
        return;
      }

      sessionStorage.setItem(
        "wf_asaas",
        JSON.stringify({ id: data.chargeId, url: `pix:${data.chargeId}`, reference }),
      );

      setPixData({ chargeId: data.chargeId, qrCodeImage: data.qrCodeImage, copyPasteCode: data.copyPasteCode, reference });
      return;
    }

    // Credit Card — show inline form
    sessionStorage.setItem("wf_card_ref", reference);
    setCardData((d) => ({ ...d, holderName: payload.nome }));
    setLoading(false);
    setShowCardForm(true);
  };

  const submitCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payload) return;
    setLoading(true);
    setMessage(null);

    const reference = sessionStorage.getItem("wf_card_ref") || createPaymentReference();

    const response = await fetch("/api/asaas/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reference,
        nome: payload.nome,
        email: payload.email,
        whatsApp: payload.whatsApp,
        valor: payload.valor,
        cardNumber: cardData.number,
        cardHolderName: cardData.holderName,
        cardExpiry: cardData.expiry,
        cardCvv: cardData.cvv,
        cpf: cardData.cpf,
      }),
    });

    const data = (await response.json()) as { chargeId?: string; status?: string; error?: string };

    if (!response.ok || !data.chargeId) {
      setLoading(false);
      setMessage(data.error || "Não foi possível processar o cartão. Verifique os dados.");
      return;
    }

    const asaasData: AsaasPaymentLink = { id: data.chargeId, url: `card:${data.chargeId}`, reference };
    const ok = await registerPendingAccess(payload, asaasData);
    if (ok) {
      sessionStorage.removeItem("wf_signup");
      sessionStorage.removeItem("wf_card_ref");
      setCompleted(true);
    }
    setLoading(false);
  };

  if (completed) {
    return (
      <main className="payment-page">
        <section className="flow-shell success-shell" aria-label="Pagamento enviado">
          <div className="flow-card success-card motion-in">
            <img className="auth-logo" src="/brand/logo-at-symbol.png" alt="JOCUM AT" />
            <p className="eyebrow">Pagamento no Asaas</p>
            <h1>Seu pagamento foi recebido.</h1>
            <p className="form-intro">Obrigado. A equipe da Base Jocum AT vai conferir o registro e ativar o voucher.</p>
            {message && <p className="status-message">{message}</p>}
            <a className="primary-button as-link" href="/">
              Voltar ao início
            </a>
          </div>
        </section>
      </main>
    );
  }

  if (pixData) {
    return (
      <main className="payment-page">
        <section className="payment-shell" aria-label="Pagamento PIX">
          <div className="payment-brand">
            <button className="back-button" onClick={() => setPixData(null)} type="button" aria-label="Voltar">
              ‹
            </button>
            <img className="brand-logo" src="/brand/logo-jocum-almirante.png" alt="JOCUM Almirante Tamandaré AT" />
            <div>
              <p className="eyebrow">Pagamento PIX</p>
              <h1>Escaneie o QR Code para pagar.</h1>
            </div>
          </div>

          <div className="payment-stack">
            <section className="payment-card" aria-label="QR Code PIX" style={{ alignItems: "center", textAlign: "center" }}>
              <img
                src={`data:image/png;base64,${pixData.qrCodeImage}`}
                alt="QR Code PIX"
                style={{ width: 220, height: 220, display: "block", margin: "0 auto" }}
              />
              <p style={{ marginTop: 8, fontWeight: 600 }}>{payload ? money.format(payload.valor || 0) : ""}</p>
            </section>

            <section className="payment-card" aria-label="Código copia e cola">
              <p style={{ fontSize: 13, color: "var(--text-secondary, #666)", marginBottom: 8 }}>
                Ou use o código copia e cola:
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "stretch" }}>
                <input
                  readOnly
                  value={pixData.copyPasteCode}
                  style={{
                    flex: 1,
                    fontSize: 11,
                    fontFamily: "monospace",
                    padding: "8px 10px",
                    border: "1px solid var(--border, #ddd)",
                    borderRadius: 6,
                    background: "var(--surface-alt, #f5f5f5)",
                    minWidth: 0,
                  }}
                  onFocus={(e) => e.target.select()}
                />
                <button
                  className="primary-button"
                  onClick={copyPixCode}
                  type="button"
                  style={{ whiteSpace: "nowrap", flexShrink: 0 }}
                >
                  {copied ? "Copiado!" : "Copiar"}
                </button>
              </div>
            </section>

            <section className="payment-card" aria-label="Status do pagamento" style={{ textAlign: "center" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
                <span style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: "#f59e0b", animation: "pulse 1.5s infinite" }} />
                <span style={{ fontWeight: 500 }}>Aguardando confirmação do pagamento...</span>
              </div>
              <p className="tiny-note" style={{ marginTop: 8 }}>
                Não feche esta página. O cadastro é criado automaticamente assim que o pagamento for confirmado.
              </p>
            </section>

            {message && <p className="status-message">{message}</p>}
          </div>
        </section>
      </main>
    );
  }

  if (showCardForm) {
    const fmt4 = (v: string) => v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ");
    const fmtExp = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };
    const fmtCpf = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 11); if (d.length <= 3) return d; if (d.length <= 6) return `${d.slice(0,3)}.${d.slice(3)}`; if (d.length <= 9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`; return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`; };
    const set = (k: keyof typeof cardData) => (e: React.ChangeEvent<HTMLInputElement>) => setCardData((d) => ({ ...d, [k]: e.target.value }));

    return (
      <main className="payment-page">
        <section className="payment-shell" aria-label="Pagamento com cartão">
          <div className="payment-brand">
            <button className="back-button" onClick={() => setShowCardForm(false)} type="button" aria-label="Voltar">‹</button>
            <img className="brand-logo" src="/brand/logo-jocum-almirante.png" alt="JOCUM Almirante Tamandaré AT" />
            <div>
              <p className="eyebrow">Cartão de crédito</p>
              <h1>Informe os dados do cartão.</h1>
            </div>
          </div>

          <div className="payment-stack">
            {payload && (
              <section className="payment-card package-card" aria-label="Resumo do pacote">
                <div>
                  <p>Resumo do pacote</p>
                  <strong>{payload.categoria}</strong>
                  <span>{payload.tempo} · {payload.tipo_plano}</span>
                  {ministryPeople && <span>{ministryPeople} obreiros</span>}
                </div>
                <div className="amount-box">
                  <span>Valor</span>
                  <strong>{money.format(payload.valor || 0)}</strong>
                </div>
              </section>
            )}

            <section className="payment-card">
              <form className="form-stack" onSubmit={submitCard}>
                <label>
                  Nome no cartão
                  <input value={cardData.holderName} onChange={set("holderName")} autoComplete="cc-name" required />
                </label>
                <label>
                  Número do cartão
                  <input value={cardData.number} onChange={(e) => setCardData((d) => ({ ...d, number: fmt4(e.target.value) }))} inputMode="numeric" placeholder="0000 0000 0000 0000" autoComplete="cc-number" required />
                </label>
                <div className="phone-row">
                  <label>
                    Validade
                    <input value={cardData.expiry} onChange={(e) => setCardData((d) => ({ ...d, expiry: fmtExp(e.target.value) }))} inputMode="numeric" placeholder="MM/AA" autoComplete="cc-exp" required />
                  </label>
                  <label>
                    CVV
                    <input value={cardData.cvv} onChange={set("cvv")} inputMode="numeric" maxLength={4} placeholder="000" autoComplete="cc-csc" required />
                  </label>
                </div>
                <label>
                  CPF do titular
                  <input value={cardData.cpf} onChange={(e) => setCardData((d) => ({ ...d, cpf: fmtCpf(e.target.value) }))} inputMode="numeric" placeholder="000.000.000-00" required />
                </label>
                {message && <p className="status-message">{message}</p>}
                <button className="primary-button" type="submit" disabled={loading}>
                  {loading ? "Processando..." : `Pagar ${payload ? money.format(payload.valor || 0) : ""}`}
                </button>
              </form>
            </section>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="payment-page">
      <section className="payment-shell" aria-label="Área de pagamento">
        <div className="payment-brand">
          <a className="back-button" href="/termos-de-uso" aria-label="Voltar">
            ‹
          </a>
          <img className="brand-logo" src="/brand/logo-jocum-almirante.png" alt="JOCUM Almirante Tamandaré AT" />
          <div>
            <p className="eyebrow">Área de Pagamento</p>
            <h1>Finalize seu acesso ao Wi-Fi da Base.</h1>
          </div>
        </div>

        <div className="payment-stack">
          {payload ? (
            <>
              <section className="payment-card package-card" aria-label="Resumo do pacote">
                <div>
                  <p>Resumo do pacote</p>
                  <strong>{payload.categoria}</strong>
                  <span>
                    {payload.tempo} · {payload.tipo_plano}
                  </span>
                  {ministryPeople && <span>{ministryPeople} obreiros</span>}
                </div>
                <div className="amount-box">
                  <span>Valor</span>
                  <strong>{money.format(payload.valor || 0)}</strong>
                </div>
              </section>

              <section className="payment-card" aria-label="Pagamento pelo Asaas">
                <div className="section-heading">
                  <p>Dados para pagamento</p>
                  <strong>Asaas</strong>
                </div>

                <div className="asaas-options" aria-label="Formas de pagamento disponíveis">
                  {paymentMethods.map((method) => (
                    <button
                      aria-pressed={paymentMethod === method.value}
                      className={paymentMethod === method.value ? "active" : ""}
                      key={method.value}
                      onClick={() => setPaymentMethod(method.value)}
                      type="button"
                    >
                      {method.label}
                    </button>
                  ))}
                </div>

              </section>

              {message && <p className="status-message">{message}</p>}

              <button className="primary-button finish-button" disabled={loading} onClick={startAsaasPayment} type="button">
                {loading ? "Gerando PIX..." : "Pagar"}
              </button>
            </>
          ) : (
            <section className="payment-card">
              <p className="status-message">Não encontrei um cadastro em andamento.</p>
              <a className="secondary-link" href="/">
                Voltar ao início
              </a>
            </section>
          )}
        </div>
      </section>
    </main>
  );
}
