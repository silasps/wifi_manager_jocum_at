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

type PaymentMethod = "PIX" | "BOLETO" | "CREDIT_CARD";

const paymentMethods: Array<{ label: string; value: PaymentMethod }> = [
  { label: "Pix", value: "PIX" },
  { label: "Boleto", value: "BOLETO" },
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("asaas") === "success") {
      sessionStorage.removeItem("wf_signup");
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
  }, []);

  const ministryPeople = useMemo(() => {
    if (payload?.categoria !== "Ministério") return null;
    return payload.qtd_pessoas_ministerio || 3;
  }, [payload]);

  const registerPendingAccess = async (asaasPayment: AsaasPaymentLink) => {
    if (!payload) {
      setMessage("Não encontrei um cadastro em andamento.");
      return false;
    }

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: payload.email.trim(),
      password: payload.senha,
      options: {
        data: {
          nome: payload.nome,
          categoria: payload.categoria,
        },
      },
    });

    if (authError || !authData.user?.id) {
      setMessage("Não foi possível criar o acesso. Confira o email e tente novamente.");
      return false;
    }

    const userId = authData.user.id;

    const { error: clientError } = await supabase.from("clientes").insert({
      nome: payload.nome,
      whatsApp: payload.whatsApp,
      categoria: payload.categoria,
      ativo: true,
      user_id: userId,
      tipo_plano: payload.tipo_plano,
      tempo: payload.tempo,
      email: payload.email,
      aceite_de_termo: true,
      senha: payload.senha,
    });

    if (clientError) {
      setMessage("O pagamento foi criado no Asaas, mas não consegui finalizar o cadastro.");
      return false;
    }

    const { error: voucherError } = await supabase.from("vouchers").insert({
      cliente_id: userId,
      status: "pendente",
      tempo_desc: payload.tempo,
      quota: payload.quota,
      qtdObreiros: payload.qtd_pessoas_ministerio || 3,
    });

    const { error: financeError } = await supabase.from("financas").insert({
      cliente_id: userId,
      plano_escolhido: payload.tempo,
      comprovante_pgto: `${asaasPayment.reference} | ${asaasPayment.id || "asaas"} | ${asaasPayment.url}`,
      valor_pago: payload.valor,
    });

    if (voucherError || financeError) {
      setMessage("Cadastro criado, mas houve falha ao registrar o voucher ou financeiro.");
      return false;
    }

    return true;
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
    const response = await fetch("/api/asaas/payment-link", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reference,
        nome: payload.nome,
        email: payload.email,
        whatsApp: payload.whatsApp,
        categoria: payload.categoria,
        tipo_plano: payload.tipo_plano,
        tempo: payload.tempo,
        valor: payload.valor,
        qtd_pessoas_ministerio: payload.qtd_pessoas_ministerio,
        paymentMethod,
      }),
    });

    const asaasPayment = (await response.json()) as Partial<AsaasPaymentLink> & { error?: string };

    if (!response.ok || !asaasPayment.url || !asaasPayment.reference) {
      setLoading(false);
      setMessage(asaasPayment.error || "Não foi possível iniciar o pagamento no Asaas.");
      return;
    }

    const registered = await registerPendingAccess(asaasPayment as AsaasPaymentLink);

    if (!registered) {
      setLoading(false);
      return;
    }

    sessionStorage.removeItem("wf_signup");
    setMessage("Tudo certo. Abrindo o pagamento seguro do Asaas...");
    window.location.href = asaasPayment.url;
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
            <a className="primary-button as-link" href="/">
              Voltar ao início
            </a>
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

                <p className="tiny-note">O pagamento abre no ambiente seguro do Asaas. O cadastro fica pendente até a confirmação.</p>
              </section>

              {message && <p className="status-message">{message}</p>}

              <button className="primary-button finish-button" disabled={loading} onClick={startAsaasPayment} type="button">
                {loading ? "Abrindo..." : "Pagar"}
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
