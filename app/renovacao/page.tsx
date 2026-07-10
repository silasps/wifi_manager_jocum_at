"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabase/client";

type Category = "Obreiro" | "Aluno" | "Casal" | "Ministério" | "";
type Plan = "Diário" | "Quinzenal" | "Mensal" | "Anual" | "";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const categories: Category[] = ["Obreiro", "Aluno", "Casal", "Ministério"];
const accessPlans: Array<{ value: Exclude<Plan, "">; title: string; description: string; unit: string }> = [
  { value: "Diário", title: "Por dias", description: "Para visitas curtas, até 14 dias", unit: "dias" },
  { value: "Quinzenal", title: "15 dias", description: "Pacote fechado para quem fica ~2 semanas", unit: "dias" },
  { value: "Mensal", title: "Por meses", description: "Para uma temporada na base", unit: "meses" },
  { value: "Anual", title: "Por anos", description: "Para acesso de longo prazo", unit: "anos" },
];

function timeLabel(plan: Plan, amount: string) {
  const value = Number(amount || 1);
  if (plan === "Diário") return value === 1 ? "1 dia" : `${value} dias`;
  if (plan === "Quinzenal") return "15 dias";
  if (plan === "Anual") return value === 1 ? "1 ano" : `${value} anos`;
  return value === 1 ? "1 mês" : `${value} meses`;
}

function durationLabel(plan: Plan) {
  if (plan === "Diário") return "Quantos dias de acesso?";
  if (plan === "Quinzenal") return "Duração fixa";
  if (plan === "Anual") return "Quantos anos de acesso?";
  if (plan === "Mensal") return "Quantos meses de acesso?";
  return "Duração do acesso";
}

function durationUnit(plan: Plan, value?: string) {
  const n = Number(value || 0);
  if (plan === "Diário") return n === 1 ? "dia" : "dias";
  if (plan === "Quinzenal") return "dias";
  if (plan === "Mensal") return n === 1 ? "mês" : "meses";
  if (plan === "Anual") return n === 1 ? "ano" : "anos";
  return "tempo";
}

function dailyUnitValue(category: Category) {
  return category === "Casal" ? 5 : 3;
}

// Preço fechado dos 15 dias — sempre menor que o mensal da mesma categoria (mensal - R$10).
function quinzenalPrice(category: Category) {
  if (category === "Casal" || category === "Ministério") return 40;
  if (category === "Aluno") return 25;
  return 20;
}

function planDiscountHint(category: Category, plan: Plan, amount: string) {
  const tempo = Number(amount || 0);
  if (plan === "Diário") return "até 14 dias";
  if (plan === "Quinzenal") {
    const full = 15 * dailyUnitValue(category);
    const price = quinzenalPrice(category);
    const pct = full > 0 ? Math.round((1 - price / full) * 100) : 0;
    return pct > 0 ? `economize ${pct}%` : "";
  }
  if (plan === "Anual") return category === "Ministério" ? "25% off na base" : "10% off";
  if (plan !== "Mensal") return "";
  if (category === "Ministério") {
    if (!tempo) return "20% off a partir de 3 meses";
    if (tempo >= 12) return "25% off na base";
    if (tempo >= 3) return "20% off na base";
    return "20% off a partir de 3 meses";
  }
  if (category === "Casal") {
    if (!tempo) return "10% off a partir de 3 meses";
    if (tempo === 3) return "pacote com desconto";
    if (tempo > 3) return "10% off";
    return "10% off a partir de 3 meses";
  }
  if (category === "Aluno" || category === "Obreiro") {
    if (!tempo) return "10% off a partir de 3 meses";
    if (tempo === 3) return "R$ 10 off";
    if (tempo > 3) return "10% off";
    return "10% off a partir de 3 meses";
  }
  return category ? "10% off a partir de 3 meses" : "Selecione categoria";
}

function planUnitValue(category: Category, plan: Plan) {
  if (plan === "Diário") return `${money.format(dailyUnitValue(category))} / dia`;
  if (plan === "Quinzenal") return `${money.format(quinzenalPrice(category) / 15)} / dia`;
  if (plan === "Anual") {
    if (category === "Ministério") return `${money.format(50 * 12 * 0.75)} / ano base`;
    if (category === "Aluno") return `${money.format(35 * 12 * 0.9)} / ano`;
    if (category === "Casal") return `${money.format(50 * 12 * 0.9)} / ano`;
    return `${money.format(30 * 12 * 0.9)} / ano`;
  }
  if (category === "Aluno") return `${money.format(35)} / mês`;
  if (category === "Casal" || category === "Ministério") return `${money.format(50)} / mês`;
  return `${money.format(30)} / mês`;
}

