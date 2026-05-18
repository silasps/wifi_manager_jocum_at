"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../utils/supabase/client";

const twoDays = 172800000;

type ClientRow = {
  user_id: string;
  nome?: string | null;
  email?: string | null;
  categoria?: string | null;
  papel?: string | null;
  ativo?: boolean | null;
};

type LastVoucher = {
  status?: string | null;
  data_expiracao?: string | null;
  codigo?: string | null;
  created_at?: string | null;
};

type Stats = {
  counts: { ativos: number; vencendo: number; inativos: number };
  lastVoucherByClient: Record<string, LastVoucher>;
};

function voucherStatus(v: LastVoucher): "ativo" | "vencendo" | "inativo" {
  const exp = v.data_expiracao ? new Date(v.data_expiracao).getTime() : null;
  if (!exp) return "inativo";
  const now = Date.now();
  if (exp <= now) return "inativo";
  if (exp <= now + twoDays) return "vencendo";
  return "ativo";
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(d);
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

    const cx = size / 2;
    const cy = size / 2;
    const r = 46;
    const inner = 30;
    const gap = 0.03;

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

export default function AdminPage() {
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [chartFilter, setChartFilter] = useState<"ativo" | "vencendo" | "inativo" | null>(null);
  const tokenRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      await Promise.all([
        fetchClients("", session.access_token),
        fetchStats(session.access_token),
      ]);
    }
    void init();
  }, []);

  const fetchClients = async (q: string, token?: string) => {
    const t = token ?? tokenRef.current;
    if (!t) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/clients?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const data = (await res.json()) as { clients?: ClientRow[]; error?: string };
      if (data.error) { setMessage(data.error); } else { setClients(data.clients ?? []); }
    } catch {
      setMessage("Erro ao buscar clientes.");
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async (token: string) => {
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as Stats & { error?: string };
      if (!data.error) setStats(data);
    } catch {
      // stats are optional, don't block
    }
  };

  const handleSearch = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchClients(value), 350);
  };

  const counts = stats?.counts ?? { ativos: 0, vencendo: 0, inativos: 0 };

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <a href="/home" className="admin-back">‹ Início</a>
        <h1>Gestão de clientes</h1>
        <a href="/admin/vouchers" className="admin-topbar-link">Vouchers</a>
      </header>

      {stats && (
        <div className="admin-donut-section">
          <DonutChart
            ativos={counts.ativos} vencendo={counts.vencendo} inativos={counts.inativos}
            filter={chartFilter} onFilter={setChartFilter}
          />
        </div>
      )}

      <div className="admin-search-wrap">
        <input
          type="search"
          className="admin-search-input"
          placeholder="Buscar por nome ou e-mail…"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          autoFocus
        />
      </div>

      {message && <p className="admin-message">{message}</p>}

      {loading ? (
        <p className="admin-loading">Buscando…</p>
      ) : clients.length === 0 ? (
        <p className="admin-empty">Nenhum cliente encontrado.</p>
      ) : (
        <div className="admin-client-list">
          {clients
            .filter((c) => {
              if (!chartFilter) return true;
              const lastV = stats?.lastVoucherByClient[c.user_id] ?? null;
              const vs = lastV ? voucherStatus(lastV) : "inativo";
              return vs === chartFilter;
            })
            .map((c) => {
              const lastV = stats?.lastVoucherByClient[c.user_id] ?? null;
              const vs = lastV ? voucherStatus(lastV) : null;
              const isExpired = lastV && vs === "inativo" && lastV.data_expiracao && new Date(lastV.data_expiracao).getTime() <= Date.now();
              return (
                <a key={c.user_id} href={`/admin/${c.user_id}`} className="admin-client-row">
                  <div className="admin-client-info">
                    <strong>{c.nome || "Sem nome"}</strong>
                    <span>{c.email || "—"}</span>
                    {lastV && (
                      <span className="admin-client-voucher">
                        <span
                          className={`voucher-status-dot ${vs === "ativo" ? "green" : vs === "vencendo" ? "yellow" : "red"}`}
                          style={{ width: 7, height: 7, display: "inline-block", borderRadius: "50%", marginRight: 4 }}
                        />
                        {lastV.codigo || "sem código"} · {isExpired ? `vencido ${fmtDate(lastV.data_expiracao)}` : `vence ${fmtDate(lastV.data_expiracao)}`}
                      </span>
                    )}
                  </div>
                  <div className="admin-client-tags">
                    {c.categoria && <span className="admin-tag">{c.categoria}</span>}
                    {c.papel && c.papel !== "user" && (
                      <span className="admin-tag admin-tag--role">{c.papel}</span>
                    )}
                    {vs === "ativo" && <span className="admin-tag admin-tag--active">Ativo</span>}
                    {vs === "vencendo" && <span className="admin-tag admin-tag--warn">Vencendo</span>}
                    {vs === "inativo" && <span className="admin-tag admin-tag--inactive">Inativo</span>}
                    {vs === null && c.ativo === false && (
                      <span className="admin-tag admin-tag--inactive">Inativo</span>
                    )}
                  </div>
                  <span className="admin-chevron">›</span>
                </a>
              );
            })}
        </div>
      )}
    </main>
  );
}
