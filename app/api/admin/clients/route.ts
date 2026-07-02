import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../utils/supabase/admin";
import { requireAdmin } from "../../../../utils/supabase/requireAdmin";

function normalize(value: string) {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export async function GET(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Configuração do servidor incompleta: SUPABASE_SERVICE_ROLE_KEY ausente." }, { status: 500 });
  }

  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || "";

  const admin = createAdminClient();

  if (q) {
    // ilike não ignora acentos (ex: busca "debora" não acha "Débora") — filtra em memória
    // comparando nome/email sem diacríticos. Base de clientes é pequena (centenas), então
    // não pesa buscar tudo antes de filtrar.
    const { data, error } = await admin
      .from("clientes")
      .select("user_id, nome, email, categoria, papel, ativo, whatsApp, tipo_plano")
      .order("nome");

    if (error) return NextResponse.json({ error: "Erro ao buscar clientes." }, { status: 500 });

    const needle = normalize(q);
    const clients = (data ?? [])
      .filter((c: { nome: string | null; email: string | null }) => normalize(c.nome || "").includes(needle) || normalize(c.email || "").includes(needle))
      .slice(0, 80);

    return NextResponse.json({ clients });
  }

  const { data, error } = await admin
    .from("clientes")
    .select("user_id, nome, email, categoria, papel, ativo, whatsApp, tipo_plano")
    .order("nome")
    .limit(80);

  if (error) return NextResponse.json({ error: "Erro ao buscar clientes." }, { status: 500 });

  return NextResponse.json({ clients: data ?? [] });
}
