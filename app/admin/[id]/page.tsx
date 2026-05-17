"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../../utils/supabase/client";

type ClientDetail = {
  nome?: string | null;
  email?: string | null;
  whatsApp?: string | null;
  categoria?: string | null;
  papel?: string | null;
  ativo?: boolean | null;
  tipo_plano?: string | null;
  tempo?: string | null;
  user_id?: string | null;
};

type Voucher = {
  id?: string;
  codigo?: string | null;
  status?: string | null;
  data_expiracao?: string | null;
  tempo_desc?: string | null;
  quota?: number | null;
  qtdObreiros?: number | null;
  created_at?: string | null;
};

type Financa = {
  id?: string;
  plano_escolhido?: string | null;
  valor_pago?: number | null;
  comprovante_pgto?: string | null;
  created_at?: string | null;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function fmt(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
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
  const tokenRef = useRef<string | null>(null);

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
              <dd>{cliente.whatsApp || "—"}</dd>
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
        </section>

        {/* ── Dados financeiros ── */}
        <section className="admin-section">
          <h2 className="admin-section-title">Dados financeiros</h2>
          {financas.length === 0 ? (
            <p className="admin-empty">Nenhum registro financeiro.</p>
          ) : (
            <div className="admin-financa-list">
              {financas.map((f, i) => (
                <div key={f.id || i} className="admin-financa-row">
                  <div className="admin-financa-main">
                    <span className="admin-financa-plan">{f.plano_escolhido || "—"}</span>
                    <strong className="admin-financa-value">
                      {f.valor_pago != null ? money.format(f.valor_pago) : "—"}
                    </strong>
                  </div>
                  <span className="admin-financa-date">{fmt(f.created_at)}</span>
                  {f.comprovante_pgto && (
                    <p className="admin-financa-ref">{f.comprovante_pgto}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Vouchers ── */}
        <section className="admin-section">
          <h2 className="admin-section-title">Vouchers</h2>
          {vouchers.length === 0 ? (
            <p className="admin-empty">Nenhum voucher encontrado.</p>
          ) : (
            <div className="admin-voucher-list">
              {vouchers.map((v, i) => (
                <div
                  key={v.id || i}
                  className={`admin-voucher-row${v.status !== "criado" ? " admin-voucher-row--inactive" : ""}`}
                >
                  <div className="admin-voucher-header">
                    <code className="admin-voucher-code">{v.codigo || "pendente"}</code>
                    <span className={`admin-tag ${v.status === "criado" ? "admin-tag--active" : "admin-tag--inactive"}`}>
                      {v.status || "—"}
                    </span>
                  </div>
                  <div className="admin-voucher-details">
                    <span>Vencimento: {fmt(v.data_expiracao)}</span>
                    {v.tempo_desc && <span>Plano: {v.tempo_desc}</span>}
                    {v.quota != null && <span>Quota: {v.quota}h</span>}
                    {v.qtdObreiros != null && v.qtdObreiros > 0 && (
                      <span>Obreiros: {v.qtdObreiros}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
