"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../../../utils/supabase/client";
import type { ResumoMensal, Transacao } from "../../../utils/reports/types";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const pct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1, signDisplay: "always" });

type PorPlano = { plano: string; receita: number; transacoes: number };
type Resumo = {
  receitaMesAtual: number;
  receitaMesAnterior: number;
  variacaoPercentual: number;
  receitaAcumulada: number;
  transacoesTotal: number;
  cortesiasTotal: number;
  ticketMedioGeral: number;
  melhorMes: ResumoMensal | null;
};
type FinanceiroData = {
  periodo: { desde: string; ate: string };
  transacoes: Transacao[];
  porMes: ResumoMensal[];
  porPlano: PorPlano[];
  resumo: Resumo;
};

type PeriodoOpcao = "mes" | "3m" | "12m" | "ano" | "tudo";

const PERIODO_LABELS: Record<PeriodoOpcao, string> = {
  mes: "Este mês",
  "3m": "Últimos 3 meses",
  "12m": "Últimos 12 meses",
  ano: "Ano atual",
  tudo: "Todo o período",
};

function periodoRange(opcao: PeriodoOpcao): { desde: Date; ate: Date } {
  const now = new Date();
  const ate = now;
  if (opcao === "mes") return { desde: new Date(now.getFullYear(), now.getMonth(), 1), ate };
  if (opcao === "3m") return { desde: new Date(now.getFullYear(), now.getMonth() - 2, 1), ate };
  if (opcao === "12m") return { desde: new Date(now.getFullYear(), now.getMonth() - 11, 1), ate };
  if (opcao === "ano") return { desde: new Date(now.getFullYear(), 0, 1), ate };
  return { desde: new Date(2000, 0, 1), ate };
}

function MonthlyRevenueChart({ porMes, melhorMesKey }: { porMes: ResumoMensal[]; melhorMesKey: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth || 600;
    const height = 220;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.height = `${height}px`;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const padding = { top: 12, bottom: 28, left: 8, right: 8 };
    const chartH = height - padding.top - padding.bottom;
    const max = Math.max(1, ...porMes.map((m) => m.receita));
    const n = Math.max(1, porMes.length);
    const gap = 8;
    const barW = Math.max(6, (width - padding.left - padding.right - gap * (n - 1)) / n);

    porMes.forEach((m, i) => {
      const barH = (m.receita / max) * chartH;
      const x = padding.left + i * (barW + gap);
      const y = padding.top + chartH - barH;
      ctx.fillStyle = m.mes === melhorMesKey ? "#4ade80" : "#ef700b";
      ctx.fillRect(x, y, barW, barH);

      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.font = "9px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(m.label, x + barW / 2, height - 12);
    });
  }, [porMes, melhorMesKey]);

  return <canvas ref={canvasRef} style={{ width: "100%", display: "block" }} />;
}

