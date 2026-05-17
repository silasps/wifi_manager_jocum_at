"use client";

import { useMemo, useRef, useState } from "react";
import { supabase } from "../utils/supabase/client";

type Tab = "login" | "signup";
type Category = "Obreiro" | "Aluno" | "Casal" | "Ministério" | "";
type Plan = "Diário" | "Mensal" | "Anual" | "";
type DdiOption = {
  code: string;
  flag: string;
  country: string;
  maxDigits: number;
  groups: number[];
};

const ddiOptions: DdiOption[] = [
  { code: "+55", flag: "🇧🇷", country: "Brasil", maxDigits: 11, groups: [2, 1, 4, 4] },
  { code: "+1", flag: "🇺🇸", country: "EUA/Canadá", maxDigits: 10, groups: [3, 3, 4] },
  { code: "+27", flag: "🇿🇦", country: "África do Sul", maxDigits: 9, groups: [2, 3, 4] },
  { code: "+351", flag: "🇵🇹", country: "Portugal", maxDigits: 9, groups: [3, 3, 3] },
  { code: "+51", flag: "🇵🇪", country: "Peru", maxDigits: 9, groups: [3, 3, 3] },
  { code: "+52", flag: "🇲🇽", country: "México", maxDigits: 10, groups: [2, 4, 4] },
  { code: "+53", flag: "🇨🇺", country: "Cuba", maxDigits: 8, groups: [4, 4] },
  { code: "+54", flag: "🇦🇷", country: "Argentina", maxDigits: 10, groups: [2, 4, 4] },
  { code: "+56", flag: "🇨🇱", country: "Chile", maxDigits: 9, groups: [1, 4, 4] },
  { code: "+57", flag: "🇨🇴", country: "Colômbia", maxDigits: 10, groups: [3, 3, 4] },
  { code: "+58", flag: "🇻🇪", country: "Venezuela", maxDigits: 10, groups: [3, 3, 4] },
  { code: "+591", flag: "🇧🇴", country: "Bolívia", maxDigits: 8, groups: [4, 4] },
  { code: "+593", flag: "🇪🇨", country: "Equador", maxDigits: 9, groups: [2, 3, 4] },
  { code: "+595", flag: "🇵🇾", country: "Paraguai", maxDigits: 9, groups: [3, 3, 3] },
  { code: "+597", flag: "🇸🇷", country: "Suriname", maxDigits: 7, groups: [3, 4] },
  { code: "+598", flag: "🇺🇾", country: "Uruguai", maxDigits: 8, groups: [4, 4] },
];
const categories: Category[] = ["Obreiro", "Aluno", "Casal", "Ministério"];
const accessPlans: Array<{ value: Exclude<Plan, "">; title: string; description: string; unit: string }> = [
  { value: "Diário", title: "Por dias", description: "Para visitas e períodos curtos", unit: "dias" },
  { value: "Mensal", title: "Por meses", description: "Para uma temporada na base", unit: "meses" },
  { value: "Anual", title: "Por anos", description: "Para acesso de longo prazo", unit: "anos" },
];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function timeLabel(plan: Plan, amount: string) {
  const value = Number(amount || 1);
  if (plan === "Diário") return value === 1 ? "1 dia" : `${value} dias`;
  if (plan === "Anual") return value === 1 ? "1 ano" : `${value} anos`;
  return value === 1 ? "1 mês" : `${value} meses`;
}

function durationLabel(plan: Plan) {
  if (plan === "Diário") return "Quantos dias de acesso?";
  if (plan === "Anual") return "Quantos anos de acesso?";
  if (plan === "Mensal") return "Quantos meses de acesso?";
  return "Duração do acesso";
}

function durationUnit(plan: Plan, value?: string) {
  const n = Number(value || 0);
  if (plan === "Diário") return n === 1 ? "dia" : "dias";
  if (plan === "Mensal") return n === 1 ? "mês" : "meses";
  if (plan === "Anual") return n === 1 ? "ano" : "anos";
  return "tempo";
}

