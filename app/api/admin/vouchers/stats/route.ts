import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../../utils/supabase/admin";
import { requireAdmin } from "../../../../../utils/supabase/requireAdmin";

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