function planPrice(category: Category, plan: Plan, amount: string, people: string) {
  const tempo = Math.max(0, Number(amount || 0));
  const quantidadeObreiros = Math.max(0, Number(people || 0));
  const extras = Math.max(0, quantidadeObreiros - 3);
  let original = 0;
  let final = 0;
  let extrasAmount = 0;

  if (!category || !plan) return { original, final, discount: 0, extras: 0, extrasAmount: 0 };

  if (plan === "Quinzenal") {
    original = 15 * dailyUnitValue(category);
    final = quinzenalPrice(category);
    return { original, final, discount: Math.max(0, original - final), extras: 0, extrasAmount: 0 };
  }

  if (!tempo) return { original, final, discount: 0, extras: 0, extrasAmount: 0 };

  if (plan === "Diário") {
    original = tempo * dailyUnitValue(category);
    final = original;
  } else if (plan === "Mensal") {
    if (category === "Aluno") original = tempo * 35;
    if (category === "Obreiro") original = tempo * 30;
    if (category === "Casal") original = tempo * 50;
    if (category === "Ministério") original = tempo * 50 + extras * 15 * tempo;
    final = original;
    if (category === "Aluno" || category === "Obreiro") final = tempo === 3 ? original - 10 : tempo > 3 ? original * 0.9 : original;
    if (category === "Casal") final = tempo === 3 ? 135 : tempo > 3 ? original * 0.9 : original;
    if (category === "Ministério") {
      const base = tempo * 50;
      const baseComDesconto = tempo >= 12 ? base * 0.75 : tempo >= 3 ? base * 0.8 : base;
      extrasAmount = extras * 15 * tempo;
      final = baseComDesconto + extrasAmount;
    }
  } else if (plan === "Anual") {
    if (category === "Aluno") original = 35 * 12 * tempo;
    if (category === "Obreiro") original = 30 * 12 * tempo;
    if (category === "Casal") original = 50 * 12 * tempo;
    if (category === "Ministério") original = 50 * 12 * tempo + extras * 15 * 12 * tempo;
    final = original;
    if (category === "Aluno" || category === "Obreiro" || category === "Casal") final = original * 0.9;
    if (category === "Ministério") {
      extrasAmount = extras * 15 * 12 * tempo;
      final = 50 * 12 * tempo * 0.75 + extrasAmount;
    }
  }

  return { original, final, discount: Math.max(0, original - final), extras, extrasAmount };
}

