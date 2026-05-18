"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../../utils/supabase/client";

type ClientDetail = {
  nome?: string | null;
  email?: string | null;
  whatsApp?: string | null;
  senha?: string | null;
  categoria?: string | null;
  papel?: string | null;
  ativo?: boolean | null;
  tipo_plano?: string | null;
  tempo?: string | null;
  user_id?: string | null;
  created_at?: string | null;
};

type Voucher = {
  id?: string;
  codigo?: string | null;
  status?: string | null;
  data_expiracao?: string | null;
  tempo_desc?: string | null;
  quota?: number | null;
  usos?: number | null;
  qtdObreiros?: number | null;
  created_at?: string | null;
};

type Financa = {
  id?: string;
  plano_escolhido?: string | null;
  valor_pago?: number | null;
  created_at?: string | null;
};

const twoDays = 172800000;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function daysUntil(value?: string | null): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function fmtDateWithWeekday(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(d);
  const date = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
  return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)}, ${date}`;
}

function voucherDot(voucher: Voucher): { color: "green" | "yellow" | "red"; label: string } {
  const exp = voucher.data_expiracao ? new Date(voucher.data_expiracao).getTime() : null;
  if (!exp) return { color: "red", label: "Sem data" };
  const now = Date.now();
  if (exp <= now) return { color: "red", label: "Vencido" };
  if (exp <= now + twoDays) return { color: "yellow", label: "Vencendo" };
  return { color: "green", label: "Ativo" };
}

function whatsAppUrl(phone?: string | null): string {
  if (!phone) return "";
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

function voucherWhatsAppUrl(
  phone: string | null | undefined,
  nome: string | null | undefined,
  voucher: Voucher,
): string {
  const base = whatsAppUrl(phone);
  if (!base) return "";

  const first = nome?.trim().split(/\s+/)[0] || "cliente";
  const lines = [
    `Olá, ${first}!`,
    "",
    "Seguem seus dados de acesso ao Wi-Fi da Base:",
    "",
    `🔑 *Voucher:* ${voucher.codigo || "pendente"}`,
    `📋 *Plano:* ${voucher.tempo_desc || "—"}`,
    `📅 *Vencimento:* ${fmtDate(voucher.data_expiracao)}`,
  ];
  if (voucher.quota != null) {
    lines.push(`🔢 *Acessos disponíveis:* ${voucher.quota}`);
  }

  return `${base}?text=${encodeURIComponent(lines.join("\n"))}`;
}

function userWhatsAppUrl(cliente: ClientDetail, vouchers: Voucher[]): string {
  const base = whatsAppUrl(cliente.whatsApp);
  if (!base) return "";

  const first = cliente.nome?.trim().split(/\s+/)[0] || "cliente";

  const active = vouchers.find((v) => {
    const exp = v.data_expiracao ? new Date(v.data_expiracao).getTime() : null;
    return v.status === "criado" && exp !== null && exp > Date.now();
  }) ?? vouchers[0] ?? null;

  const lines = [
    `Olá, ${first}!`,
    "",
    `*Email:* ${cliente.email || "—"}`,
    `*Senha:* ${cliente.senha || "—"}`,
    `*Acesso:* https://wifi-manager-react.vercel.app`,
    `*Categoria:* ${cliente.categoria || "—"}`,
  ];

  if (active) {
    const usos = Number.isFinite(Number(active.usos)) ? Number(active.usos) : 0;
    const dot = voucherDot(active);
    lines.push(
      "",
      `📋 *Voucher ${dot.label.toLowerCase()}*`,
      `*Código:* ${active.codigo || "pendente"}`,
      `*Plano:* ${active.tempo_desc || "—"}`,
      `*Vencimento:* ${fmtDate(active.data_expiracao)}`,
    );
    if (active.quota != null) {
      lines.push(`*Acessos:* ${usos} de ${active.quota} usados`);
    }
    const days = daysUntil(active.data_expiracao);
    if (days !== null && days > 0) {
      lines.push(`*Dias restantes:* ${days}`);
    }
  }

  return `${base}?text=${encodeURIComponent(lines.join("\n"))}`;
}

const ROLES = ["user", "admin", "gestor"];

