"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../utils/supabase/client";

type PortalState =
  | "loading"
  | "auto-connect"    // Tela A: logado + voucher ativo → autoriza automaticamente
  | "connecting"      // aguardando Python processar a autorização
  | "success"         // autorizado, exibindo tela de sucesso
  | "auth-error"      // Python falhou ao autorizar o MAC
  | "pending-voucher" // Tela B: logado + voucher pendente
  | "no-voucher"      // Tela C: logado + sem voucher válido
  | "guest";          // Tela D: não logado

type Voucher = { id?: string; status?: string; data_expiracao?: string | null };

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

const plans = [
  { category: "Obreiro", monthly: 30, daily: 3, description: "Individual" },
  { category: "Aluno", monthly: 35, daily: 3, description: "Escola" },
  { category: "Casal", monthly: 50, daily: 5, description: "2 pessoas", highlight: true },
  { category: "Ministério", monthly: 50, daily: null, description: "Equipes", note: "+ R$ 15/pessoa acima de 3" },
];

function setCookie(name: string, value: string, maxAge = 3600) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function getCookie(name: string): string | null {
  const match = document.cookie.split(";").find((c) => c.trim().startsWith(name + "="));
  return match ? decodeURIComponent(match.split("=")[1].trim()) : null;
}

export default function HotspotPage() {
  const [state, setState] = useState<PortalState>("loading");
  const [mac, setMac] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("http://connectivitycheck.gstatic.com/generate_204");
  const [userName, setUserName] = useState("");
  const [authId, setAuthId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);

  // Login form state (Tela D)
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  // Recuperar senha
  const [recoverModal, setRecoverModal] = useState(false);
  const [recoverEmail, setRecoverEmail] = useState("");
  const [recoverLoading, setRecoverLoading] = useState(false);
  const [recoverError, setRecoverError] = useState<string | null>(null);
  const [recoveredPassword, setRecoveredPassword] = useState<string | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);

  // Lê params da URL, salva cookies e verifica sessão
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const macParam = params.get("id") ?? "";
    const urlParam = params.get("url") ?? "http://connectivitycheck.gstatic.com/generate_204";

    if (macParam) {
      setMac(macParam);
      setCookie("captive_mac", macParam);
      setCookie("captive_url", urlParam);
    } else {
      // Tenta recuperar do cookie (caso recarregue sem params)
      const savedMac = getCookie("captive_mac");
      const savedUrl = getCookie("captive_url");
      if (savedMac) setMac(savedMac);
      if (savedUrl) setRedirectUrl(savedUrl);
    }

    setRedirectUrl(urlParam || getCookie("captive_url") || "http://connectivitycheck.gstatic.com/generate_204");

    void checkAuth(macParam || getCookie("captive_mac") || "");
  }, []);

  async function checkAuth(currentMac: string) {
    // getSession lê do localStorage sem fazer chamada de rede — funciona no portal cativo
    const { data: { session } } = await supabase.auth.getSession();

    if (!session) {
      setState("guest");
      return;
    }

    try {
      // Proxy server-side: o Vercel tem internet, o dispositivo no portal cativo não tem
      const res = await fetch("/api/hotspot/session", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (!res.ok) { setState("guest"); return; }

      const data = await res.json() as { state: string; userName?: string };
      setUserName(data.userName ?? "");

      if (data.state === "guest") { setState("guest"); return; }
      if (data.state === "has-voucher") {
        setState("auto-connect");
        void startAuthorize(currentMac);
        return;
      }
      if (data.state === "pending-voucher") { setState("pending-voucher"); return; }
      setState("no-voucher");
    } catch {
      setState("guest");
    }
  }

  async function startAuthorize(currentMac: string) {
    if (!currentMac) { setState("guest"); return; }
    setState("connecting");

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setState("guest"); return; }

    try {
      const res = await fetch("/api/hotspot/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ mac: currentMac }),
      });
      const data = await res.json() as { status?: string; id?: string; error?: string };

      if (data.status === "autorizado") {
        setState("success");
        return;
      }
      if (data.id) {
        setAuthId(data.id);
      }
    } catch {
      setState("auto-connect");
    }
  }

  // Polling quando temos um authId pendente
  useEffect(() => {
    if (!authId) return;
    let alive = true;
    // Timeout de 2 minutos: se o agente Python na UDM estiver travado, mostra erro
    const timeout = setTimeout(() => {
      if (alive) { alive = false; setState("auth-error"); }
    }, 120_000);
    const interval = setInterval(async () => {
      if (!alive) return;
      try {
        const res = await fetch(`/api/hotspot/authorize/${authId}`);
        if (!res.ok || !alive) return;
        const data = await res.json() as { status?: string };
        if (!alive) return;
        if (data.status === "autorizado") {
          clearInterval(interval);
          clearTimeout(timeout);
          setState("success");
        } else if (data.status === "erro") {
          clearInterval(interval);
          clearTimeout(timeout);
          setState("auth-error");
        }
      } catch { /* ignora erro de rede transitório */ }
    }, 3000);
    return () => { alive = false; clearInterval(interval); clearTimeout(timeout); };
  }, [authId]);

  // Polling quando voucher está pendente (Tela B)
  useEffect(() => {
    if (state !== "pending-voucher") return;
    let alive = true;
    const poll = async () => {
      if (!alive) return;
      const { data: { session } } = await supabase.auth.getSession();
      if (!session || !alive) return;
      try {
        const res = await fetch("/api/hotspot/session", {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
        if (!res.ok || !alive) return;
        const data = await res.json() as { state: string };
        if (data.state === "has-voucher" && alive) {
          setState("auto-connect");
          void startAuthorize(mac);
        }
      } catch { /* ignora erro de rede no polling */ }
    };
    const interval = setInterval(() => void poll(), 5000);
    return () => { alive = false; clearInterval(interval); };
  }, [state, mac]);

  // Countdown na tela de sucesso → redireciona
  useEffect(() => {
    if (state !== "success") return;
    if (countdown <= 0) {
      const dest = getCookie("captive_url") || redirectUrl;
      document.cookie = "captive_mac=; Max-Age=0; Path=/; SameSite=Lax";
      document.cookie = "captive_url=; Max-Age=0; Path=/; SameSite=Lax";
      window.location.href = dest;
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [state, countdown, redirectUrl]);

  const openRecoverModal = () => {
    setRecoverEmail(loginEmail.trim());
    setRecoveredPassword(null);
    setRecoverError(null);
    setPasswordCopied(false);
    setRecoverModal(true);
    if (loginEmail.trim()) void fetchPassword(loginEmail.trim());
  };

  const fetchPassword = async (email: string) => {
    setRecoverLoading(true);
    setRecoverError(null);
    const response = await fetch(`/api/recover-password?email=${encodeURIComponent(email.trim())}`);
    const result = await response.json() as { senha?: string; error?: string };
    setRecoverLoading(false);
    if (!response.ok || !result.senha) {
      setRecoverError(result.error ?? "Não foi possível encontrar o cadastro.");
      return;
    }
    setRecoveredPassword(result.senha);
  };

  const closeRecoverModal = () => {
    setRecoverModal(false);
    setRecoveredPassword(null);
    setRecoverError(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      // Login via proxy server-side para funcionar no portal cativo (dispositivo sem internet)
      const res = await fetch("/api/hotspot/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: loginEmail.trim(), password: loginPassword }),
      });
      const data = await res.json() as { access_token?: string; refresh_token?: string; code?: string; error?: string };

      if (!res.ok) {
        setLoginError(data.code === "invalid_credentials" ? "Email ou senha incorretos." : "Erro ao conectar. Tente novamente.");
        setLoginLoading(false);
        return;
      }

      await supabase.auth.setSession({ access_token: data.access_token!, refresh_token: data.refresh_token! });
      setLoginLoading(false);
      const params = new URLSearchParams(window.location.search);
      window.location.href = `/hotspot?${params.toString()}`;
    } catch {
      setLoginError("Erro de rede. Verifique sua conexão.");
      setLoginLoading(false);
    }
  };

  // ── Tela de loading ──
  if (state === "loading") {
    return (
      <main className="hotspot-page">
        <div className="hsp-center-card">
          <span className="voucher-pending-spinner" aria-hidden="true" />
        </div>
      </main>
    );
  }

  // ── Tela A / connecting ──
  if (state === "auto-connect" || state === "connecting") {
    return (
      <main className="hotspot-page">
        <div className="hsp-center-card">
          <img src="/brand/logo-at-symbol.png" alt="JOCUM AT" className="hsp-center-logo" />
          <span className="voucher-pending-spinner hsp-big-spinner" aria-hidden="true" />
          <p className="hsp-center-title">Reconectando à rede…</p>
          <p className="hsp-center-sub">Aguarde alguns instantes.</p>
        </div>
      </main>
    );
  }

  // ── Tela de erro de autorização ──
  if (state === "auth-error") {
    return (
      <main className="hotspot-page">
        <div className="hsp-center-card">
          <img src="/brand/logo-at-symbol.png" alt="JOCUM AT" className="hsp-center-logo" />
          <div className="hsp-check-circle" style={{ borderColor: "#f87171", background: "rgba(248,113,113,0.1)", color: "#f87171" }} aria-hidden="true">✕</div>
          <p className="hsp-center-title">Não foi possível conectar</p>
          <p className="hsp-center-sub">Ocorreu um erro ao autorizar seu dispositivo. Tente novamente.</p>
          <button
            type="button"
            className="hotspot-cta-primary"
            style={{ marginTop: 8 }}
            onClick={() => { setAuthId(null); void startAuthorize(mac); }}
          >
            Tentar novamente
          </button>
        </div>
      </main>
    );
  }

  // ── Tela de sucesso ──
  if (state === "success") {
    return (
      <main className="hotspot-page">
        <div className="hsp-center-card hsp-success-card">
          <img src="/brand/logo-jocum-almirante.png" alt="JOCUM Almirante Tamandaré" className="hsp-success-logo" />
          <div className="hsp-check-circle" aria-hidden="true">✓</div>
          <h1 className="hsp-success-title">Você está conectado!</h1>
          <p className="hsp-success-text">Aproveite a estrutura de internet da Base JOCUM AT.</p>
          <p className="hsp-success-countdown">Redirecionando em {countdown}s…</p>
        </div>
      </main>
    );
  }

  // ── Tela B — voucher pendente ──
  if (state === "pending-voucher") {
    return (
      <main className="hotspot-page">
        <div className="hsp-center-card">
          <img src="/brand/logo-at-symbol.png" alt="JOCUM AT" className="hsp-center-logo" />
          <span className="voucher-pending-spinner hsp-big-spinner" aria-hidden="true" />
          <p className="hsp-center-title">Preparando seu acesso…</p>
          <p className="hsp-center-sub">Isso leva menos de 1 minuto. Não feche esta tela.</p>
        </div>
      </main>
    );
  }

  // ── Tela C — sem voucher ──
  if (state === "no-voucher") {
    return (
      <main className="hotspot-page">
        <div className="hsp-center-card">
          <img src="/brand/logo-at-symbol.png" alt="JOCUM AT" className="hsp-center-logo" />
          <p className="hsp-center-title">
            {userName ? `Olá, ${userName}.` : "Acesso encerrado."}
          </p>
          <p className="hsp-center-sub">Seu plano expirou ou não há voucher ativo.</p>
          <a href="/renovacao" className="hotspot-cta-primary" style={{ marginTop: 8 }}>Renovar plano</a>
          <button
            type="button"
            className="hotspot-cta-secondary"
            style={{ marginTop: 8 }}
            onClick={async () => { await supabase.auth.signOut(); setState("guest"); }}
          >
            Sair
          </button>
        </div>
      </main>
    );
  }

  // ── Tela D — visitante / não logado ──
  return (
    <main className="hotspot-page">
      <header className="hotspot-hero">
        <div className="hotspot-connected-badge" style={{ borderColor: "rgba(255,121,42,0.4)", background: "rgba(255,121,42,0.1)", color: "#ff792a" }}>
          Wi-Fi Gratuito
        </div>
        <img src="/brand/logo-jocum-almirante.png" alt="JOCUM Almirante Tamandaré" className="hotspot-logo" />
        <h1 className="hotspot-title">Internet gratuita da Base</h1>
        <p className="hotspot-subtitle">Contribua com a infraestrutura e tenha acesso completo sem limites.</p>
      </header>

      <section className="hotspot-speed-compare" aria-label="Comparação de velocidade">
        <div className="speed-col speed-free">
          <span className="speed-label">Rede gratuita</span>
          <strong className="speed-value">2 Mbps</strong>
          <span className="speed-desc">Navegação básica</span>
        </div>
        <div className="speed-divider" aria-hidden="true">VS</div>
        <div className="speed-col speed-premium">
          <span className="speed-label">Rede premium</span>
          <strong className="speed-value">30 Mbps</strong>
          <span className="speed-desc">Streaming, chamadas, tudo</span>
        </div>
      </section>

      <section className="hotspot-plans-section" aria-label="Planos">
        <p className="hotspot-section-label">Planos de contribuição</p>
        <div className="hotspot-plans-grid">
          {plans.map((plan) => (
            <article key={plan.category} className={`hotspot-plan-card${plan.highlight ? " hotspot-plan-popular" : ""}`}>
              {plan.highlight && <span className="hotspot-popular-badge">Popular</span>}
              <strong className="hotspot-plan-name">{plan.category}</strong>
              <p className="hotspot-plan-desc">{plan.description}</p>
              <div className="hotspot-plan-price-block">
                <span className="hotspot-price-value">{money.format(plan.monthly)}</span>
                <span className="hotspot-price-period">/mês</span>
              </div>
              {plan.daily !== null && plan.daily !== undefined && (
                <span className="hotspot-price-secondary">ou {money.format(plan.daily)}/dia</span>
              )}
              {plan.note && <span className="hotspot-price-secondary">{plan.note}</span>}
            </article>
          ))}
        </div>
        <div className="hotspot-discounts-row">
          <span>10% off a partir de 3 meses</span>
          <span aria-hidden="true">·</span>
          <span>Diário: máx. R$ 50 para 20+ dias</span>
        </div>
      </section>

      <a href={`/?tab=signup`} className="hotspot-cta-primary">Quero acesso completo</a>

      <section className="hsp-login-section" aria-label="Já tenho cadastro">
        <p className="hsp-login-label">Já tenho cadastro</p>
        <form className="hsp-login-form" onSubmit={handleLogin}>
          <input
            type="email"
            placeholder="Email"
            value={loginEmail}
            onChange={(e) => setLoginEmail(e.target.value)}
            autoComplete="email"
            required
            className="hsp-login-input"
          />
          <input
            type="password"
            placeholder="Senha"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            autoComplete="current-password"
            required
            className="hsp-login-input"
          />
          {loginError && <p className="hsp-login-error">{loginError}</p>}
          <button type="submit" className="hotspot-cta-secondary hsp-login-btn" disabled={loginLoading}>
            {loginLoading ? "Entrando…" : "Entrar"}
          </button>
          <button type="button" className="link-button" onClick={openRecoverModal} disabled={loginLoading}>
            Esqueceu sua senha?
          </button>
        </form>
      </section>

      <footer className="hotspot-footer">
        <span>JOCUM Almirante Tamandaré · Base de Missões</span>
        <a href="/termos-de-uso" className="hotspot-footer-link">Termos de Uso</a>
      </footer>

      {recoverModal && (
        <div className="modal-overlay" onClick={closeRecoverModal}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Recuperar senha">
            <p className="modal-title">Recuperar senha</p>

            {!recoveredPassword ? (
              <form onSubmit={(e) => { e.preventDefault(); void fetchPassword(recoverEmail); }}>
                <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
                  <span style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)" }}>Email do cadastro</span>
                  <input
                    type="email"
                    value={recoverEmail}
                    onChange={(e) => setRecoverEmail(e.target.value)}
                    autoComplete="email"
                    required
                    autoFocus={!recoverEmail}
                  />
                </label>
                {recoverError && <p className="modal-copied-hint" style={{ color: "#fca5a5" }}>{recoverError}</p>}
                <button className="primary-button" type="submit" disabled={recoverLoading}>
                  {recoverLoading ? "Buscando..." : "Buscar senha"}
                </button>
              </form>
            ) : (
              <>
                <div className="modal-password-row">
                  <span className="modal-password-value">{recoveredPassword}</span>
                  <button
                    type="button"
                    className="modal-copy-button"
                    aria-label="Copiar senha"
                    onClick={() => { void navigator.clipboard.writeText(recoveredPassword); setPasswordCopied(true); }}
                  >
                    {passwordCopied ? (
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
                    ) : (
                      <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                    )}
                  </button>
                </div>
                {passwordCopied && <p className="modal-copied-hint">Senha copiada!</p>}
              </>
            )}

            <button type="button" className="link-button" onClick={closeRecoverModal}>Fechar</button>
          </div>
        </div>
      )}
    </main>
  );
}
