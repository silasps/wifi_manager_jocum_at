import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../utils/supabase/admin";
import { requireAdmin } from "../../../../utils/supabase/requireAdmin";

export async function GET(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Configuração incompleta." }, { status: 500 });
  }
  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const admin = createAdminClient();

  // Fetch all clients and all vouchers in parallel
  const [{ data: allClients, error: ce }, { data: vouchers, error: ve }] = await Promise.all([
    admin.from("clientes").select("user_id"),
    admin.from("vouchers").select("cliente_id, data_expiracao, codigo, created_at"),
  ]);

  if (ce || ve) return NextResponse.json({ error: "Erro ao buscar stats." }, { status: 500 });

  const twoDays = 172800000;
  const now = Date.now();

  // Build map of cliente_id -> last voucher (most recent by created_at)
  const lastByClient: Record<string, { data_expiracao: string | null; codigo: string | null; created_at: string | null }> = {};
  for (const v of (vouchers ?? [])) {
    const cid = v.cliente_id as string;
    if (!cid) continue;
    const existing = lastByClient[cid];
    if (!existing) { lastByClient[cid] = v; continue; }
    const newTs = v.created_at ? new Date(v.created_at).getTime() : 0;
    const oldTs = existing.created_at ? new Date(existing.created_at).getTime() : 0;
    if (newTs > oldTs) lastByClient[cid] = v;
  }

  function vStatus(v: { data_expiracao: string | null }): "ativo" | "vencendo" | "inativo" {
    const exp = v.data_expiracao ? new Date(v.data_expiracao).getTime() : null;
    if (!exp) return "inativo";
    if (exp <= now) return "inativo";
    if (exp <= now + twoDays) return "vencendo";
    return "ativo";
  }

  let ativos = 0, vencendo = 0, inativos = 0;
  for (const c of (allClients ?? [])) {
    const lastV = lastByClient[c.user_id];
    if (!lastV) { inativos++; continue; }
    const s = vStatus(lastV);
    if (s === "ativo") ativos++;
    else if (s === "vencendo") vencendo++;
    else inativos++;
  }

  return NextResponse.json({
    counts: { ativos, vencendo, inativos },
    lastVoucherByClient: lastByClient,
  });
}
