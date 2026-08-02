"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../utils/supabase/client";

type Detectado = {
  mac_address: string;
  hostname: string | null;
  last_seen: string;
};

type Confiavel = {
  id: string;
  mac_address: string;
  nome: string | null;
  criado_em: string;
};

function fmtDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

const cardStyle: React.CSSProperties = {
  background: "#1e293b", borderRadius: 12, padding: "12px 16px",
  display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
};

const btnStyle: React.CSSProperties = {
  borderRadius: 8, padding: "6px 12px", border: "none", cursor: "pointer",
  fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap",
};

export default function DispositivosPage() {
  const [detectados, setDetectados] = useState<Detectado[]>([]);
  const [confiaveis, setConfiaveis] = useState<Confiavel[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [nomeDraft, setNomeDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function getToken() {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? null;
  }

  async function fetchDados() {
    setLoading(true);
    setError(null);
    const token = await getToken();
    if (!token) { setLoading(false); return; }

    const res = await fetch("/api/admin/dispositivos", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const json = (await res.json()) as { detectados: Detectado[]; confiaveis: Confiavel[] };
      setDetectados(json.detectados);
      setConfiaveis(json.confiaveis);
    } else {
      setError("Erro ao carregar dispositivos.");
    }
    setLoading(false);
  }

  useEffect(() => { void fetchDados(); }, []);

  async function handleConfiar(mac: string) {
    setBusy(mac);
    setError(null);
    const token = await getToken();
    if (!token) { setBusy(null); return; }

    const res = await fetch("/api/admin/dispositivos", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ mac_address: mac, nome: nomeDraft[mac] || null }),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Erro ao autorizar dispositivo.");
    }
    setBusy(null);
    void fetchDados();
  }

  async function handleRemover(mac: string) {
    if (!confirm("Remover confiança e desconectar este dispositivo?")) return;
    setBusy(mac);
    setError(null);
    const token = await getToken();
    if (!token) { setBusy(null); return; }

    const res = await fetch(`/api/admin/dispositivos/${encodeURIComponent(mac)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Erro ao remover dispositivo.");
    }
    setBusy(null);
    void fetchDados();
  }

  return (
    <main className="admin-page">
      <header className="admin-nav">
        <a href="/admin" className="admin-nav-back">‹ Início</a>
        <div className="admin-nav-tabs">
          <a href="/admin" className="admin-nav-tab">Clientes</a>
          <a href="/admin/vouchers" className="admin-nav-tab">Vouchers</a>
          <a href="/admin/financeiro" className="admin-nav-tab">Financeiro</a>
          <span className="admin-nav-tab active">Dispositivos</span>
        </div>
      </header>

      <p style={{ color: "#71717a", fontSize: "0.8rem", lineHeight: 1.5, margin: "4px 0 20px" }}>
        Câmeras, Echo Dot, lâmpadas e outros aparelhos sem navegador não conseguem abrir o portal cativo.
        Marque-os como confiáveis abaixo — o agent libera e mantém o acesso liberado automaticamente, sem expirar.
      </p>

      {error && <p style={{ color: "#f87171", fontSize: "0.85rem", marginBottom: 16 }}>{error}</p>}

      <section style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Confiáveis</h2>
          <span style={{
            background: "#166534", color: "#86efac", borderRadius: 12,
            padding: "2px 10px", fontSize: "0.75rem", fontWeight: 600,
          }}>
            {confiaveis.length}
          </span>
        </div>

        {loading ? (
          <p style={{ color: "#94a3b8", fontSize: "0.85rem" }}>Carregando...</p>
        ) : confiaveis.length === 0 ? (
          <p style={{ color: "#64748b", fontSize: "0.85rem" }}>Nenhum dispositivo confiável cadastrado.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {confiaveis.map((d) => (
              <div key={d.mac_address} style={cardStyle}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 500 }}>
                    {d.nome || "Sem nome"}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748b" }}>
                    MAC: {d.mac_address} · desde {fmtDate(d.criado_em)}
                  </p>
                </div>
                <button
                  onClick={() => void handleRemover(d.mac_address)}
                  disabled={busy === d.mac_address}
                  style={{ ...btnStyle, background: "#7f1d1d", color: "#fca5a5", opacity: busy === d.mac_address ? 0.5 : 1 }}
                >
                  {busy === d.mac_address ? "Removendo..." : "Remover"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <h2 style={{ fontSize: "1.05rem", margin: 0 }}>Detectados (não autorizados)</h2>
          <span style={{
            background: "#334155", color: "#e2e8f0", borderRadius: 12,
            padding: "2px 10px", fontSize: "0.75rem", fontWeight: 600,
          }}>
            {detectados.length}
          </span>
        </div>

        {loading ? (
          <p style={{ color: "#94a3b8", fontSize: "0.85rem" }}>Carregando...</p>
        ) : detectados.length === 0 ? (
          <p style={{ color: "#64748b", fontSize: "0.85rem" }}>
            Nenhum dispositivo não autorizado visto nos últimos 30 minutos.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {detectados.map((d) => (
              <div key={d.mac_address} style={cardStyle}>
                <div style={{ flex: 1, minWidth: 160 }}>
                  <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 500 }}>
                    {d.hostname || "Sem hostname (típico de câmera/IoT genérica)"}
                  </p>
                  <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748b" }}>
                    MAC: {d.mac_address} · visto {fmtDate(d.last_seen)}
                  </p>
                </div>
                <input
                  type="text"
                  placeholder="Nome (ex: Câmera portaria)"
                  value={nomeDraft[d.mac_address] || ""}
                  onChange={(e) => setNomeDraft((s) => ({ ...s, [d.mac_address]: e.target.value }))}
                  style={{
                    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 8, padding: "6px 10px", color: "#fff", fontSize: "0.8rem",
                    outline: "none", minWidth: 160,
                  }}
                />
                <button
                  onClick={() => void handleConfiar(d.mac_address)}
                  disabled={busy === d.mac_address}
                  style={{ ...btnStyle, background: "#166534", color: "#86efac", opacity: busy === d.mac_address ? 0.5 : 1 }}
                >
                  {busy === d.mac_address ? "Autorizando..." : "Confiar permanentemente"}
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
