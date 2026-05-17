"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../utils/supabase/client";

type ClientRow = {
  user_id: string;
  nome?: string | null;
  email?: string | null;
  categoria?: string | null;
  papel?: string | null;
  ativo?: boolean | null;
};

export default function AdminPage() {
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
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
      await fetchClients("", session.access_token);
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

  const handleSearch = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchClients(value), 350);
  };

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <a href="/home" className="admin-back">‹ Início</a>
        <h1>Gestão de clientes</h1>
      </header>

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
          {clients.map((c) => (
            <a key={c.user_id} href={`/admin/${c.user_id}`} className="admin-client-row">
              <div className="admin-client-info">
                <strong>{c.nome || "Sem nome"}</strong>
                <span>{c.email || "—"}</span>
              </div>
              <div className="admin-client-tags">
                {c.categoria && <span className="admin-tag">{c.categoria}</span>}
                {c.papel && c.papel !== "user" && (
                  <span className="admin-tag admin-tag--role">{c.papel}</span>
                )}
                {c.ativo === false && (
                  <span className="admin-tag admin-tag--inactive">Inativo</span>
                )}
              </div>
              <span className="admin-chevron">›</span>
            </a>
          ))}
        </div>
      )}
    </main>
  );
}
