import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../../utils/supabase/admin";

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

  const admin = createAdminClient();
  const { data: vouchers, error } = await admin
    .from("vouchers")
    .select("data_expiracao");

  if (error) return NextResponse.json({ error: "Erro ao buscar stats." }, { status: 500 });

  const twoDays = 172800000;
  const now = Date.now();
  let ativos = 0, vencendo = 0, inativos = 0;

  for (const v of (vouchers ?? [])) {
    const exp = v.data_expiracao ? new Date(v.data_expiracao).getTime() : null;
    if (!exp || exp <= now) { inativos++; continue; }
    if (exp <= now + twoDays) { vencendo++; continue; }
    ativos++;
  }

  return NextResponse.json({ ativos, vencendo, inativos });
}
