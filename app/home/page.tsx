"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../utils/supabase/client";

function getCookie(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.split(";").find((c) => c.trim().startsWith(name + "="));
  return match ? decodeURIComponent(match.split("=")[1].trim()) : null;
}

function deleteCookie(name: string) {
  document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax`;
}

type Cliente = {
  nome?: string | null;
  categoria?: string | null;
  papel?: string | null;
};

type Voucher = {
  id?: string | null;
  codigo?: string | null;
  status?: string | null;
  data_expiracao?: string | null;
  qtdObreiros?: number | null;
  qtd_obreiros?: number | null;
  usos?: string | number | null;
};

type VoucherStatus = "Vencido" | "2 dias" | "Em dia" | "Sem voucher";

const twoDays = 172800000;

function firstName(name?: string | null) {
  return name?.trim().split(/\s+/)[0] || "querido(a)";
}

function parseDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(value?: string | null, compact = false) {
  const date = parseDate(value);
  if (!date) return compact ? "XX/XX/XX" : "XX/XX XX:XX";

  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: compact ? "2-digit" : undefined,
    hour: compact ? undefined : "2-digit",
    minute: compact ? undefined : "2-digit",
  }).format(date);
}

function getVoucherStatus(voucher?: Voucher | null): VoucherStatus {
  const expiration = parseDate(voucher?.data_expiracao)?.getTime();
  if (!expiration) return "Sem voucher";

  const now = Date.now();
  if (expiration <= now) return "Vencido";
  if (expiration <= now + twoDays) return "2 dias";
  return "Em dia";
}

function getVoucherRowStatus(voucher: Voucher): { color: "green" | "yellow" | "red" | "pending"; label: string } {
  if (voucher.status === "pendente") return { color: "pending", label: "Ativando" };
  const expiration = parseDate(voucher.data_expiracao)?.getTime();
  if (!expiration) return { color: "red", label: "Sem data" };
  const now = Date.now();
  if (expiration <= now) return { color: "red", label: "Vencido" };
  if (expiration <= now + twoDays) return { color: "yellow", label: "Vencendo" };
  return { color: "green", label: "Ativo" };
}

export default function HomePage() {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [role, setRole] = useState("user");
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [alertOpen, setAlertOpen] = useState(false);
  const [openTipIndex, setOpenTipIndex] = useState<number | null>(null);
  const [copiedCode, setCopiedCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [activatedVoucher, setActivatedVoucher] = useState<Voucher | null>(null);
  const [captiveMac, setCaptiveMac] = useState<string | null>(null);
  const [captiveUrl, setCaptiveUrl] = useState<string>("http://www.google.com");
  const [captiveConnecting, setCaptiveConnecting] = useState(false);
  const [captiveError, setCaptiveError] = useState(false);
  const [captiveCountdown, setCaptiveCountdown] = useState(30);
  const seenPendingIds = useRef<Set<string>>(new Set());

  const currentVoucher = vouchers[0] ?? null;
  const voucherStatus = useMemo(() => getVoucherStatus(currentVoucher), [currentVoucher]);
  const ministryPeople = currentVoucher?.qtdObreiros ?? currentVoucher?.qtd_obreiros ?? 3;
  const hasPendingVoucher = vouchers.some(v => v.status === "pendente");

  useEffect(() => {
    let alive = true;

    async function loadHome() {
      setLoading(true);
      setMessage(null);

      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();

      if (userError || !user) {
        window.location.href = "/";
        return;
      }

      const [{ data: clienteData, error: clienteError }, { data: voucherData, error: voucherError }] = await Promise.all([
        supabase.from("clientes").select("*").eq("user_id", user.id).maybeSingle(),
        supabase.from("vouchers").select("*").eq("cliente_id", user.id).order("data_expiracao", { ascending: false }),
      ]);

      if (!alive) return;

      if (clienteError || voucherError) {
        setMessage("Não consegui carregar todos os dados agora.");
      }

      setCliente((clienteData as Cliente | null) ?? null);
      setRole((clienteData as Cliente | null)?.papel || "user");
      setVouchers((voucherData as Voucher[] | null) ?? []);
      setLoading(false);
    }

    loadHome();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const mac = getCookie("captive_mac");
    const url = getCookie("captive_url") ?? "http://www.google.com";
    if (mac) {
      setCaptiveMac(mac);
      setCaptiveUrl(url);
    }
  }, []);

  useEffect(() => {
    vouchers.forEach(v => {
      if (v.status === "pendente" && v.id) seenPendingIds.current.add(v.id);
    });
  }, [vouchers]);

  useEffect(() => {
    if (!hasPendingVoucher || loading) return;
    let alive = true;
    const interval = setInterval(async () => {
      if (!alive) return;
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !alive) return;
      const { data } = await supabase
        .from("vouchers")
        .select("*")
        .eq("cliente_id", user.id)
        .order("data_expiracao", { ascending: false });
      if (!data || !alive) return;
      const activated = (data as Voucher[]).find(
        v => (v.status === "criado" || v.status === "Quase venc.") && v.id && seenPendingIds.current.has(v.id)
      );
      if (activated) {
        seenPendingIds.current.delete(activated.id!);
        setActivatedVoucher(activated);
      }
      setVouchers(data as Voucher[]);
    }, 5000);
    return () => { alive = false; clearInterval(interval); };
  }, [hasPendingVoucher, loading]);

  useEffect(() => {
    if (!captiveConnecting) return;
    setCaptiveCountdown(60);
    const timer = setInterval(() => setCaptiveCountdown((c) => c > 0 ? c - 1 : 0), 1000);
    return () => clearInterval(timer);
  }, [captiveConnecting]);

  const handleCaptiveConnect = async () => {
    if (!captiveMac || captiveConnecting) return;
    setCaptiveConnecting(true);
    setCaptiveError(false);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setCaptiveConnecting(false);
      setCaptiveError(true);
      return;
    }

    try {
      const res = await fetch("/api/hotspot/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ mac: captiveMac }),
      });
      const data = await res.json();

      if (!res.ok) {
        setCaptiveConnecting(false);
        setCaptiveError(true);
        return;
      }

      if (data.status === "autorizado") {
        deleteCookie("captive_mac");
        deleteCookie("captive_url");
        window.location.href = captiveUrl;
        return;
      }

      if (data.id) {
        const poll = setInterval(async () => {
          try {
            const pollRes = await fetch(`/api/hotspot/authorize/${data.id}`);
            if (!pollRes.ok) return;
            const pollData = await pollRes.json();
            if (pollData.status === "autorizado") {
              clearInterval(poll);
              deleteCookie("captive_mac");
              deleteCookie("captive_url");
              window.location.href = captiveUrl;
            } else if (pollData.status === "erro") {
              clearInterval(poll);
              setCaptiveConnecting(false);
              setCaptiveError(true);
            }
          } catch {
            // Ignora falhas temporárias de rede no captive portal
          }
        }, 3000);
        setTimeout(() => { clearInterval(poll); setCaptiveConnecting(false); setCaptiveError(true); }, 60_000);
      } else {
        setCaptiveConnecting(false);
        setCaptiveError(true);
      }
    } catch {
      setCaptiveConnecting(false);
      setCaptiveError(true);
    }
  };

  const copyVoucher = async (code?: string | null) => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
  };

  const [revoking, setRevoking] = useState(false);

  const handleRevokeAccess = async () => {
    if (!confirm("Deseja revogar seu acesso? O portal cativo vai reaparecer e você precisará se reconectar.")) return;
    setRevoking(true);
    setMessage("Revogando acesso…");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setRevoking(false); setMessage("Erro: não logado."); return; }

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setRevoking(false); setMessage("Erro: sessão expirada."); return; }

    try {
      const res = await fetch("/api/hotspot/revoke-my-access", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      });
      if (res.ok) {
        setMessage("Acesso revogado. O portal vai reaparecer em instantes.");
        setTimeout(() => { window.location.reload(); }, 3000);
      } else {
        const data = await res.json();
        setMessage(data.error ?? "Erro ao revogar acesso.");
      }
    } catch {
      setMessage("Erro de rede.");
    }
    setRevoking(false);
  };

  const signOut = async () => {
    setMessage("Saindo do sistema.");
    await supabase.auth.signOut();
    window.location.href = "/";
  };

  return (
    <main className="home-page">
      <section className="home-shell" aria-label="Resumo do Wi-Fi">
        <div className="home-main">
          <header className="home-topbar">
            <img className="home-logo" src="/brand/logo-jocum-almirante.png" alt="JOCUM Almirante Tamandaré AT" />
            <button className="home-icon-button" onClick={() => setMenuOpen(true)} type="button" aria-label="Abrir menu">
              <span aria-hidden="true" />
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </button>
          </header>

          {loading ? (
            <div className="home-loading" role="status">
              Carregando...
            </div>
          ) : (
            <>
              <p className="home-greeting">Olá, {firstName(cliente?.nome)}.</p>

              <section className="home-card" aria-label="Resumo do pacote">
                <h1>Resumo Wi-Fi Jocum AT</h1>
                <div className="home-summary-grid">
                  <div className="home-labels">
                    {cliente?.categoria === "Ministério" && <span>Qtd obreiros:</span>}
                    <span>Categoria:</span>
                    <span>Utilização:</span>
                    <span>Vencimento:</span>
                  </div>
                  <div className="home-values">
                    {cliente?.categoria === "Ministério" && <span>{ministryPeople}</span>}
                    <span>{cliente?.categoria || "Obreiro"}</span>
                    <span>
                      {`${currentVoucher?.usos ?? "0/6"} dispositivos`}
                    </span>
                    <span>{formatDate(currentVoucher?.data_expiracao)}</span>
                  </div>
                </div>
              </section>

              {captiveMac && (voucherStatus === "Em dia" || voucherStatus === "2 dias") && !captiveConnecting && (
                <div className="captive-banner" role="status">
                  <div className="captive-banner-text">
                    <strong>Conectar à rede premium</strong>
                    <span>Seu voucher está ativo. Toque para liberar o acesso.</span>
                  </div>
                  <button className="captive-banner-btn" type="button" onClick={handleCaptiveConnect}>
                    Conectar
                  </button>
                </div>
              )}

              {captiveConnecting && (
                <div className="voucher-pending-banner" role="status">
                  <span className="voucher-pending-spinner" aria-hidden="true" />
                  <div>
                    <strong>Liberando acesso à rede…</strong>
                    <span>{captiveCountdown > 0 ? `Aguarde… ${captiveCountdown}s` : "Quase lá…"}</span>
                  </div>
                </div>
              )}

              {captiveError && !captiveConnecting && (
                <div className="voucher-pending-banner" role="alert" style={{ borderColor: "rgba(248,113,113,0.3)", background: "rgba(248,113,113,0.06)" }}>
                  <div>
                    <strong style={{ color: "#fca5a5" }}>Não foi possível liberar o acesso</strong>
                    <span>Verifique sua conexão Wi-Fi e tente novamente.</span>
                  </div>
                  <button
                    type="button"
                    className="captive-banner-btn"
                    onClick={() => { setCaptiveError(false); void handleCaptiveConnect(); }}
                  >
                    Tentar novamente
                  </button>
                </div>
              )}

              {hasPendingVoucher && (
                <div className="voucher-pending-banner" role="status">
                  <span className="voucher-pending-spinner" aria-hidden="true" />
                  <div>
                    <strong>Ativando seu acesso…</strong>
                    <span>O voucher está sendo gerado, aguarde alguns instantes.</span>
                  </div>
                </div>
              )}

              {(voucherStatus === "Vencido" || voucherStatus === "2 dias") && (
                <button
                  className={`home-alert ${voucherStatus === "Vencido" ? "danger" : "warning"}`}
                  onClick={() => setAlertOpen(true)}
                  type="button"
                  aria-label="Ver detalhes do aviso de vencimento"
                >
                  <span className="home-alert-dot" aria-hidden="true" />
                  <span className="home-alert-label">
                    {voucherStatus === "Vencido" ? "Pacote vencido" : "Pacote vencendo em breve"}
                  </span>
                  <span className="home-alert-chevron" aria-hidden="true">›</span>
                </button>
              )}

              <section className="home-card voucher-card" aria-label="Lista de vouchers">
                <h2>Lista de vouchers</h2>
                <div className="voucher-head" aria-hidden="true">
                  <span>Expira em</span>
                  <span>Voucher</span>
                  <span>Status</span>
                  <span>Copiar</span>
                </div>

                <div className="voucher-list">
                  {vouchers.length ? (
                    vouchers.map((voucher, index) => {
                      const rowStatus = getVoucherRowStatus(voucher);
                      const inactive = rowStatus.color === "red";
                      return (
                        <div className={`voucher-row ${inactive ? "inactive" : ""}`} key={`${voucher.codigo || "voucher"}-${index}`}>
                          <span>{formatDate(voucher.data_expiracao, true)}</span>
                          <strong>{voucher.codigo || "xxxxx-xxxxx"}</strong>
                          <button
                            className={`voucher-dot-btn ${openTipIndex === index ? "tip-open" : ""}`}
                            onClick={() => setOpenTipIndex(openTipIndex === index ? null : index)}
                            type="button"
                            aria-label={rowStatus.label}
                          >
                            <span className={`voucher-status-dot ${rowStatus.color}${rowStatus.color === "pending" ? " pulsing" : ""}`} aria-hidden="true" />
                            <span className="voucher-dot-tip" role="tooltip">{rowStatus.label}</span>
                          </button>
                          <button onClick={() => copyVoucher(voucher.codigo)} type="button" aria-label={`Copiar voucher ${voucher.codigo || ""}`}>
                            ⧉
                          </button>
                        </div>
                      );
                    })
                  ) : (
                    <p className="home-empty">Nenhum voucher encontrado.</p>
                  )}
                </div>

                <div className="voucher-legend" aria-label="Legenda de status">
                  <span><span className="voucher-status-dot green" aria-hidden="true" />Ativo</span>
                  <span><span className="voucher-status-dot yellow" aria-hidden="true" />Vencendo</span>
                  <span><span className="voucher-status-dot red" aria-hidden="true" />Vencido</span>
                </div>
              </section>

              <button
                type="button"
                onClick={() => void handleRevokeAccess()}
                disabled={revoking}
                style={{
                  background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.25)",
                  borderRadius: 10, padding: "10px 16px", color: "#fca5a5",
                  fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", width: "100%",
                  opacity: revoking ? 0.5 : 1,
                }}
              >
                {revoking ? "Revogando…" : "Desconectar da rede"}
              </button>

              {message && <p className="status-message">{message}</p>}
            </>
          )}
        </div>

        <aside className="home-visual" aria-label="JOCUM AT">
          <img src="/brand/logo-at-square.png" alt="" aria-hidden="true" />
          <div>
            <p>Wi-Fi da Base</p>
            <strong>Conexão ativa para a rotina da comunidade.</strong>
          </div>
        </aside>
      </section>

      {menuOpen && (
        <div className="home-menu-backdrop" role="presentation" onClick={() => setMenuOpen(false)}>
          <nav className="home-menu" aria-label="Menu" onClick={(event) => event.stopPropagation()}>
            <button className="home-menu-close" onClick={() => setMenuOpen(false)} type="button" aria-label="Fechar menu">
              ×
            </button>
            <img src="/brand/logo-at-symbol.png" alt="JOCUM AT" />
            <p>Usuário: {role}</p>
            <a href="/home">Início</a>
            <a href="/renovacao">Renovação</a>
            {role !== "user" && <a href="/admin">Administração</a>}
            <button onClick={signOut} type="button">
              Sair
            </button>
          </nav>
        </div>
      )}

      {alertOpen && (voucherStatus === "Vencido" || voucherStatus === "2 dias") && (
        <div className="home-menu-backdrop" role="presentation" onClick={() => setAlertOpen(false)}>
          <div
            className={`home-alert-dialog ${voucherStatus === "Vencido" ? "danger" : "warning"}`}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="alert-dialog-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button className="home-menu-close" onClick={() => setAlertOpen(false)} type="button" aria-label="Fechar">×</button>
            <h2 id="alert-dialog-title">
              {voucherStatus === "Vencido"
                ? "Seu pacote de utilização está vencido"
                : "Seu pacote de utilização está quase vencido"}
            </h2>
            <p>Renove agora para manter o acesso à internet da base.</p>
            <button className="home-renew-button" onClick={() => (window.location.href = "/renovacao")} type="button">
              Renovação
            </button>
          </div>
        </div>
      )}

      {activatedVoucher && (
        <div className="home-menu-backdrop" role="presentation" onClick={() => setActivatedVoucher(null)}>
          <div className="voucher-activated-dialog" role="alertdialog" aria-modal="true" aria-labelledby="activated-title" onClick={e => e.stopPropagation()}>
            <div className="activated-check" aria-hidden="true">✓</div>
            <h2 id="activated-title" className="activated-title">Acesso ativado!</h2>
            <p className="activated-subtitle">Seu voucher está pronto. Use o código abaixo para se conectar.</p>

            <div className="activated-code-row">
              <span className="activated-code">{activatedVoucher.codigo}</span>
              <button
                className="activated-copy-btn"
                type="button"
                onClick={() => { void navigator.clipboard.writeText(activatedVoucher.codigo ?? ""); setCopiedCode(activatedVoucher.codigo ?? ""); }}
                aria-label="Copiar código"
              >
                Copiar
              </button>
            </div>

            <ol className="activated-steps">
              <li><strong>Conecte ao Wi-Fi</strong> da Base</li>
              <li>Abra o navegador — a tela de acesso abrirá automaticamente</li>
              <li>Cole o código acima e confirme</li>
            </ol>

            <button className="home-renew-button" type="button" onClick={() => setActivatedVoucher(null)}>
              Entendido
            </button>
          </div>
        </div>
      )}

      {copiedCode && (
        <div className="home-menu-backdrop" role="presentation" onClick={() => setCopiedCode("")}>
          <div className="voucher-copied-dialog" role="alertdialog" aria-modal="true" aria-labelledby="copy-title" onClick={(e) => e.stopPropagation()}>
            <div className="voucher-copied-top">
              <img src="/brand/logo-at-symbol.png" alt="JOCUM AT" className="voucher-copied-logo" />
              <button className="voucher-copied-close" onClick={() => setCopiedCode("")} type="button" aria-label="Fechar">×</button>
            </div>
            <div className="voucher-copied-body">
              <p id="copy-title">Voucher copiado com sucesso.</p>
              <div className="voucher-copied-divider" aria-hidden="true" />
              <p className="voucher-copied-warning">
                Importante!<br />
                Seu voucher é pessoal e intransferível.<br /><br />
                Favor não compartilhar.
              </p>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
