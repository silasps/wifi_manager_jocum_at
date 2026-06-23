"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../utils/supabase/client";

// Armazena a sessão diretamente no localStorage para evitar chamada de rede ao supabase.co
// (o portal cativo bloqueia conexões diretas ao Supabase no browser)
function storeSupabaseSession(accessToken: string, refreshToken: string) {
  try {
    const [, payloadB64] = accessToken.split(".");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
    const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").hostname.split(".")[0];
    const session = {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: 3600,
      expires_at: (payload.exp as number) ?? Math.floor(Date.now() / 1000) + 3600,
      refresh_token: refreshToken,
      user: payload,
    };
    localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify(session));
  } catch { /* ignora */ }
}

type PortalState =
  | "loading"
  | "auto-connect"    // logado + voucher ativo → autoriza automaticamente
  | "connecting"      // aguardando Python processar a autorização
  | "success"         // autorizado
  | "auth-error"      // Python falhou ao autorizar
  | "pending-voucher" // logado + voucher pendente
  | "no-voucher"      // logado + sem voucher válido
  | "guest";          // não logado

// Sub-estados da tela de visitante
type GuestView = "plans" | "signup-free" | "signup-paid" | "save-guide" | "login";

function setCookie(name: string, value: string, maxAge = 3600) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
}

function getCookie(name: string): string | null {
  const match = document.cookie.split(";").find((c) => c.trim().startsWith(name + "="));
  return match ? decodeURIComponent(match.split("=")[1].trim()) : null;
}

function onlyDigits(v: string) { return v.replace(/\D/g, ""); }

type DdiOption = { code: string; flag: string; country: string; maxDigits: number; groups: number[] };

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

function formatPhone(v: string) {
  return formatGroupedPhone(v, "+55");
}