export default function FinanceiroPage() {
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [periodo, setPeriodo] = useState<PeriodoOpcao>("12m");
  const [data, setData] = useState<FinanceiroData | null>(null);
  const tokenRef = useRef<string | null>(null);

  const range = useMemo(() => periodoRange(periodo), [periodo]);

  const load = async (opcao: PeriodoOpcao) => {
    if (!tokenRef.current) return;
    setLoading(true);
    setMessage(null);
    const { desde, ate } = periodoRange(opcao);
    try {
      const res = await fetch(
        `/api/admin/financeiro?desde=${encodeURIComponent(desde.toISOString())}&ate=${encodeURIComponent(ate.toISOString())}`,
        { headers: { Authorization: `Bearer ${tokenRef.current}` } },
      );
      const json = (await res.json()) as FinanceiroData & { error?: string };
      if (!res.ok || json.error) {
        setMessage(json.error || "Erro ao carregar dados financeiros.");
      } else {
        setData(json);
      }
    } catch {
      setMessage("Erro de rede ao carregar dados financeiros.");
    }
    setLoading(false);
  };

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
      await load("12m");
    }
    void init();
  }, []);

  const changePeriodo = (opcao: PeriodoOpcao) => {
    setPeriodo(opcao);
    void load(opcao);
  };

  const periodoLabel = `${range.desde.toLocaleDateString("pt-BR")} – ${range.ate.toLocaleDateString("pt-BR")}`;

  // Import dinâmico: jsPDF/xlsx só são baixados quando o admin realmente clica em exportar,
  // em vez de inflar o bundle inicial da página (~250KB) pra quem só quer ver o dashboard.
  const handleExport = async (formato: "pdf" | "xlsx" | "ofx") => {
    if (!data) return;
    const filenameBase = `financeiro-${range.desde.toISOString().slice(0, 10)}_${range.ate.toISOString().slice(0, 10)}`;
    if (formato === "ofx") {
      const { downloadOfx } = await import("../../../utils/reports/ofx");
      downloadOfx(data.transacoes, range.desde, range.ate, `${filenameBase}.ofx`);
    }
    if (formato === "xlsx") {
      const { downloadXlsx } = await import("../../../utils/reports/xlsx");
      downloadXlsx(data.transacoes, data.porMes, `${filenameBase}.xlsx`);
    }
    if (formato === "pdf") {
      const { downloadPdf } = await import("../../../utils/reports/pdf");
      downloadPdf(data.transacoes, data.porMes, periodoLabel, data.resumo, `${filenameBase}.pdf`);
    }
  };

  return (
    <main className="admin-page">
      <header className="admin-nav">
        <a href="/home" className="admin-nav-back">‹ Início</a>
        <div className="admin-nav-tabs">
          <a href="/admin" className="admin-nav-tab">Clientes</a>
          <a href="/admin/vouchers" className="admin-nav-tab">Vouchers</a>
          <span className="admin-nav-tab active">Financeiro</span>
        </div>
      </header>

      <div className="admin-fin-toolbar">
        <select
          className="admin-select admin-fin-periodo"
          value={periodo}
          onChange={(e) => changePeriodo(e.target.value as PeriodoOpcao)}
        >
          {(Object.keys(PERIODO_LABELS) as PeriodoOpcao[]).map((key) => (
            <option key={key} value={key}>{PERIODO_LABELS[key]}</option>
          ))}
        </select>

        <div className="admin-fin-export-group">
          <button className="admin-fin-export-btn" type="button" disabled={!data} onClick={() => void handleExport("pdf")}>PDF</button>
          <button className="admin-fin-export-btn" type="button" disabled={!data} onClick={() => void handleExport("xlsx")}>Excel</button>
          <button className="admin-fin-export-btn" type="button" disabled={!data} onClick={() => void handleExport("ofx")}>OFX</button>
        </div>
      </div>

      {message && <p className="admin-message">{message}</p>}

      {loading || !data ? (
        <div className="admin-client-list">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="skeleton skeleton-card" />)}
        </div>
      ) : (
        <>
          <div className="admin-fin-tiles">
            <div className="admin-fin-tile">
              <span>Receita do mês</span>
              <strong>{money.format(data.resumo.receitaMesAtual)}</strong>
              <small className={data.resumo.variacaoPercentual >= 0 ? "admin-fin-up" : "admin-fin-down"}>
                {pct.format(data.resumo.variacaoPercentual)}% vs. mês anterior
              </small>
            </div>
            <div className="admin-fin-tile">
              <span>Receita no período</span>
              <strong>{money.format(data.resumo.receitaAcumulada)}</strong>
              <small>{periodoLabel}</small>
            </div>
            <div className="admin-fin-tile">
              <span>Ticket médio</span>
              <strong>{money.format(data.resumo.ticketMedioGeral)}</strong>
              <small>{data.resumo.transacoesTotal} transações pagas</small>
            </div>
            <div className="admin-fin-tile">
              <span>Vouchers cortesia</span>
              <strong>{data.resumo.cortesiasTotal}</strong>
              <small>não somam na receita</small>
            </div>
          </div>

          <section className="admin-section">
            <h2 className="admin-section-title">Receita por mês</h2>
            <MonthlyRevenueChart porMes={data.porMes} melhorMesKey={data.resumo.melhorMes?.mes ?? null} />
          </section>

          <section className="admin-section">
            <h2 className="admin-section-title">Detalhe mensal</h2>
            <div className="admin-scroll-container">
              <table className="admin-fin-table">
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th>Receita</th>
                    <th>Transações</th>
                    <th>Cortesias</th>
                    <th>Ticket médio</th>
                  </tr>
                </thead>
                <tbody>
                  {data.porMes.map((m) => (
                    <tr key={m.mes} className={m.mes === data.resumo.melhorMes?.mes ? "admin-fin-row-best" : ""}>
                      <td>{m.label} {m.mes === data.resumo.melhorMes?.mes && <span className="admin-tag admin-tag--active">Melhor mês</span>}</td>
                      <td>{money.format(m.receita)}</td>
                      <td>{m.transacoes}</td>
                      <td>{m.cortesias}</td>
                      <td>{money.format(m.ticketMedio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="admin-section">
            <h2 className="admin-section-title">Receita por plano</h2>
            <div className="admin-scroll-container">
              <table className="admin-fin-table">
                <thead>
                  <tr><th>Plano</th><th>Receita</th><th>Transações</th></tr>
                </thead>
                <tbody>
                  {data.porPlano.map((p) => (
                    <tr key={p.plano}>
                      <td>{p.plano}</td>
                      <td>{money.format(p.receita)}</td>
                      <td>{p.transacoes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
