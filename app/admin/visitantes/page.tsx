"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../../utils/supabase/client";

type Visitante = {
  id: string;
  mac_address: string;
  telefone: string;
  criado_em: string;
  migrou_pago: boolean;
};

function fmtDate(value: string) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function fmtPhone(tel: string) {
  const d = tel.replace(/^\+55/, "").replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d[2]} ${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return tel;
}

function whatsappUrl(tel: string) {
  const digits = tel.replace(/\D/g, "");
  const num = digits.startsWith("55") ? digits : `55${digits}`;
  const msg = encodeURIComponent(
    "Olá! Vi que você está usando o Wi-Fi gratuito da JOCUM AT. " +
    "Quer conhecer nossos planos de internet rápida com streaming, " +
    "videochamadas e muito mais? Acesse: https://wifi-manager-react.vercel.app",
  );
  return `https://wa.me/${num}?text=${msg}`;
}

export default function VisitantesPage() {
  const [visitantes, setVisitantes] = useState<Visitante[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "active">("active");
  const [revoking, setRevoking] = useState<string | null>(null);

  async function fetchVisitantes() {
    setLoading(true);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setLoading(false); return; }

    const res = await fetch(`/api/admin/visitantes?filter=${filter}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.ok) {
      const json = await res.json() as { visitantes: Visitante[] };
      setVisitantes(json.visitantes);
    }
    setLoading(false);
  }

  useEffect(() => { void fetchVisitantes(); }, [filter]);

  async function handleRevoke(id: string) {
    if (!confirm("Revogar acesso free deste visitante?")) return;
    setRevoking(id);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setRevoking(null); return; }

    await fetch(`/api/admin/visitantes/${id}/revoke`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    setRevoking(null);
    void fetchVisitantes();
  }

  return (
    <main style={{ maxWidth: 700, margin: "0 auto", padding: "1.5rem 1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <a href="/admin" style={{ color: "#94a3b8", textDecoration: "none", fontSize: "0.9rem" }}>← Admin</a>
        <h1 style={{ fontSize: "1.3rem", margin: 0 }}>Visitantes Free</h1>
        <span style={{
          background: "#334155", color: "#e2e8f0", borderRadius: 12,
          padding: "2px 10px", fontSize: "0.8rem", fontWeight: 600,
        }}>
          {visitantes.length}
        </span>
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          onClick={() => setFilter("active")}
          style={{
            padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
            background: filter === "active" ? "#3b82f6" : "#1e293b",
            color: filter === "active" ? "#fff" : "#94a3b8",
            fontSize: "0.85rem",
          }}
        >
          Não migrados
        </button>
        <button
          onClick={() => setFilter("all")}
          style={{
            padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer",
            background: filter === "all" ? "#3b82f6" : "#1e293b",
            color: filter === "all" ? "#fff" : "#94a3b8",
            fontSize: "0.85rem",
          }}
        >
          Todos
        </button>
      </div>

      {loading ? (
        <p style={{ color: "#94a3b8", textAlign: "center", padding: 32 }}>Carregando...</p>
      ) : visitantes.length === 0 ? (
        <p style={{ color: "#94a3b8", textAlign: "center", padding: 32 }}>Nenhum visitante free encontrado.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {visitantes.map((v) => (
            <div
              key={v.id}
              style={{
                background: "#1e293b", borderRadius: 12, padding: "12px 16px",
                display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 160 }}>
                <p style={{ margin: 0, fontSize: "0.95rem", fontWeight: 500 }}>
                  {fmtPhone(v.telefone)}
                </p>
                <p style={{ margin: "2px 0 0", fontSize: "0.75rem", color: "#64748b" }}>
                  MAC: {v.mac_address} · {fmtDate(v.criado_em)}
                </p>
              </div>

              {v.migrou_pago && (
                <span style={{
                  background: "#166534", color: "#86efac", borderRadius: 8,
                  padding: "2px 8px", fontSize: "0.7rem", fontWeight: 600,
                }}>
                  Migrou
                </span>
              )}

              <a
                href={whatsappUrl(v.telefone)}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  background: "#22c55e", color: "#fff", borderRadius: 8,
                  padding: "6px 12px", textDecoration: "none", fontSize: "0.8rem",
                  fontWeight: 600, whiteSpace: "nowrap",
                }}
              >
                WhatsApp
              </a>

              {!v.migrou_pago && (
                <button
                  onClick={() => void handleRevoke(v.id)}
                  disabled={revoking === v.id}
                  style={{
                    background: "#7f1d1d", color: "#fca5a5", borderRadius: 8,
                    padding: "6px 12px", border: "none", cursor: "pointer",
                    fontSize: "0.8rem", fontWeight: 600, whiteSpace: "nowrap",
                    opacity: revoking === v.id ? 0.5 : 1,
                  }}
                >
                  {revoking === v.id ? "Revogando..." : "Revogar"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
