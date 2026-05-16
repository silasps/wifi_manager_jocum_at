"use client";

import { useMemo, useState } from "react";
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
const plans: Plan[] = ["Diário", "Mensal", "Anual"];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function timeLabel(plan: Plan, amount: string) {
  const value = Number(amount || 1);
  if (plan === "Diário") return value === 1 ? "1 dia" : `${value} dias`;
  if (plan === "Anual") return value === 1 ? "1 ano" : `${value} anos`;
  return value === 1 ? "1 mês" : `${value} meses`;
}

function planPrice(category: Category, plan: Plan, amount: string, people: string) {
  const tempo = Math.max(0, Number(amount || 0));
  const quantidadeObreiros = Math.max(0, Number(people || 0));
  const extras = Math.max(0, quantidadeObreiros - 3);
  let original = 0;
  let final = 0;

  if (!category || !plan || !tempo) return { original, final, discount: 0 };

  if (plan === "Diário") {
    original = tempo * 4;
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
  const [message, setMessage] = useState<string | null>(null);

  const amount = signup.time || "1";
  const packageReady = Boolean(signup.category && signup.plan && signup.time);
  const price = useMemo(
    () => planPrice(signup.category, signup.plan, amount, signup.ministryPeople),
    [signup.category, signup.plan, amount, signup.ministryPeople],
  );
  const checklist = [
    { label: "Categoria", done: Boolean(signup.category) },
    { label: "Tipo de cobrança", done: Boolean(signup.plan) },
    { label: "Tempo", done: Boolean(signup.time) },
  ];

  const updateSignup = (field: keyof typeof signup, value: string | boolean) => {
    setSignup((current) => {
      const next = { ...current, [field]: value };
      if (field === "category") {
        next.name = "";
        next.ministryPeople = "";
      }
      if (field === "plan") next.time = "";
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
      [!signup.plan, "Escolha o tipo de cobrança."],
      [!signup.time, "Defina o tempo de uso."],
      [!isValidEmail(signup.email.trim()), "Informe um email válido."],
      [!signup.password, "Defina uma senha."],
      [signup.password !== signup.confirmPassword, "As senhas precisam ser iguais."],
    ];
    const invalid = validations.find(([failed]) => failed);

    if (invalid) {
      setMessage(String(invalid[1]));
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
                    {showLoginPassword ? "Ocultar" : "Mostrar"}
                  </button>
                </span>
              </label>
              <button className="primary-button" type="submit" disabled={loading}>
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
                  Pessoas que vão utilizar o Wi-Fi
                  <input value={signup.ministryPeople} onChange={(event) => updateSignup("ministryPeople", onlyDigits(event.target.value).slice(0, 3))} inputMode="numeric" required />
                </label>
              )}

              <label>
                Tipo de cobrança
                <select value={signup.plan} onChange={(event) => updateSignup("plan", event.target.value as Plan)} required>
                  <option value="">Selecione</option>
                  {plans.map((plan) => (
                    <option key={plan}>{plan}</option>
                  ))}
                </select>
              </label>

              <label>
                {signup.plan === "Diário" ? "Quantos dias?" : signup.plan === "Anual" ? "Quantos anos?" : "Quantos meses?"}
                <input value={signup.time} onChange={(event) => updateSignup("time", onlyDigits(event.target.value).slice(0, 3))} inputMode="numeric" required />
              </label>

              <label>
                Email
                <input value={signup.email} onChange={(event) => updateSignup("email", event.target.value)} type="email" autoComplete="email" required />
              </label>

              <label>
                Senha
                <span className="password-field">
                  <input value={signup.password} onChange={(event) => updateSignup("password", event.target.value)} type={showSignupPassword ? "text" : "password"} autoComplete="new-password" required />
                  <button type="button" onClick={() => setShowSignupPassword((value) => !value)} aria-label={showSignupPassword ? "Ocultar senha" : "Mostrar senha"}>
                    {showSignupPassword ? "Ocultar" : "Mostrar"}
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
                    {showConfirmPassword ? "Ocultar" : "Mostrar"}
                  </button>
                </span>
              </label>

              <button className="primary-button" type="submit" disabled={loading}>
                {loading ? "Validando..." : "Seguinte"}
              </button>
            </form>
          )}

          {message && <p className="status-message">{message}</p>}
        </div>

        {tab === "signup" && (
          <aside className="package-summary" aria-label="Resumo do pacote">
            <div>
              <p>Resumo do plano</p>
              <ul>
                {checklist.map((item) => (
                  <li className={item.done ? "done" : ""} key={item.label}>
                    <span>{item.done ? "✓" : "○"}</span>
                    {item.done ? item.label : `Selecione ${item.label.toLowerCase()}`}
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
                  <small>{signup.category} · {timeLabel(signup.plan, amount)}</small>
                </>
              ) : (
                <>
                  <strong>--</strong>
                  <span>Complete os itens para ver o valor</span>
                </>
              )}
            </div>
          </aside>
        )}
      </section>
    </main>
  );
}
