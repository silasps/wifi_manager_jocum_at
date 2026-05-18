"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../../utils/supabase/client";

const twoDays = 172800000;

type VoucherRow = {
  id?: string;
  codigo?: string | null;
  status?: string | null;
  data_expiracao?: string | null;
  tempo_desc?: string | null;
  quota?: number | null;
  usos?: number | null;
  created_at?: string | null;
  cliente_id?: string | null;
  cliente?: { user_id?: string | null; nome?: string | null; email?: string | null } | null;
};

function voucherDot(v: VoucherRow): { color: "green" | "yellow" | "red"; label: string } {
  const exp = v.data_expiracao ? new Date(v.data_expiracao).getTime() : null;
  if (!exp) return { color: "red", label: "Sem data" };
  const now = Date.now();
  if (exp <= now) return { color: "red", label: "Vencido" };
  if (exp <= now + twoDays) return { color: "yellow", label: "Vencendo" };
  return { color: "green", label: "Ativo" };
}

function vStatus(v: VoucherRow): "ativo" | "vencendo" | "inativo" {
  const exp = v.data_expiracao ? new Date(v.data_expiracao).getTime() : null;
  if (!exp || exp <= Date.now()) return "inativo";
  if (exp <= Date.now() + twoDays) return "vencendo";
  return "ativo";
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(d);
}

function daysUntil(value?: string | null) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function DonutChart({
  ativos, vencendo, inativos, filter, onFilter,
}: {
  ativos: number; vencendo: number; inativos: number;
  filter: "ativo" | "vencendo" | "inativo" | null;
  onFilter: (f: "ativo" | "vencendo" | "inativo" | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const total = ativos + vencendo + inativos;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const size = 120;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);
    const cx = size / 2, cy = size / 2, r = 46, inner = 30, gap = 0.03;
    ctx.clearRect(0, 0, size, size);
    if (total === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fill("evenodd");
      return;
    }
    const segments = [
      { value: ativos, color: "#4ade80" },
      { value: vencendo, color: "#fbbf24" },
      { value: inativos, color: "rgba(255,255,255,0.18)" },
    ].filter((s) => s.value > 0);
    let start = -Math.PI / 2;
    for (const seg of segments) {
      const sweep = (seg.value / total) * (Math.PI * 2) - gap;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + sweep);
      ctx.arc(cx, cy, inner, start + sweep, start, true);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      start += sweep + gap;
    }
  }, [ativos, vencendo, inativos, total]);

  const toggle = (f: "ativo" | "vencendo" | "inativo") => onFilter(filter === f ? null : f);

  return (
    <div className="admin-donut-wrap">
      <div className="admin-donut-chart-wrap">
        <canvas ref={canvasRef} />
        <div className="admin-donut-center">
          <strong>{total}</strong>
          <small>total</small>
        </div>
      </div>
      <div className="admin-donut-legend">
        <button className={`admin-donut-filter-btn${filter === "ativo" ? " active" : ""}`} onClick={() => toggle("ativo")} type="button">
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#4ade80", display: "inline-block", flexShrink: 0 }} />
          {ativos} ativo{ativos !== 1 ? "s" : ""}
        </button>
        <button className={`admin-donut-filter-btn${filter === "vencendo" ? " active" : ""}`} onClick={() => toggle("vencendo")} type="button">
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#fbbf24", display: "inline-block", flexShrink: 0 }} />
          {vencendo} vencendo
        </button>
        <button className={`admin-donut-filter-btn${filter === "inativo" ? " active" : ""}`} onClick={() => toggle("inativo")} type="button">
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(255,255,255,0.3)", display: "inline-block", flexShrink: 0 }} />
          {inativos} inativo{inativos !== 1 ? "s" : ""}
        </button>
        {filter && (
          <button className="admin-donut-clear" onClick={() => onFilter(null)} type="button">
            ✕ limpar
          </button>
        )}
      </div>
    </div>
  );
}

