"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../../utils/supabase/client";

type Cliente = {
  nome?: string | null;
  categoria?: string | null;
  papel?: string | null;
};

type Voucher = {
  codigo?: string | null;
  status?: string | null;
  data_expiracao?: string | null;
  qtdObreiros?: number | null;
  qtd_obreiros?: number | null;
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

function activeLabel(status?: string | null) {
  return status === "criado" ? "Ativo" : "Inat.";
}

export default function HomePage() {
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [role, setRole] = useState("user");
  const [loading, setLoading] = useState(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copiedCode, setCopiedCode] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const currentVoucher = vouchers[0] ?? null;
  const voucherStatus = useMemo(() => getVoucherStatus(currentVoucher), [currentVoucher]);
  const ministryPeople = currentVoucher?.qtdObreiros ?? currentVoucher?.qtd_obreiros ?? 3;

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
        supabase.from("vouchers").select("*").eq("cliente_id", user.id).order("data_expiracao", { ascending: true }),
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

  const copyVoucher = async (code?: string | null) => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
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
                <h1>Resumo pacote de utilização da estrutura de internet</h1>
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
                    <span>{vouchers.length ? `${vouchers.length} voucher${vouchers.length > 1 ? "s" : ""}` : "Sem voucher"}</span>
                    <span>{formatDate(currentVoucher?.data_expiracao)}</span>
                  </div>
                </div>
              </section>

              {(voucherStatus === "Vencido" || voucherStatus === "2 dias") && (
                <section className={`home-alert ${voucherStatus === "Vencido" ? "danger" : "warning"}`} aria-label="Aviso de vencimento">
                  <h2>
                    {voucherStatus === "Vencido"
                      ? "Seu pacote de utilização está vencido"
                      : "Seu pacote de utilização está quase vencido"}
                  </h2>
                  <p>Clique no botão abaixo para renovar</p>
                  <button className="home-renew-button" onClick={() => (window.location.href = "/renovacao")} type="button">
                    Renovação
                  </button>
                </section>
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
                      const inactive = voucher.status !== "criado";
                      return (
                        <div className={`voucher-row ${inactive ? "inactive" : ""}`} key={`${voucher.codigo || "voucher"}-${index}`}>
                          <span>{formatDate(voucher.data_expiracao, true)}</span>
                          <strong>{voucher.codigo || "xxxxx-xxxxx"}</strong>
                          <span>{activeLabel(voucher.status)}</span>
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
              </section>

              {message && <p className="status-message">{message}</p>}

              <div className="home-actions">
                <button className="home-renew-button" onClick={() => (window.location.href = "/renovacao")} type="button">
                  Renovação
                </button>
                <button className="home-exit-button" onClick={signOut} type="button">
                  Sair
                </button>
              </div>
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

      {copiedCode && (
        <div className="home-menu-backdrop" role="presentation">
          <div className="copy-dialog" role="alertdialog" aria-modal="true" aria-labelledby="copy-title">
            <h2 id="copy-title">Voucher copiado</h2>
            <p>O código {copiedCode} foi enviado para a área de transferência.</p>
            <button className="home-renew-button" onClick={() => setCopiedCode("")} type="button">
              Ok
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
