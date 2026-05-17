import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../utils/supabase/admin";

async function requireAdmin(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;

  try {
    const admin = createAdminClient();
    const { data: { user }, error } = await admin.auth.getUser(token);
    if (error || !user) return null;

    const { data: cliente } = await admin
      .from("clientes")
      .select("papel")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!cliente?.papel || cliente.papel === "user") return null;
    return user;
  } catch {
    return null;
  }
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
  let query = admin
    .from("clientes")
    .select("user_id, nome, email, categoria, papel, ativo, whatsApp")
    .order("nome");

  if (q) {
    query = query.or(`nome.ilike.%${q}%,email.ilike.%${q}%`);
  }

  const { data, error } = await query.limit(80);
  if (error) return NextResponse.json({ error: "Erro ao buscar clientes." }, { status: 500 });

  return NextResponse.json({ clients: data ?? [] });
}