export default function RenovacaoPage() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [whatsApp, setWhatsApp] = useState("");
  const [categoria, setCategoria] = useState<Category>("");
  const [plan, setPlan] = useState<Plan>("");
  const [time, setTime] = useState("");
  const [ministryPeople, setMinistryPeople] = useState("");

  useEffect(() => {
    async function load() {
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) {
        window.location.href = "/";
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        window.location.href = "/";
        return;
      }

      const [profileRes, { data: voucher }] = await Promise.all([
        fetch("/api/user/profile", { headers: { Authorization: `Bearer ${token}` } }),
        supabase
          .from("vouchers")
          .select("qtdObreiros")
          .eq("cliente_id", user.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!profileRes.ok) {
        const err = (await profileRes.json()) as { error?: string };
        setMessage(`Não foi possível carregar seus dados: ${err.error ?? profileRes.status}. Entre em contato com a equipe.`);
        setLoading(false);
        return;
      }

      const cliente = (await profileRes.json()) as { nome?: string | null; categoria?: string | null; email?: string | null; whatsApp?: string | null };
      setNome(cliente.nome || "");
      setEmail(cliente.email || "");
      setWhatsApp(cliente.whatsApp || "");
      const initialCategoria = (cliente.categoria as Category) || "Obreiro";
      setCategoria(initialCategoria);

      if (initialCategoria === "Ministério") {
        const v = voucher as { qtdObreiros?: number | null } | null;
        setMinistryPeople(String(Math.max(3, v?.qtdObreiros || 3)));
      }

      setLoading(false);
    }
    void load();
  }, []);

  const amount = time || "1";
  const packageReady = Boolean(categoria && plan && time);
  const price = useMemo(
    () => planPrice(categoria, plan, amount, ministryPeople),
    [categoria, plan, amount, ministryPeople],
  );

  const handleNext = () => {
    if (!plan) { setMessage("Escolha o tempo de acesso."); return; }
    if (!time) { setMessage("Informe a duração."); return; }
    if (plan === "Diário" && Number(time) < 2) { setMessage("O plano diário aceita no mínimo 2 dias."); return; }
    if (plan === "Diário" && Number(time) > 14) { setMessage("O plano diário vale até 14 dias — para mais tempo, use o pacote de 15 dias."); return; }
    if (categoria === "Ministério" && !ministryPeople) { setMessage("Informe a quantidade de pessoas."); return; }

    sessionStorage.setItem("wf_signup", JSON.stringify({
      nome,
      categoria: categoria || "Obreiro",
      whatsApp,
      nacionalidade: "",
      tipo_plano: plan || "Mensal",
      tempo: timeLabel(plan, amount),
      tempo_numero: Number(amount),
      email,
      senha: "",
      qtd_pessoas_ministerio: Number(ministryPeople || 0),
      quota: 0,
      valor: price.final,
      aceite_de_termo: true,
      transicao_pgto: "renovacao",
    }));

    window.location.href = "/pagamento";
  };

  if (loading) {
    return (
      <main className="payment-page">
        <div className="home-loading" role="status">Carregando...</div>
      </main>
    );
  }

  return (
    <main className="payment-page">
      <section className="payment-shell" aria-label="Renovação de acesso">
        <div className="payment-brand">
          <a className="back-button" href="/home" aria-label="Voltar">‹</a>
          <img className="brand-logo" src="/brand/logo-jocum-almirante.png" alt="JOCUM Almirante Tamandaré AT" />
          <div>
            <p className="eyebrow">Renovação de Acesso</p>
            <h1>Renove seu pacote de Wi-Fi.</h1>
          </div>
        </div>

        <div className="payment-stack">
          <section className="payment-card form-stack">
            <label>
              Nome
              <input value={nome} readOnly disabled aria-readonly="true" />
            </label>

            <label>
              Categoria
              <select
                value={categoria}
                onChange={(e) => {
                  const value = e.target.value as Category;
                  setCategoria(value);
                  setMinistryPeople(value === "Ministério" ? (ministryPeople || "3") : "");
                }}
              >
                {categories.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>

            {categoria === "Ministério" && (
              <label>
                Quantas pessoas vão utilizar o Wi-Fi
                <span className="people-stepper">
                  <button
                    type="button"
                    onClick={() => setMinistryPeople(String(Math.max(3, Number(ministryPeople || 3) - 1)))}
                    disabled={Number(ministryPeople || 3) <= 3}
                    aria-label="Diminuir quantidade de pessoas"
                  >
                    −
                  </button>
                  <strong>{ministryPeople || "3"}</strong>
                  <button
                    type="button"
                    onClick={() => setMinistryPeople(String(Math.min(999, Number(ministryPeople || 3) + 1)))}
                    aria-label="Aumentar quantidade de pessoas"
                  >
                    +
                  </button>
                </span>
                <small className="field-hint">
                  O valor base já inclui até 3 pessoas. Cada pessoa a mais soma <strong>+R$15</strong> nos planos mensal e anual — não se aplica aos planos Diário e 15 dias.
                </small>
              </label>
            )}
          </section>

          <section className="payment-card">
            <fieldset className="access-period">
              <legend>Tempo de acesso desejado</legend>
              <div className="billing-options" role="radiogroup" aria-label="Tempo de acesso desejado">
                {accessPlans.map((p) => {
                  const hint = planDiscountHint(categoria, p.value, time);
                  return (
                    <button
                      type="button"
                      role="radio"
                      aria-checked={plan === p.value}
                      className={plan === p.value ? "plan-option selected" : "plan-option"}
                      key={p.value}
                      onClick={() => {
                        setPlan(p.value);
                        setTime(p.value === "Diário" ? "2" : p.value === "Quinzenal" ? "15" : "1");
                      }}
                    >
                      {hint && <em className="discount-badge">{hint}</em>}
                      <strong>{p.title}</strong>
                      <small className="unit-price">{planUnitValue(categoria, p.value)}</small>
                      <span>{p.description}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <label style={{ marginTop: 16 }}>
              {durationLabel(plan)}
              <span className="duration-input">
                <input
                  value={time}
                  onChange={(e) => setTime(e.target.value.replace(/\D/g, "").slice(0, 3))}
                  onBlur={() => {
                    if (plan === "Diário" && Number(time) < 2) setTime("2");
                    if (plan === "Diário" && Number(time) > 14) setTime("14");
                  }}
                  inputMode="numeric"
                  min={plan === "Diário" ? 2 : 1}
                  max={plan === "Diário" ? 14 : undefined}
                  disabled={!plan || plan === "Quinzenal"}
                />
                <span>{durationUnit(plan, time)}</span>
              </span>
            </label>
          </section>

          <aside className="package-summary" aria-label="Resumo do pacote">
            <div>
              <p>Resumo do plano</p>
              <ul>
                <li className={categoria ? "done" : ""}><span>{categoria ? "✓" : "○"}</span>{categoria || "Selecione categoria"}</li>
                <li className={plan ? "done" : ""}><span>{plan ? "✓" : "○"}</span>{plan || "Escolha o tempo de acesso"}</li>
                <li className={time ? "done" : ""}><span>{time ? "✓" : "○"}</span>{time ? timeLabel(plan, amount) : "Informe a duração"}</li>
              </ul>
              {packageReady && price.extrasAmount > 0 && (
                <p className="extras-hint">
                  +{price.extras} obreiro{price.extras > 1 ? "s" : ""} além dos 3 inclusos · +{money.format(price.extrasAmount)}
                </p>
              )}
            </div>
            <div>
              {packageReady ? (
                <>
                  {price.discount > 0 && <span className="old-price">{money.format(price.original)}</span>}
                  <strong>{money.format(price.final)}</strong>
                  <span>{price.discount > 0 ? `Desconto de ${money.format(price.discount)}` : "Sem desconto neste plano"}</span>
                  <small>{categoria} · {timeLabel(plan, amount)}</small>
                </>
              ) : (
                <>
                  <strong>--</strong>
                  <span>Complete os itens para ver o valor</span>
                </>
              )}
            </div>
          </aside>

          {message && <p className="status-message">{message}</p>}

          <button className="primary-button finish-button" onClick={handleNext} type="button">
            Seguinte
          </button>
        </div>
      </section>
    </main>
  );
}
