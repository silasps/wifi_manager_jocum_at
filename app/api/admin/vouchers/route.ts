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
    return NextResponse.json({ error: "Configuração incompleta." }, { status: 500 });
  }
  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const q = searchParams.get("q")?.trim() || "";

  const admin = createAdminClient();
  let vQuery = admin
    .from("vouchers")
    .select("id, codigo, status, data_expiracao, tempo_desc, quota, usos, created_at, cliente_id")
    .order("created_at", { ascending: false });

  if (q) {
    vQuery = vQuery.ilike("codigo", `%${q}%`);
  }

  const { data: vouchers, error } = await vQuery.limit(100);
  if (error) return NextResponse.json({ error: "Erro ao buscar vouchers." }, { status: 500 });

  // Fetch client names for the found vouchers
  type VRow = { cliente_id: string | null; [key: string]: unknown };
  const rows = (vouchers ?? []) as VRow[];
  const clientIds = [...new Set(rows.map((v) => v.cliente_id).filter((id): id is string => !!id))];
  const clientMap: Record<string, { user_id: string; nome: string | null; email: string | null }> = {};

  if (clientIds.length > 0) {
    const { data: clients } = await admin
      .from("clientes")
      .select("user_id, nome, email")
      .in("user_id", clientIds);

    for (const c of (clients ?? [])) {
      clientMap[c.user_id] = c;
    }
  }

  const result = rows.map((v) => ({
    ...v,
    cliente: v.cliente_id ? (clientMap[v.cliente_id] ?? null) : null,
  }));

  return NextResponse.json({ vouchers: result });
}
