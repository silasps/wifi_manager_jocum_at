import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../../../utils/supabase/admin";

const MAC_REGEX = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  let body: { mac?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Invalid body" }, { status: 400 }); }

  const mac = body.mac?.toLowerCase().trim();
  if (!mac || !MAC_REGEX.test(mac)) {
    return NextResponse.json({ error: "MAC inválido" }, { status: 400 });
  }

  const admin = createAdminClient();

  // Busca voucher ativo (criado + não expirado)
  const now = new Date().toISOString();
  const { data: vouchers, error: voucherError } = await admin
    .from("vouchers")
    .select("id, data_expiracao")
    .eq("cliente_id", user.id)
    .eq("status", "criado")
    .gt("data_expiracao", now)
    .order("data_expiracao", { ascending: false })
    .limit(1);

  if (voucherError) return NextResponse.json({ error: voucherError.message }, { status: 500 });
  if (!vouchers || vouchers.length === 0) {
    return NextResponse.json({ error: "Sem voucher ativo" }, { status: 403 });
  }

  const voucher = vouchers[0];
  const minutosRestantes = Math.max(
    1,
    Math.floor((new Date(voucher.data_expiracao).getTime() - Date.now()) / 60000),
  );

  // Verifica se já existe autorização ativa para este MAC
  const { data: existing } = await admin
    .from("autorizacoes")
    .select("id, status")
    .eq("cliente_id", user.id)
    .eq("mac_address", mac)
    .eq("status", "autorizado")
    .limit(1);

  if (existing && existing.length > 0) {
    return NextResponse.json({ status: "autorizado", id: existing[0].id });
  }

  // Cria nova autorização pendente
  const { data: inserted, error: insertError } = await admin
    .from("autorizacoes")
    .insert({ cliente_id: user.id, mac_address: mac, minutos: minutosRestantes, status: "pendente" })
    .select("id")
    .single();

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ status: "pendente", id: inserted.id });
}