export default function HotspotPage() {
  const [state, setState] = useState<PortalState>("loading");
  const [mac, setMac] = useState("");
  const [redirectUrl, setRedirectUrl] = useState("http://connectivitycheck.gstatic.com/generate_204");
  const [userName, setUserName] = useState("");
  const [planoTipo, setPlanoTipo] = useState<"free" | "pago" | null>(null);
  const [authId, setAuthId] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(3);

  // Sub-estado da tela de visitante
  const [guestView, setGuestView] = useState<GuestView>("plans");
  const [selectedPlan, setSelectedPlan] = useState<"free" | "paid">("free");
  const [freePhone, setFreePhone] = useState("");
  const [freeDdi, setFreeDdi] = useState("+55");
  const [freeError, setFreeError] = useState<string | null>(null);
  const [freeLoading, setFreeLoading] = useState(false);
  const [showFreeModal, setShowFreeModal] = useState(false);

  // Formulário de cadastro inline
  const [regNome, setRegNome] = useState("");
  const [regWhats, setRegWhats] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirm, setRegConfirm] = useState("");
  const [regError, setRegError] = useState<string | null>(null);
  const [regLoading, setRegLoading] = useState(false);

  // Token em memória (fallback para quando localStorage é limpo pelo browser do portal cativo)
  const [sessionToken, setSessionToken] = useState<string | null>(null);

  // Formulário de login (usuários existentes)
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

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const macParam = params.get("id") ?? "";
    const urlParam = params.get("url") ?? "http://connectivitycheck.gstatic.com/generate_204";

    if (macParam) {
      setMac(macParam);
      setCookie("captive_mac", macParam);
      setCookie("captive_url", urlParam);
    } else {
      const savedMac = getCookie("captive_mac");
      const savedUrl = getCookie("captive_url");
      if (savedMac) setMac(savedMac);
      if (savedUrl) setRedirectUrl(savedUrl);
    }

    setRedirectUrl(urlParam || getCookie("captive_url") || "http://connectivitycheck.gstatic.com/generate_204");
    void checkAuth(macParam || getCookie("captive_mac") || "");
  }, []);

  async function checkAuth(currentMac: string, tokenOverride?: string) {
    let token = tokenOverride;
    if (!token) {
      const { data: { session } } = await supabase.auth.getSession();
      token = session?.access_token;
    }

    if (!token) { setState("guest"); return; }

    try {
      // Passa o MAC para o session endpoint criar a autorização server-side
      // (evita chamada extra do browser do portal cativo)
      const macParam = currentMac ? `?mac=${encodeURIComponent(currentMac)}` : "";
      const res = await fetch(`/api/hotspot/session${macParam}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { setState("guest"); return; }

      const data = await res.json() as {
        state: string;
        userName?: string;
        planoTipo?: "free" | "pago";
        auth_id?: string;
      };
      setUserName(data.userName ?? "");
      setPlanoTipo(data.planoTipo ?? null);

      if (data.state === "guest") { setState("guest"); return; }
      if (data.state === "has-voucher") {
        if (data.auth_id) {
          // Autorização criada server-side — só precisa fazer polling
          setState("connecting");
          setAuthId(data.auth_id);
        } else {
          // Fallback se MAC não foi passado
          setState("auto-connect");
          void startAuthorize(currentMac, token);
        }
        return;
      }
      if (data.state === "pending-voucher") { setState("pending-voucher"); return; }
      setState("no-voucher");
    } catch {
      setState("guest");
    }
  }

  async function startAuthorize(currentMac: string, tokenOverride?: string) {
    if (!currentMac) { setState("guest"); return; }
    setState("connecting");

    let token = tokenOverride;
    if (!token) {
      const { data: { session } } = await supabase.auth.getSession();
      token = session?.access_token;
    }
    if (!token) { setState("guest"); return; }

    try {
      const res = await fetch("/api/hotspot/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ mac: currentMac }),
      });
      const data = await res.json() as { status?: string; id?: string; error?: string };

      if (data.status === "autorizado") { setState("success"); return; }
      if (data.id) { setAuthId(data.id); return; }
      // Sem id e sem sucesso = erro do endpoint (403, 500, etc.)
      setAuthError(`HTTP ${res.status}: ${data.error ?? "sem detalhe"}`);
      setState("auth-error");
    } catch {
      setState("auto-connect");
    }
  }

  // Polling do authId
  useEffect(() => {
    if (!authId) return;
    let alive = true;
    const timeout = setTimeout(() => { if (alive) { alive = false; setState("auth-error"); } }, 120_000);
    const interval = setInterval(async () => {
      if (!alive) return;
      try {
        const res = await fetch(`/api/hotspot/authorize/${authId}`);
        if (!res.ok || !alive) return;
        const data = await res.json() as { status?: string };
        if (!alive) return;
        if (data.status === "autorizado") { clearInterval(interval); clearTimeout(timeout); setState("success"); }
        else if (data.status === "erro") { clearInterval(interval); clearTimeout(timeout); setState("auth-error"); }
      } catch { /* ignora transitório */ }
    }, 3000);
    return () => { alive = false; clearInterval(interval); clearTimeout(timeout); };
  }, [authId]);

  // Polling voucher pendente
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
        const data = await res.json() as { state: string; planoTipo?: "free" | "pago" };
        if (data.state === "has-voucher" && alive) {
          if (data.planoTipo) setPlanoTipo(data.planoTipo);
          setState("auto-connect");
          void startAuthorize(mac);
        }
      } catch { /* ignora */ }
    };
    const interval = setInterval(() => void poll(), 5000);
    return () => { alive = false; clearInterval(interval); };
  }, [state, mac]);

  // Countdown e redirect no sucesso
  useEffect(() => {
    if (state !== "success") return;
    if (countdown <= 0) {
      if (planoTipo !== "free") {
        document.cookie = "captive_mac=; Max-Age=0; Path=/; SameSite=Lax";
        document.cookie = "captive_url=; Max-Age=0; Path=/; SameSite=Lax";
      }
      window.location.href = "/hotspot/connected";
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
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

      storeSupabaseSession(data.access_token!, data.refresh_token!);
      setSessionToken(data.access_token!);
      setLoginLoading(false);
      // Não faz redirect (localStorage é limpo pelo browser do portal cativo no reload)
      await checkAuth(mac, data.access_token!);
    } catch {
      setLoginError("Erro de rede. Verifique sua conexão.");
      setLoginLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setRegError(null);

    if (!regNome.trim()) { setRegError("Informe seu nome."); return; }
    if (!regEmail.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(regEmail)) { setRegError("Email inválido."); return; }
    if (!regPassword) { setRegError("Defina uma senha."); return; }
    if (regPassword !== regConfirm) { setRegError("As senhas não conferem."); return; }

    setRegLoading(true);
    try {
      const res = await fetch("/api/hotspot/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: regNome.trim(),
          email: regEmail.trim(),
          password: regPassword,
          whatsApp: onlyDigits(regWhats) ? `+55${onlyDigits(regWhats)}` : "",
          plano: selectedPlan === "free" ? "free" : "pago",
        }),
      });
      const data = await res.json() as { access_token?: string; refresh_token?: string; plano?: string; error?: string; code?: string };

      if (!res.ok && res.status !== 207) {
        setRegError(data.error ?? "Erro ao criar conta. Tente novamente.");
        setRegLoading(false);
        return;
      }

      // Armazena sessão e guarda token em state (localStorage pode ser limpo no portal cativo)
      if (data.access_token && data.refresh_token) {
        storeSupabaseSession(data.access_token, data.refresh_token);
        setSessionToken(data.access_token);
      }

      setRegLoading(false);
      // Plano free: mostra guia de salvar a página

      // Plano gratuito: mostra guia de salvar a página
      setGuestView("save-guide");
    } catch {
      setRegError("Erro de rede. Tente novamente.");
      setRegLoading(false);
    }
  };

  const handleContinueAfterSave = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token ?? sessionToken ?? undefined;
    if (!token) { setState("guest"); return; }
    void checkAuth(mac, token);
  };

  const handleFreeAccess = async () => {
    const digits = onlyDigits(freePhone);
    const ddiOpt = ddiOptions.find((d) => d.code === freeDdi) ?? ddiOptions[0];
    if (digits.length < ddiOpt.maxDigits - 2) { setFreeError("Informe um WhatsApp válido."); return; }
    if (!mac) { setFreeError("MAC não disponível. Reconecte ao Wi-Fi."); return; }

    setFreeLoading(true);
    setFreeError(null);
    setPlanoTipo("free");

    try {
      const res = await fetch("/api/hotspot/free-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mac, telefone: freeDdi.replace("+", "") + digits }),
      });
      const data = await res.json() as { status?: string; auth_id?: string; error?: string };

      if (!res.ok) { setFreeError(data.error ?? "Erro ao conectar."); setFreeLoading(false); return; }

      if (data.status === "autorizado") { setState("success"); return; }
      if (data.status === "pending-voucher") { setState("pending-voucher"); startFreePolling(); return; }
      if (data.auth_id) { setAuthId(data.auth_id); setState("connecting"); return; }

      setFreeError("Resposta inesperada do servidor.");
      setFreeLoading(false);
    } catch {
      setFreeError("Erro de rede. Tente novamente.");
      setFreeLoading(false);
    }
  };

  const startFreePolling = () => {
    const poll = setInterval(async () => {
      try {
        const res = await fetch("/api/hotspot/free-access", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mac, telefone: freeDdi.replace("+", "") + onlyDigits(freePhone) }),
        });
        const data = await res.json() as { status?: string; auth_id?: string };
        if (data.auth_id) {
          clearInterval(poll);
          setAuthId(data.auth_id);
          setState("connecting");
        }
      } catch { /* ignora transitório */ }
    }, 5000);
    setTimeout(() => clearInterval(poll), 120_000);
  };

  // ── Loading ──
  if (state === "loading") {
    return (
      <main className="hotspot-page">
        <div className="hsp-center-card">
          <span className="voucher-pending-spinner" aria-hidden="true" />
        </div>
      </main>
    );
  }

  // ── Reconectando / Conectando ──
  if (state === "auto-connect" || state === "connecting") {
    return (
      <main className="hotspot-page">
        <div className="hsp-center-card">
          <img src="/brand/logo-at-symbol.png" alt="JOCUM AT" className="hsp-center-logo" style={{ filter: "brightness(0) invert(1)" }} />
          <span className="voucher-pending-spinner hsp-big-spinner" aria-hidden="true" />
          <p className="hsp-center-title">Reconectando à rede…</p>
          <p className="hsp-center-sub">Aguarde alguns instantes.</p>
        </div>
      </main>
    );
  }

  // ── Erro de autorização ──
  if (state === "auth-error") {
    return (
      <main className="hotspot-page">
        <div className="hsp-center-card">
          <img src="/brand/logo-at-symbol.png" alt="JOCUM AT" className="hsp-center-logo" style={{ filter: "brightness(0) invert(1)" }} />
          <div className="hsp-check-circle" style={{ borderColor: "#f87171", background: "rgba(248,113,113,0.1)", color: "#f87171" }} aria-hidden="true">✕</div>
          <p className="hsp-center-title">Não foi possível conectar</p>
          <p className="hsp-center-sub">Ocorreu um erro ao autorizar seu dispositivo. Tente novamente.</p>
          {authError && <p className="hsp-center-sub" style={{ fontSize: "0.7rem", opacity: 0.5, marginTop: 4 }}>{authError}</p>}
          <button type="button" className="hotspot-cta-primary" style={{ marginTop: 8 }} onClick={() => { setAuthId(null); void startAuthorize(mac); }}>
            Tentar novamente
          </button>
        </div>
      </main>
    );
  }

  // ── Sucesso ──
  if (state === "success") {
    return (
      <main className="hotspot-page">
        <div className="hsp-center-card hsp-success-card">
          <img src="/brand/logo-jocum-almirante.png" alt="JOCUM Almirante Tamandaré" className="hsp-success-logo" />
          <div className="hsp-check-circle" aria-hidden="true">✓</div>
          <h1 className="hsp-success-title">Você está conectado!</h1>
          <p className="hsp-success-text">Aproveite a estrutura de internet da Base JOCUM AT.</p>
          {planoTipo === "free" && (
            <div className="hsp-upgrade-banner" role="complementary" aria-label="Sugestão de upgrade">
              <p className="hsp-upgrade-title">Conectado ao Wi-Fi gratuito</p>
              <p className="hsp-upgrade-desc">Quer streaming, videochamadas e mais velocidade?</p>
              <a href="/?tab=signup&from=portal" className="hsp-upgrade-link">Fazer upgrade →</a>
            </div>
          )}
          <p className="hsp-success-countdown">Redirecionando em {countdown}s…</p>
        </div>
      </main>
    );
  }

  // ── Voucher pendente ──
  if (state === "pending-voucher") {
    return (
      <main className="hotspot-page">
        <div className="hsp-center-card">
          <img src="/brand/logo-at-symbol.png" alt="JOCUM AT" className="hsp-center-logo" style={{ filter: "brightness(0) invert(1)" }} />
          <span className="voucher-pending-spinner hsp-big-spinner" aria-hidden="true" />
          <p className="hsp-center-title">Preparando seu acesso…</p>
          <p className="hsp-center-sub">Isso leva menos de 1 minuto. Não feche esta tela.</p>
        </div>
      </main>
    );
  }

  // ── Sem voucher ──
  if (state === "no-voucher") {
    return (
      <main className="hotspot-page">
        <div className="hsp-center-card">
          <img src="/brand/logo-at-symbol.png" alt="JOCUM AT" className="hsp-center-logo" style={{ filter: "brightness(0) invert(1)" }} />
          <p className="hsp-center-title">{userName ? `Olá, ${userName}.` : "Acesso encerrado."}</p>
          <p className="hsp-center-sub">Seu acesso expirou.</p>
          <a href="/renovacao" className="hotspot-cta-primary" style={{ marginTop: 8 }}>Renovar ou fazer upgrade</a>
          <button
            type="button"
            className="hotspot-cta-secondary"
            style={{ marginTop: 8 }}
            onClick={async () => { await supabase.auth.signOut(); setState("guest"); setGuestView("plans"); }}
          >
            Sair
          </button>
        </div>
      </main>
    );
  }

  // ── Visitante ──

  // Sub-tela: Guia de salvar a página (após cadastro pago)
  if (state === "guest" && guestView === "save-guide") {
    return (
      <main className="hotspot-page">
        <div className="hsp-center-card">
          <img src="/brand/logo-at-symbol.png" alt="JOCUM AT" className="hsp-center-logo" style={{ filter: "brightness(0) invert(1)" }} />
          <div className="hsp-check-circle" style={{ borderColor: "#4ade80", background: "rgba(74,222,128,0.1)", color: "#4ade80" }} aria-hidden="true">✓</div>
          <p className="hsp-center-title">Conta criada!</p>
          <p className="hsp-center-sub">Seu acesso está sendo ativado.</p>

          <div className="hsp-save-guide" role="complementary" aria-label="Como salvar esta página">
            <p className="hsp-save-title">Salve esta página para acessos futuros</p>
            <p className="hsp-save-desc">Na próxima vez que se conectar ao Wi-Fi, você precisará fazer login. Salvar fica mais fácil:</p>
            <div className="hsp-save-steps">
              <div className="hsp-save-step">
                <span className="hsp-save-step-icon" aria-hidden="true">📱</span>
                <div>
                  <strong>iPhone (Safari)</strong>
                  <span>Toque em <em>□↑</em> → &quot;Adicionar à Tela de Início&quot;</span>
                </div>
              </div>
              <div className="hsp-save-step">
                <span className="hsp-save-step-icon" aria-hidden="true">🤖</span>
                <div>
                  <strong>Android (Chrome)</strong>
                  <span>Toque em <em>⋮</em> → &quot;Adicionar à tela inicial&quot;</span>
                </div>
              </div>
            </div>
            <p className="hsp-save-url">wifi-manager-react.vercel.app</p>
          </div>

          <button type="button" className="hotspot-cta-primary" style={{ marginTop: 4 }} onClick={() => void handleContinueAfterSave()}>
            Continuar e conectar
          </button>
        </div>
      </main>
    );
  }

  // Sub-tela: Formulário de cadastro (apenas para plano pago)
  if (state === "guest" && guestView === "signup-paid") {
    return (
      <main className="hotspot-page">
        <div className="hsp-signup-card">
          <button type="button" className="hsp-back-btn" onClick={() => { setGuestView("plans"); setRegError(null); }} aria-label="Voltar">
            ← Voltar
          </button>

          <img src="/brand/logo-at-symbol.png" alt="JOCUM AT" className="hsp-center-logo" style={{ filter: "brightness(0) invert(1)", margin: "0 auto 12px" }} />

          <p className="hsp-signup-title">Criar conta premium</p>
          <p className="hsp-signup-subtitle">
            Após o cadastro você escolhe seu plano e realiza o pagamento.
          </p>

          <form className="hsp-signup-form" onSubmit={handleRegister}>
            <input type="text" placeholder="Nome completo *" value={regNome} onChange={(e) => setRegNome(e.target.value)} autoComplete="name" className="hsp-login-input" required />
            <input type="tel" placeholder="WhatsApp *" value={regWhats} onChange={(e) => setRegWhats(formatPhone(e.target.value))} autoComplete="tel" inputMode="numeric" className="hsp-login-input" required />
            <input type="email" placeholder="Email *" value={regEmail} onChange={(e) => setRegEmail(e.target.value)} autoComplete="email" className="hsp-login-input" required />
            <input type="password" placeholder="Senha *" value={regPassword} onChange={(e) => setRegPassword(e.target.value)} autoComplete="new-password" className="hsp-login-input" required />
            <input type="password" placeholder="Confirmar senha *" value={regConfirm} onChange={(e) => setRegConfirm(e.target.value)} autoComplete="new-password" className="hsp-login-input" required />
            {regError && <p className="hsp-login-error">{regError}</p>}
            <button type="submit" className="hotspot-cta-primary" style={{ marginTop: 4 }} disabled={regLoading}>
              {regLoading ? "Criando conta…" : "Criar conta e escolher plano"}
            </button>
          </form>
        </div>

        <footer className="hotspot-footer">
          <span>JOCUM Almirante Tamandaré · Base de Missões</span>
        </footer>
      </main>
    );
  }

  // Sub-tela: Login (usuários existentes)
  if (state === "guest" && guestView === "login") {
    return (
      <main className="hotspot-page">
        <div className="hsp-signup-card">
          <button type="button" className="hsp-back-btn" onClick={() => { setGuestView("plans"); setLoginError(null); }} aria-label="Voltar">
            ← Voltar
          </button>

          <img src="/brand/logo-at-symbol.png" alt="JOCUM AT" className="hsp-center-logo" style={{ filter: "brightness(0) invert(1)", margin: "0 auto 12px" }} />

          <p className="hsp-signup-title">Entrar na sua conta</p>

          <form className="hsp-login-form" onSubmit={handleLogin}>
            <input type="email" placeholder="Email" value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} autoComplete="email" required className="hsp-login-input" />
            <input type="password" placeholder="Senha" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} autoComplete="current-password" required className="hsp-login-input" />
            {loginError && <p className="hsp-login-error">{loginError}</p>}
            <button type="submit" className="hotspot-cta-primary hsp-login-btn" disabled={loginLoading}>
              {loginLoading ? "Entrando…" : "Entrar"}
            </button>
            <button type="button" className="link-button" onClick={openRecoverModal} disabled={loginLoading}>
              Esqueceu sua senha?
            </button>
          </form>
        </div>

        <footer className="hotspot-footer">
          <span>JOCUM Almirante Tamandaré · Base de Missões</span>
        </footer>

        {recoverModal && (
          <div className="modal-overlay" onClick={() => setRecoverModal(false)}>
            <div className="modal-box" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Recuperar senha">
              <p className="modal-title">Recuperar senha</p>
              {!recoveredPassword ? (
                <form onSubmit={(e) => { e.preventDefault(); void fetchPassword(recoverEmail); }}>
                  <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.75rem" }}>
                    <span style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.6)" }}>Email do cadastro</span>
                    <input type="email" value={recoverEmail} onChange={(e) => setRecoverEmail(e.target.value)} autoComplete="email" required autoFocus={!recoverEmail} />
                  </label>
                  {recoverError && <p className="modal-copied-hint" style={{ color: "#fca5a5" }}>{recoverError}</p>}
                  <button className="primary-button" type="submit" disabled={recoverLoading}>{recoverLoading ? "Buscando..." : "Buscar senha"}</button>
                </form>
              ) : (
                <>
                  <div className="modal-password-row">
                    <span className="modal-password-value">{recoveredPassword}</span>
                    <button type="button" className="modal-copy-button" aria-label="Copiar senha" onClick={() => { void navigator.clipboard.writeText(recoveredPassword); setPasswordCopied(true); }}>
                      {passwordCopied
                        ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5" /></svg>
                        : <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
                      }
                    </button>
                  </div>
                  {passwordCopied && <p className="modal-copied-hint">Senha copiada!</p>}
                </>
              )}
              <button type="button" className="link-button" onClick={() => setRecoverModal(false)}>Fechar</button>
            </div>
          </div>
        )}
      </main>
    );
  }

  // Tela principal do visitante: Free vs Premium
  return (
    <main className="hotspot-page">
      <header className="hotspot-hero">
        <img src="/brand/logo-jocum-almirante.png" alt="JOCUM Almirante Tamandaré" className="hotspot-logo" />
        <h1 className="hotspot-title">Internet da Base</h1>
      </header>

      <section className="hsp-plan-choice" aria-label="Escolha de plano">
        <article className="hsp-plan-option hsp-plan-premium">
          <div className="hsp-plan-option-header">
            <span className="hsp-plan-badge hsp-plan-badge-premium">Recomendado</span>
          </div>
          <p className="hsp-plan-desc">Streaming, videochamadas e tudo mais sem limites</p>
          <ul className="hsp-plan-features">
            <li>YouTube e Netflix</li>
            <li>Instagram e TikTok</li>
            <li>Videochamadas</li>
            <li>A partir de R$30/mês</li>
          </ul>
          <button
            type="button"
            className="hotspot-cta-primary"
            style={{ fontSize: "0.9rem", minHeight: 48 }}
            onClick={() => { window.location.href = "/?tab=signup&from=portal"; }}
          >
            Ver planos premium
          </button>
        </article>

        <p className="hsp-plan-divider">ou use grátis</p>

        <article className="hsp-plan-option hsp-plan-free">
          <div className="hsp-plan-option-header">
            <span className="hsp-plan-badge hsp-plan-badge-free">Gratuito</span>
          </div>
          <p className="hsp-plan-desc">Apenas mensagens de texto, acesso bancário e email</p>
          <div className="phone-row">
            <select
              className="ddi-select"
              value={freeDdi}
              onChange={(e) => {
                setFreeDdi(e.target.value);
                setFreePhone(formatGroupedPhone(freePhone, e.target.value));
              }}
            >
              {ddiOptions.map((ddi) => (
                <option key={ddi.code} value={ddi.code}>
                  {ddi.flag} {ddi.code} {ddi.country}
                </option>
              ))}
            </select>
            <input
              type="tel"
              placeholder="Seu WhatsApp"
              value={freePhone}
              onChange={(e) => setFreePhone(formatGroupedPhone(e.target.value, freeDdi))}
              inputMode="numeric"
              autoComplete="tel"
            />
          </div>
          {freeError && <p className="hsp-login-error">{freeError}</p>}
          <button
            type="button"
            className="hotspot-cta-secondary"
            onClick={() => {
              setFreeError(null);
              const raw = freePhone.replace(/\D/g, "");
              if (raw.length < 10) { setFreeError("Informe um número válido com DDD."); return; }
              setShowFreeModal(true);
            }}
            disabled={freeLoading}
          >
            {freeLoading ? "Conectando…" : "Conectar grátis"}
          </button>
        </article>
      </section>

      {showFreeModal && (
        <div style={{
          position: "fixed", inset: 0, zIndex: 9999,
          background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center",
          padding: 20,
        }} onClick={() => setShowFreeModal(false)}>
          <div style={{
            background: "#1a1a1a", borderRadius: 16, padding: "28px 24px", maxWidth: 380, width: "100%",
            border: "1px solid rgba(255,255,255,0.08)",
          }} onClick={(e) => e.stopPropagation()}>
            <h2 style={{ color: "#fff", fontSize: "1.1rem", fontWeight: 700, margin: "0 0 12px", textAlign: "center" }}>
              Antes de continuar…
            </h2>
            <div style={{ color: "#a1a1aa", fontSize: "0.82rem", lineHeight: 1.6 }}>
              <p style={{ margin: "0 0 10px" }}>
                O acesso gratuito é <strong style={{ color: "#fbbf24" }}>bastante limitado</strong>. Você terá acesso apenas para:
              </p>
              <ul style={{ margin: "0 0 12px", paddingLeft: 18 }}>
                <li>Mensagens de texto (WhatsApp, Telegram)</li>
                <li>E-mail</li>
                <li>Acessos bancários básicos</li>
              </ul>
              <p style={{ margin: "0 0 14px", color: "#ef4444", fontWeight: 500, fontSize: "0.8rem" }}>
                Vídeos, redes sociais, chamadas de vídeo e streaming <strong>não vão funcionar</strong> nesta velocidade.
              </p>
              <p style={{ margin: 0, color: "#71717a", fontSize: "0.75rem", textAlign: "center" }}>
                Para uma experiência completa, considere um plano premium.
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
              <button
                type="button"
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)",
                  background: "transparent", color: "#a1a1aa", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
                }}
                onClick={() => setShowFreeModal(false)}
              >
                Voltar
              </button>
              <button
                type="button"
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 10, border: "none",
                  background: "#ef700b", color: "#fff", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
                }}
                onClick={() => { setShowFreeModal(false); void handleFreeAccess(); }}
              >
                Continuar mesmo assim
              </button>
            </div>
          </div>
        </div>
      )}

      <button type="button" className="link-button" style={{ marginTop: 4 }} onClick={() => { window.location.href = "/?tab=login&from=portal"; }}>
        Já tem conta? Fazer login
      </button>

      <div style={{
        background: "rgba(251,191,36,0.06)", border: "1px solid rgba(251,191,36,0.2)",
        borderRadius: 10, padding: "12px 16px", margin: "20px 24px 0",
        textAlign: "center", lineHeight: 1.5,
      }}>
        <p style={{ color: "#fbbf24", fontSize: "0.8rem", fontWeight: 600, margin: "0 0 4px" }}>
          Cobertura do sinal
        </p>
        <p style={{ color: "#a1a1aa", fontSize: "0.76rem", margin: 0 }}>
          O Wi-Fi cobre as áreas comuns e externas da base. O acesso dentro dos alojamentos não é garantido.
        </p>
      </div>

      <footer className="hotspot-footer">
        <span>JOCUM Almirante Tamandaré · Base de Missões</span>
        <a href="/termos-de-uso" className="hotspot-footer-link">Termos de Uso</a>
      </footer>
    </main>
  );
}