export default function AdminClientPage({ params }: { params: { id: string } }) {
  const [cliente, setCliente] = useState<ClientDetail | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [financas, setFinancas] = useState<Financa[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [papelEdit, setPapelEdit] = useState("user");
  const [saving, setSaving] = useState(false);
  const [renewVoucher, setRenewVoucher] = useState<Voucher | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [updatedVoucher, setUpdatedVoucher] = useState<Voucher | null>(null);
  const [showResult, setShowResult] = useState(false);
  const tokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      setShowResult(true);
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c !== null ? c - 1 : null), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    async function init() {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session) { window.location.href = "/"; return; }

      const { data: clienteData } = await supabase
        .from("clientes")
        .select("papel")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!clienteData?.papel || clienteData.papel === "user") {
        window.location.href = "/home";
        return;
      }

      tokenRef.current = session.access_token;

      const res = await fetch(`/api/admin/clients/${params.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = (await res.json()) as {
        cliente?: ClientDetail;
        vouchers?: Voucher[];
        financas?: Financa[];
        error?: string;
      };

      if (data.error || !data.cliente) {
        setMessage(data.error || "Cliente não encontrado.");
        setLoading(false);
        return;
      }

      setCliente(data.cliente);
      setPapelEdit(data.cliente.papel || "user");
      setVouchers(data.vouchers ?? []);
      setFinancas(data.financas ?? []);
      setLoading(false);
    }

    void init();
  }, [params.id]);

  const savePapel = async () => {
    if (!tokenRef.current || !cliente) return;
    setSaving(true);
    setMessage(null);

    const res = await fetch(`/api/admin/clients/${params.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenRef.current}`,
      },
      body: JSON.stringify({ papel: papelEdit }),
    });

    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (data.ok) {
      setCliente((prev) => prev ? { ...prev, papel: papelEdit } : prev);
      setMessage("Papel atualizado com sucesso.");
    } else {
      setMessage(data.error || "Erro ao atualizar papel.");
    }
    setSaving(false);
  };

  const deleteClient = async () => {
    if (!tokenRef.current) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/admin/clients/${params.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenRef.current}` },
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (data.ok) {
      window.location.href = "/admin";
    } else {
      setDeleteError(data.error || "Erro ao excluir.");
      setDeleting(false);
    }
  };

  const copyVoucher = async (voucher: Voucher) => {
    if (!voucher.codigo || !voucher.id) return;
    await navigator.clipboard.writeText(voucher.codigo);
    setCopiedId(voucher.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const confirmUpdate = async () => {
    if (!tokenRef.current || !renewVoucher?.id) return;
    setUpdating(true);
    setUpdateError(null);

    const days = daysUntil(renewVoucher.data_expiracao);
    const safedays = Math.max(0, days ?? 0);
    const newTempDesc = `${safedays} dias`;

    const res = await fetch(`/api/admin/vouchers/${renewVoucher.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenRef.current}`,
      },
      body: JSON.stringify({ tempo_desc: newTempDesc, status: "pendente" }),
    });

    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (data.ok) {
      setUpdatedVoucher({ ...renewVoucher, tempo_desc: newTempDesc, status: "pendente" });
      setRenewVoucher(null);
      setCountdown(20);
    } else {
      setUpdateError(data.error || "Erro ao atualizar voucher.");
    }
    setUpdating(false);
  };

  if (countdown !== null) {
    return (
      <main className="admin-page admin-countdown-page">
        <div className="countdown-card motion-in">
          <img className="auth-logo" src="/brand/logo-at-symbol.png" alt="JOCUM AT" />
          <div className="countdown-circle">
            <span className="countdown-number">{countdown}</span>
            <small>segundos</small>
          </div>
          <p className="countdown-title">Atualizando voucher…</p>
          <p className="countdown-subtitle">Aguarde um momento</p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="admin-page">
        <header className="admin-topbar">
          <a href="/admin" className="admin-back">‹ Clientes</a>
          <h1>Carregando…</h1>
        </header>
        <p className="admin-loading">Buscando dados do cliente…</p>
      </main>
    );
  }

  if (!cliente) {
    return (
      <main className="admin-page">
        <header className="admin-topbar">
          <a href="/admin" className="admin-back">‹ Clientes</a>
          <h1>Não encontrado</h1>
        </header>
        <p className="admin-message">{message || "Cliente não encontrado."}</p>
      </main>
    );
  }

  const isMinistry = cliente.categoria === "Ministério";
  const wppUrl = userWhatsAppUrl(cliente, vouchers);

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <a href="/admin" className="admin-back">‹ Clientes</a>
        <h1>{cliente.nome || "Cliente"}</h1>
      </header>

      <div className="admin-detail-stack">
        {/* ── Dados do usuário ── */}
        <section className="admin-section">
          <h2 className="admin-section-title">Dados do usuário</h2>
          <dl className="admin-field-grid">
            <div className="admin-field">
              <dt>Nome</dt>
              <dd>{cliente.nome || "—"}</dd>
            </div>
            <div className="admin-field">
              <dt>E-mail</dt>
              <dd>{cliente.email || "—"}</dd>
            </div>
            <div className="admin-field">
              <dt>WhatsApp</dt>
              <dd className="admin-field-wpp">
                <span>{cliente.whatsApp || "—"}</span>
                {wppUrl && (
                  <a
                    href={wppUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="admin-wpp-link"
                    aria-label="Abrir WhatsApp"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                  </a>
                )}
              </dd>
            </div>
            <div className="admin-field">
              <dt>Categoria</dt>
              <dd>{cliente.categoria || "—"}</dd>
            </div>
            <div className="admin-field">
              <dt>Plano</dt>
              <dd>{cliente.tipo_plano || "—"}</dd>
            </div>
            <div className="admin-field">
              <dt>Período</dt>
              <dd>{cliente.tempo || "—"}</dd>
            </div>
            <div className="admin-field">
              <dt>Ativo</dt>
              <dd>{cliente.ativo ? "Sim" : "Não"}</dd>
            </div>
            <div className="admin-field">
              <dt>Membro desde</dt>
              <dd>{fmtDate(cliente.created_at)}</dd>
            </div>
          </dl>

          <div className="admin-papel-editor">
            <label htmlFor="papel-select" className="admin-papel-label">
              Papel (permissão de acesso)
            </label>
            <div className="admin-papel-row">
              <select
                id="papel-select"
                className="admin-select"
                value={papelEdit}
                onChange={(e) => setPapelEdit(e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button
                className="admin-save-button"
                type="button"
                onClick={savePapel}
                disabled={saving || papelEdit === cliente.papel}
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            </div>
            {message && <p className="admin-message">{message}</p>}
          </div>

          <button
            className="admin-delete-button"
            type="button"
            onClick={() => { setDeleteError(null); setShowDeleteModal(true); }}
          >
            Excluir cliente
          </button>
        </section>

        {/* ── Dados financeiros ── */}
        <section className="admin-section">
          <div className="admin-section-header">
            <h2 className="admin-section-title">Dados financeiros</h2>
            {financas.length > 0 && (
              <span className="admin-section-count">
                {financas.length} {financas.length === 1 ? "transação" : "transações"}
              </span>
            )}
          </div>
          {financas.length === 0 ? (
            <p className="admin-empty">Nenhum registro financeiro.</p>
          ) : (
            <div className="admin-scroll-container">
              {financas.map((f, i) => (
                <div key={f.id || i} className="admin-financa-row">
                  <div className="admin-financa-field">
                    <span>Data do pagamento</span>
                    <strong>{fmtDateWithWeekday(f.created_at)}</strong>
                  </div>
                  <div className="admin-financa-divider" />
                  <div className="admin-financa-bottom">
                    <div className="admin-financa-field">
                      <span>Plano contratado</span>
                      <strong>{f.plano_escolhido || "—"}</strong>
                    </div>
                    <div className="admin-financa-field admin-financa-field--right">
                      <span>Valor pago</span>
                      <strong className="admin-financa-value">
                        {f.valor_pago != null ? money.format(f.valor_pago) : "—"}
                      </strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Vouchers ── */}
        <section className="admin-section">
          <div className="admin-section-header">
            <h2 className="admin-section-title">Vouchers</h2>
            {vouchers.length > 0 && (
              <span className="admin-section-count">
                {vouchers.length} {vouchers.length === 1 ? "voucher" : "vouchers"}
              </span>
            )}
          </div>
          {vouchers.length === 0 ? (
            <p className="admin-empty">Nenhum voucher encontrado.</p>
          ) : (
            <div className="admin-scroll-container">
              {vouchers.map((v, i) => {
                const dot = voucherDot(v);
                const inactive = dot.color === "red";
                return (
                  <div
                    key={v.id || i}
                    className={`admin-voucher-row${inactive ? " admin-voucher-row--inactive" : ""}`}
                  >
                    <div className="admin-voucher-header">
                      <span
                        className={`voucher-status-dot ${dot.color}`}
                        title={dot.label}
                        aria-label={dot.label}
                      />
                      <code className="admin-voucher-code">{v.codigo || "pendente"}</code>
                      <button
                        className="admin-voucher-copy"
                        type="button"
                        onClick={() => void copyVoucher(v)}
                        aria-label="Copiar voucher"
                        disabled={!v.codigo}
                      >
                        {copiedId === v.id ? "Copiado!" : "⧉"}
                      </button>
                      {(() => {
                        const wpp = voucherWhatsAppUrl(cliente.whatsApp, cliente.nome, v);
                        return wpp ? (
                          <a
                            href={wpp}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="admin-voucher-wpp"
                            aria-label="Enviar pelo WhatsApp"
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                            </svg>
                          </a>
                        ) : null;
                      })()}
                    </div>
                    <div className="admin-voucher-details">
                      <span>
                        Vence: {fmtDate(v.data_expiracao)}
                        {(() => {
                          const d = daysUntil(v.data_expiracao);
                          if (d === null) return null;
                          if (d <= 0) return <em> · vencido</em>;
                          return <em> · {d} dia{d !== 1 ? "s" : ""} restantes</em>;
                        })()}
                      </span>
                      {v.quota != null && (
                        <span>
                          {v.usos ?? "—"} de {v.quota}{" "}
                          {v.quota === 1 ? "acesso usado" : "acessos usados"}
                        </span>
                      )}
                      {isMinistry && v.qtdObreiros != null && v.qtdObreiros > 0 && (
                        <span>{v.qtdObreiros} {v.qtdObreiros === 1 ? "obreiro" : "obreiros"}</span>
                      )}
                    </div>
                    <button
                      className="admin-voucher-renew"
                      type="button"
                      onClick={() => { setUpdateError(null); setRenewVoucher(v); }}
                    >
                      Atualizar
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* ── Delete modal ── */}
      {showDeleteModal && (
        <div
          className="admin-modal-backdrop"
          role="presentation"
          onClick={() => !deleting && setShowDeleteModal(false)}
        >
          <div
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="admin-modal-close"
              type="button"
              onClick={() => setShowDeleteModal(false)}
              aria-label="Fechar"
              disabled={deleting}
            >
              ×
            </button>
            <h3 id="delete-title" className="admin-modal-title">Excluir cliente</h3>
            <p className="admin-modal-info admin-modal-info--warn">
              Tem certeza que deseja excluir <strong>{cliente.nome || "este cliente"}</strong>?
              Todos os dados serão removidos permanentemente. Esta ação é <strong>irreversível</strong>.
            </p>
            {deleteError && <p className="admin-modal-error">{deleteError}</p>}
            <button
              className="admin-modal-confirm admin-modal-confirm--danger"
              type="button"
              onClick={deleteClient}
              disabled={deleting}
            >
              {deleting ? "Excluindo…" : "Sim, excluir permanentemente"}
            </button>
            <button
              className="admin-modal-confirm admin-modal-confirm--ghost"
              type="button"
              onClick={() => setShowDeleteModal(false)}
              disabled={deleting}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Renewal modal ── */}
      {renewVoucher && (
        <div
          className="admin-modal-backdrop"
          role="presentation"
          onClick={() => !updating && setRenewVoucher(null)}
        >
          <div
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="renew-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="admin-modal-close"
              type="button"
              onClick={() => setRenewVoucher(null)}
              aria-label="Fechar"
              disabled={updating}
            >
              ×
            </button>
            <h3 id="renew-title" className="admin-modal-title">Atualizar voucher</h3>
            <code className="admin-modal-code">{renewVoucher.codigo || "pendente"}</code>

            {(() => {
              const days = daysUntil(renewVoucher.data_expiracao);
              if (days === null) return <p className="admin-modal-info">Sem data de vencimento definida.</p>;
              if (days <= 0) return <p className="admin-modal-info admin-modal-info--warn">Voucher vencido há {Math.abs(days)} dia{Math.abs(days) !== 1 ? "s" : ""}.</p>;
              return <p className="admin-modal-info">Falta{days === 1 ? "" : "m"} <strong>{days} dia{days !== 1 ? "s" : ""}</strong> para o vencimento.</p>;
            })()}

            {updateError && <p className="admin-modal-error">{updateError}</p>}

            <button
              className="admin-modal-confirm"
              type="button"
              onClick={confirmUpdate}
              disabled={updating}
            >
              {updating ? "Atualizando…" : "Atualizar"}
            </button>
          </div>
        </div>
      )}

      {/* ── Result modal ── */}
      {showResult && updatedVoucher && (
        <div className="admin-modal-backdrop" role="presentation">
          <div
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="result-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="result-title" className="admin-modal-title">Voucher gerado</h3>
            <code className="admin-modal-code">{updatedVoucher.codigo || "pendente"}</code>

            <div className="admin-result-grid">
              <div className="admin-result-row">
                <span>Status</span>
                <strong>pendente</strong>
              </div>
              <div className="admin-result-row">
                <span>Plano</span>
                <strong>{updatedVoucher.tempo_desc || "—"}</strong>
              </div>
              <div className="admin-result-row">
                <span>Vencimento</span>
                <strong>{fmtDate(updatedVoucher.data_expiracao)}</strong>
              </div>
              {updatedVoucher.quota != null && (
                <div className="admin-result-row">
                  <span>Acessos</span>
                  <strong>{updatedVoucher.quota}</strong>
                </div>
              )}
            </div>

            {(() => {
              const wpp = voucherWhatsAppUrl(cliente?.whatsApp, cliente?.nome, updatedVoucher);
              return wpp ? (
                <a
                  href={wpp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="admin-modal-wpp"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  Enviar pelo WhatsApp
                </a>
              ) : null;
            })()}

            <button
              className="admin-modal-confirm admin-modal-confirm--ghost"
              type="button"
              onClick={() => { setShowResult(false); setUpdatedVoucher(null); }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