function dailyUnitValue(category: Category) {
  return category === "Casal" ? 5 : 3;
}

function dailySeasonPrice(days: number, category: Category) {
  const full = days * dailyUnitValue(category);
  if (days >= 20) return Math.min(full, 50);
  if (days >= 15) return Math.min(full, 40);
  return full;
}

function planDiscountHint(category: Category, plan: Plan, amount: string) {
  const tempo = Number(amount || 0);

  if (plan === "Diário") {
    if (!tempo) return "desconto a partir de 15 dias";
    if (tempo >= 20) return "curta temporada R$ 50";
    if (tempo >= 15) return "curta temporada R$ 40";
    return "desconto a partir de 15 dias";
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

  if (!category || !plan || !tempo) return { original, final, discount: 0 };

  if (plan === "Diário") {
    original = tempo * dailyUnitValue(category);
    final = dailySeasonPrice(tempo, category);
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
      final = baseComDesconto + extras * 15 * tempo;
    }
  } else if (plan === "Anual") {
    if (category === "Aluno") original = 35 * 12 * tempo;
    if (category === "Obreiro") original = 30 * 12 * tempo;
    if (category === "Casal") original = 50 * 12 * tempo;
    if (category === "Ministério") original = 50 * 12 * tempo + extras * 15 * 12 * tempo;

    final = original;
    if (category === "Aluno" || category === "Obreiro" || category === "Casal") final = original * 0.9;
    if (category === "Ministério") final = 50 * 12 * tempo * 0.75 + extras * 15 * 12 * tempo;
  }

  return { original, final, discount: Math.max(0, original - final) };
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function formatGroupedPhone(value: string, ddi: string) {
  const option = ddiOptions.find((item) => item.code === ddi) ?? ddiOptions[0];
  const digits = onlyDigits(value).slice(0, option.maxDigits);

  if (option.code === "+55") {
    if (digits.length <= 2) return digits;
    if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`;
  }

  const groups: string[] = [];
  let cursor = 0;
  option.groups.forEach((size) => {
    const chunk = digits.slice(cursor, cursor + size);
    if (chunk) groups.push(chunk);
    cursor += size;
  });
  return groups.join(" ");
}

function PasswordVisibilityIcon({ visible }: { visible: boolean }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
      <circle cx="12" cy="12" r="3" />
      {!visible && <path d="M4 4l16 16" />}
    </svg>
  );
}

function PlanSummary({
  amount,
  category,
  checklist,
  packageReady,
  plan,
  price,
}: {
  amount: string;
  category: Category;
  checklist: Array<{ label: string; pending: string; done: boolean }>;
  packageReady: boolean;
  plan: Plan;
  price: { original: number; final: number; discount: number };
}) {
  return (
    <aside className="package-summary" aria-label="Resumo do pacote">
      <div>
        <p>Resumo do plano</p>
        <ul>
          {checklist.map((item) => (
            <li className={item.done ? "done" : ""} key={item.label}>
              <span>{item.done ? "✓" : "○"}</span>
              {item.done ? item.label : item.pending}
            </li>
          ))}
        </ul>
      </div>
      <div>
        {packageReady ? (
          <>
            {price.discount > 0 && <span className="old-price">{money.format(price.original)}</span>}
            <strong>{money.format(price.final)}</strong>
            <span>{price.discount > 0 ? `Desconto de ${money.format(price.discount)}` : "Sem desconto neste plano"}</span>
            <small>{category} · {timeLabel(plan, amount)}</small>
          </>
        ) : (
          <>
            <strong>--</strong>
            <span>Complete os itens para ver o valor</span>
          </>
        )}
      </div>
    </aside>
  );
}

export default function Home() {
  const [tab, setTab] = useState<Tab>("login");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [signup, setSignup] = useState({
    ddi: "+55",
    phone: "",
    category: "" as Category,
    name: "",
    ministryPeople: "",
    plan: "" as Plan,
    time: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [emailChecking, setEmailChecking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const signupEmailRef = useRef<HTMLInputElement>(null);

  const amount = signup.time || "1";
  const packageReady = Boolean(signup.category && signup.plan && signup.time);
  const price = useMemo(
    () => planPrice(signup.category, signup.plan, amount, signup.ministryPeople),
    [signup.category, signup.plan, amount, signup.ministryPeople],
  );
  const checklist = [
    { label: "Categoria", pending: "Selecione categoria", done: Boolean(signup.category) },
    { label: "Tempo de acesso", pending: "Escolha o tempo de acesso", done: Boolean(signup.plan) },
    { label: "Duração", pending: "Informe a duração", done: Boolean(signup.time) },
  ];

  const updateSignup = (field: keyof typeof signup, value: string | boolean) => {
    setSignup((current) => {
      const next = { ...current, [field]: value };
      if (field === "category") {
        next.name = "";
        next.ministryPeople = "";
      }
      if (field === "plan") next.time = value === "Diário" ? "2" : "1";
      return next;
    });
  };

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });

    setLoading(false);
    if (error) {
      setMessage("Não foi possível entrar. Confira seu email e senha.");
      return;
    }

    window.location.href = "/home";
  };

  const handleResetPassword = async () => {
    if (!loginEmail.trim()) {
      setMessage("Digite seu email antes de recuperar a senha.");
      return;
    }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(loginEmail.trim(), {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);
    setMessage(error ? "Não foi possível enviar a recuperação agora." : "Enviamos as instruções para o seu email.");
  };

  const focusSignupEmail = () => window.setTimeout(() => signupEmailRef.current?.focus(), 0);

  const validateSignupEmail = async (showAlert = true) => {
    const email = signup.email.trim();
    if (!email) return false;

    if (!isValidEmail(email)) {
      setMessage("Informe um email válido.");
      if (showAlert) window.alert("Email inválido. Ajuste o email para continuar.");
      focusSignupEmail();
      return false;
    }

    setEmailChecking(true);
    let result: { valid?: boolean; reason?: string } = {};
    let ok = false;
    try {
      const response = await fetch(`/api/validate-email?email=${encodeURIComponent(email)}`);
      result = (await response.json()) as { valid?: boolean; reason?: string };
      ok = response.ok;
    } catch {
      result.reason = "Não foi possível validar o email agora.";
    } finally {
      setEmailChecking(false);
    }

    if (!ok || !result.valid) {
      const text = result.reason ?? "Email inválido ou domínio sem recebimento de email.";
      setMessage(text);
      if (showAlert) window.alert(text);
      focusSignupEmail();
      return false;
    }

    return true;
  };

  const handleSignup = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    const phone = `${signup.ddi}${onlyDigits(signup.phone)}`;
    const validations = [
      [!signup.category, "Escolha uma categoria."],
      [!signup.name.trim(), "Informe o nome para o cadastro."],
      [signup.category === "Ministério" && !signup.ministryPeople, "Informe quantas pessoas usarão o acesso."],
      [!onlyDigits(signup.phone), "Informe um telefone."],
      [!signup.plan, "Escolha o tempo de acesso desejado."],
      [!signup.time, "Informe a duração do acesso."],
      [signup.plan === "Diário" && Number(signup.time) < 2, "O plano diário aceita no mínimo 2 dias."],
      [!isValidEmail(signup.email.trim()), "Informe um email válido."],
      [!signup.password, "Defina uma senha."],
      [signup.password !== signup.confirmPassword, "As senhas precisam ser iguais."],
    ];
    const invalid = validations.find(([failed]) => failed);

    if (invalid) {
      setMessage(String(invalid[1]));
      if (invalid[1] === "Informe um email válido.") {
        window.alert("Email inválido. Ajuste o email para continuar.");
        focusSignupEmail();
      }
      setLoading(false);
      return;
    }

    if (!(await validateSignupEmail(false))) {
      window.alert("Email inválido. Ajuste o email para continuar.");
      setLoading(false);
      return;
    }

    const { data, error } = await supabase
      .from("clientes")
      .select("email")
      .eq("email", signup.email.trim())
      .maybeSingle();

    if (error) {
      setMessage("Não foi possível validar o email agora.");
      setLoading(false);
      return;
    }

    if (data?.email) {
      setMessage("Este email já está cadastrado.");
      setLoading(false);
      return;
    }

    const payload = {
      nome: signup.name.trim(),
      categoria: signup.category || "Obreiro",
      whatsApp: phone,
      nacionalidade: signup.ddi === "+55" ? "Brasileiro" : "Estrangeiro",
      tipo_plano: signup.plan || "Mensal",
      tempo: timeLabel(signup.plan, amount),
      tempo_numero: Number(amount),
      email: signup.email.trim(),
      senha: signup.password,
      qtd_pessoas_ministerio: Number(signup.ministryPeople || 0),
      quota: signup.category === "Ministério" ? Number(signup.ministryPeople || 1) * 5 : 5,
      valor: price.final,
      aceite_de_termo: false,
      transicao_pgto: "cadastro",
    };

    sessionStorage.setItem("wf_signup", JSON.stringify(payload));
    window.location.href = "/termos-de-uso";
  };

  return (
    <main className="login-page">
      <section className="auth-shell" aria-label="Acesso ao Wi-Fi da base">
        <div className="brand-panel">
          <div>
            <img className="brand-logo" src="/brand/logo-jocum-almirante.png" alt="JOCUM Almirante Tamandaré AT" />
            <p className="eyebrow">Wi-Fi da Base</p>
            <p className="brand-copy">Acesse, contribua e mantenha sua conexão ativa com poucos passos.</p>
          </div>
        </div>

        <div className="auth-card">
          <img className="auth-logo" src="/brand/logo-at-symbol.png" alt="JOCUM AT" />
          <div className="tabs" role="tablist" aria-label="Entrar ou cadastrar">
            <button className={tab === "login" ? "active" : ""} onClick={() => setTab("login")} type="button">
              Entrar
            </button>
            <button className={tab === "signup" ? "active" : ""} onClick={() => setTab("signup")} type="button">
              Cadastrar
            </button>
          </div>

          {tab === "login" ? (
            <form className="form-stack motion-in" onSubmit={handleLogin}>
              <p className="form-intro">Preencha os dados abaixo para ter acesso.</p>
              <label>
                Email
                <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} type="email" autoComplete="email" required />
              </label>
              <label>
                Senha
                <span className="password-field">
                  <input
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    type={showLoginPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                  />
                  <button type="button" onClick={() => setShowLoginPassword((value) => !value)} aria-label={showLoginPassword ? "Ocultar senha" : "Mostrar senha"}>
                    <PasswordVisibilityIcon visible={showLoginPassword} />
                  </button>
                </span>
              </label>
              <button className="primary-button" type="submit" disabled={loading || emailChecking}>
                {loading ? "Entrando..." : "Entrar"}
              </button>
              <button className="link-button" type="button" onClick={handleResetPassword} disabled={loading}>
                Esqueceu sua senha?
              </button>
            </form>
          ) : (
            <form className="form-stack motion-in" onSubmit={handleSignup}>
              <p className="form-intro">Defina como você quer contribuir para manter a estrutura de internet da base.</p>

              <div className="phone-row">
                <label>
                  DDI
                  <select
                    className="ddi-select"
                    value={signup.ddi}
                    onChange={(event) => {
                      updateSignup("ddi", event.target.value);
                      updateSignup("phone", formatGroupedPhone(signup.phone, event.target.value));
                    }}
                  >
                    {ddiOptions.map((ddi) => (
                      <option key={ddi.code} value={ddi.code}>
                        {ddi.flag} {ddi.code} {ddi.country}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Celular
                  <input
                    value={signup.phone}
                    onChange={(event) => updateSignup("phone", formatGroupedPhone(event.target.value, signup.ddi))}
                    inputMode="numeric"
                    autoComplete="tel"
                    required
                  />
                </label>
              </div>

              <label>
                Categoria
                <select value={signup.category} onChange={(event) => updateSignup("category", event.target.value as Category)} required>
                  <option value="">Selecione</option>
                  {categories.map((category) => (
                    <option key={category}>{category}</option>
                  ))}
                </select>
              </label>

              {signup.category && (
                <label>
                  {signup.category === "Ministério" ? "Nome do Ministério" : signup.category === "Casal" ? "Nome da família" : "Nome completo"}
                  <input value={signup.name} onChange={(event) => updateSignup("name", event.target.value)} autoComplete="name" required />
                </label>
              )}

              {signup.category === "Ministério" && (
                <label>
                  Quantas pessoas vão utilizar o Wi-Fi
                  <input value={signup.ministryPeople} onChange={(event) => updateSignup("ministryPeople", onlyDigits(event.target.value).slice(0, 3))} inputMode="numeric" required />
                </label>
              )}

              <fieldset className="access-period">
                <legend>Tempo de acesso desejado</legend>
                <div className="billing-options" role="radiogroup" aria-label="Tempo de acesso desejado">
                  {accessPlans.map((plan) => {
                    const hint = planDiscountHint(signup.category, plan.value, signup.time);

                    return (
                      <button
                        type="button"
                        role="radio"
                        aria-checked={signup.plan === plan.value}
                        className={signup.plan === plan.value ? "plan-option selected" : "plan-option"}
                        key={plan.value}
                        onClick={() => updateSignup("plan", plan.value)}
                      >
                        {hint && <em className="discount-badge">{hint}</em>}
                        <strong>{plan.title}</strong>
                        <small className="unit-price">{planUnitValue(signup.category, plan.value)}</small>
                        <span>{plan.description}</span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <label>
                {durationLabel(signup.plan)}
                <span className="duration-input">
                  <input
                    value={signup.time}
                    onChange={(event) => updateSignup("time", onlyDigits(event.target.value).slice(0, 3))}
                    onBlur={() => {
                      if (signup.plan === "Diário" && Number(signup.time) < 2) updateSignup("time", "2");
                    }}
                    inputMode="numeric"
                    min={signup.plan === "Diário" ? 2 : 1}
                    disabled={!signup.plan}
                    required
                  />
                  <span>{durationUnit(signup.plan, signup.time)}</span>
                </span>
              </label>

              <PlanSummary amount={amount} category={signup.category} checklist={checklist} packageReady={packageReady} plan={signup.plan} price={price} />

              <div className="form-divider" role="separator">
                <span>Dados de acesso</span>
              </div>

              <label>
                Email
                <input
                  ref={signupEmailRef}
                  value={signup.email}
                  onBlur={() => {
                    if (signup.email.trim()) void validateSignupEmail();
                  }}
                  onChange={(event) => updateSignup("email", event.target.value)}
                  type="email"
                  autoComplete="email"
                  required
                />
              </label>

              <label>
                Senha
                <span className="password-field">
                  <input value={signup.password} onChange={(event) => updateSignup("password", event.target.value)} type={showSignupPassword ? "text" : "password"} autoComplete="new-password" required />
                  <button type="button" onClick={() => setShowSignupPassword((value) => !value)} aria-label={showSignupPassword ? "Ocultar senha" : "Mostrar senha"}>
                    <PasswordVisibilityIcon visible={showSignupPassword} />
                  </button>
                </span>
              </label>

              <label>
                Confirme senha
                <span className="password-field">
                  <input
                    value={signup.confirmPassword}
                    onChange={(event) => updateSignup("confirmPassword", event.target.value)}
                    type={showConfirmPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                  />
                  <button type="button" onClick={() => setShowConfirmPassword((value) => !value)} aria-label={showConfirmPassword ? "Ocultar senha" : "Mostrar senha"}>
                    <PasswordVisibilityIcon visible={showConfirmPassword} />
                  </button>
                </span>
              </label>

              <button className="primary-button" type="submit" disabled={loading || emailChecking}>
                {loading || emailChecking ? "Validando..." : "Seguinte"}
              </button>
            </form>
          )}

          {message && <p className="status-message">{message}</p>}
        </div>
      </section>
    </main>
  );
}