export default function AdminVouchersPage() {
  const [query, setQuery] = useState("");
  const [vouchers, setVouchers] = useState<VoucherRow[]>([]);
  const [chartCounts, setChartCounts] = useState<{ ativos: number; vencendo: number; inativos: number } | null>(null);
  const [chartFilter, setChartFilter] = useState<"ativo" | "vencendo" | "inativo" | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [renewVoucher, setRenewVoucher] = useState<VoucherRow | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [updatedVoucher, setUpdatedVoucher] = useState<VoucherRow | null>(null);
  const [showResult, setShowResult] = useState(false);
  const tokenRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) { setCountdown(null); setShowResult(true); return; }
    const t = setTimeout(() => setCountdown((c) => c !== null ? c - 1 : null), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

  useEffect(() => {
    async function init() {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session) { window.location.href = "/"; return; }
      const { data: clienteData } = await supabase
        .from("clientes").select("papel").eq("user_id", session.user.id).maybeSingle();
      if (!clienteData?.papel || clienteData.papel === "user") { window.location.href = "/home"; return; }
      tokenRef.current = session.access_token;
      await Promise.all([
        fetchVouchers("", session.access_token),
        fetchStats(session.access_token),
      ]);
    }
    void init();
  }, []);

  const fetchVouchers = async (q: string, token?: string) => {
    const t = token ?? tokenRef.current;
    if (!t) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/vouchers?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const data = (await res.json()) as { vouchers?: VoucherRow[]; error?: string };
      if (data.error) { setMessage(data.error); } else { setVouchers(data.vouchers ?? []); }
    } catch {
      setMessage("Erro ao buscar vouchers.");
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async (token: string) => {
    try {
      const res = await fetch("/api/admin/vouchers/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as { ativos?: number; vencendo?: number; inativos?: number };
      setChartCounts({ ativos: data.ativos ?? 0, vencendo: data.vencendo ?? 0, inativos: data.inativos ?? 0 });
    } catch { /* optional */ }
  };

  const handleSearch = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchVouchers(value), 350);
  };

  const confirmUpdate = async () => {
    if (!tokenRef.current || !renewVoucher?.id) return;
    setUpdating(true);
    setUpdateError(null);
    const days = renewVoucher.data_expiracao
      ? Math.ceil((new Date(renewVoucher.data_expiracao).getTime() - Date.now()) / 86400000)
      : 0;
    const safedays = Math.max(0, days);
    const res = await fetch(`/api/admin/vouchers/${renewVoucher.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenRef.current}` },
      body: JSON.stringify({ tempo_desc: `${safedays} dias`, status: "pendente" }),
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (data.ok) {
      setUpdatedVoucher({ ...renewVoucher, tempo_desc: `${safedays} dias`, status: "pendente" });
      setRenewVoucher(null);
      setCountdown(20);
    } else {
      setUpdateError(data.error || "Erro ao atualizar voucher.");
    }
    setUpdating(false);
  };

  const copyVoucher = async (v: VoucherRow) => {
    if (!v.codigo || !v.id) return;
    await navigator.clipboard.writeText(v.codigo);
    setCopiedId(v.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filtered = vouchers.filter((v) => !chartFilter || vStatus(v) === chartFilter);

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

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <a href="/admin" className="admin-back">‹ Clientes</a>
        <h1>Vouchers</h1>
      </header>

      {chartCounts && (
        <div className="admin-donut-section">
          <DonutChart
            ativos={chartCounts.ativos} vencendo={chartCounts.vencendo} inativos={chartCounts.inativos}
            filter={chartFilter} onFilter={setChartFilter}
          />
        </div>
      )}

      <div className="admin-search-wrap">
        <input
          type="search"
          className="admin-search-input"
          placeholder="Buscar por código…"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          autoFocus
        />
      </div>

      {message && <p className="admin-message">{message}</p>}

      {loading ? (
        <p className="admin-loading">Buscando…</p>
      ) : filtered.length === 0 ? (
        <p className="admin-empty">Nenhum voucher encontrado.</p>
      ) : (
        <div className="admin-client-list">
          {filtered.map((v, i) => {
            const dot = voucherDot(v);
            const inactive = dot.color === "red";
            const days = daysUntil(v.data_expiracao);
            const isExpired = inactive && v.data_expiracao && new Date(v.data_expiracao).getTime() <= Date.now();
            return (
              <div
                key={v.id || i}
                className={`admin-voucher-card${inactive ? " admin-voucher-row--inactive" : ""}`}
              >
                <div className="admin-voucher-header">
                  <span className={`voucher-status-dot ${dot.color}`} title={dot.label} aria-label={dot.label} />
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
                  <span className={`admin-tag ${dot.color === "green" ? "admin-tag--active" : dot.color === "yellow" ? "admin-tag--warn" : "admin-tag--inactive"}`}>
                    {dot.label}
                  </span>
                </div>

                <div className="admin-voucher-details">
                  <span>
                    {isExpired ? `Vencido ${fmtDate(v.data_expiracao)}` : `Vence: ${fmtDate(v.data_expiracao)}`}
                    {!isExpired && days !== null && <em> · {days} dia{days !== 1 ? "s" : ""}</em>}
                  </span>
                  {v.quota != null && (
                    <span>{v.usos ?? "—"} de {v.quota} {v.quota === 1 ? "acesso usado" : "acessos usados"}</span>
                  )}
                  {v.tempo_desc && <span>Plano: {v.tempo_desc}</span>}
                </div>

                {v.cliente && (
                  <a
                    href={v.cliente.user_id ? `/admin/${v.cliente.user_id}` : "#"}
                    className="admin-voucher-client-link"
                  >
                    <span className="admin-voucher-client-name">{v.cliente.nome || "Sem nome"}</span>
                    <span className="admin-voucher-client-email">{v.cliente.email || "—"}</span>
                    <span className="admin-chevron" style={{ fontSize: "0.9rem" }}>›</span>
                  </a>
                )}

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

      {renewVoucher && (
        <div className="admin-modal-backdrop" role="presentation" onClick={() => !updating && setRenewVoucher(null)}>
          <div className="admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-close" type="button" onClick={() => setRenewVoucher(null)} disabled={updating}>×</button>
            <h3 className="admin-modal-title">Atualizar voucher</h3>
            <code className="admin-modal-code">{renewVoucher.codigo || "pendente"}</code>
            {(() => {
              const days = renewVoucher.data_expiracao
                ? Math.ceil((new Date(renewVoucher.data_expiracao).getTime() - Date.now()) / 86400000)
                : null;
              if (days === null) return <p className="admin-modal-info">Sem data de vencimento.</p>;
              if (days <= 0) return <p className="admin-modal-info admin-modal-info--warn">Voucher vencido há {Math.abs(days)} dia{Math.abs(days) !== 1 ? "s" : ""}.</p>;
              return <p className="admin-modal-info">Falta{days === 1 ? "" : "m"} <strong>{days} dia{days !== 1 ? "s" : ""}</strong> para vencer.</p>;
            })()}
            {updateError && <p className="admin-modal-error">{updateError}</p>}
            <button className="admin-modal-confirm" type="button" onClick={confirmUpdate} disabled={updating}>
              {updating ? "Atualizando…" : "Atualizar"}
            </button>
          </div>
        </div>
      )}

      {showResult && updatedVoucher && (
        <div className="admin-modal-backdrop" role="presentation">
          <div className="admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-title">Voucher gerado</h3>
            <code className="admin-modal-code">{updatedVoucher.codigo || "pendente"}</code>
            <div className="admin-result-grid">
              <div className="admin-result-row"><span>Status</span><strong>pendente</strong></div>
              <div className="admin-result-row"><span>Plano</span><strong>{updatedVoucher.tempo_desc || "—"}</strong></div>
              <div className="admin-result-row"><span>Vencimento</span><strong>{fmtDate(updatedVoucher.data_expiracao)}</strong></div>
            </div>
            <button
              className="admin-modal-confirm admin-modal-confirm--ghost"
              type="button"
              onClick={() => { setShowResult(false); setUpdatedVoucher(null); void fetchVouchers(query); }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
