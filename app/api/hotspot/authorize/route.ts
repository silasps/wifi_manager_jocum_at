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

  // Busca todos os vouchers ativos (criado/quase venc.) e filtra em JS
  // para evitar problemas com .or() do PostgREST em timestamps com null
  const { data: allVouchers, error: voucherError } = await admin
    .from("vouchers")
    .select("id, data_expiracao, tempo_desc")
    .eq("cliente_id", user.id)
    .in("status", ["criado", "Quase venc."])
    .order("data_expiracao", { ascending: false })
    .limit(10);

  if (voucherError) return NextResponse.json({ error: voucherError.message }, { status: 500 });

  const now = Date.now();
  type VRow = { id: string; data_expiracao: string | null; tempo_desc: string | null };
  const voucher = (allVouchers as VRow[] | null)?.find((v) =>
    v.tempo_desc?.toLowerCase() === "ilimitado" ||
    (v.data_expiracao && new Date(v.data_expiracao).getTime() > now),
  );

  if (!voucher) {
    return NextResponse.json({ error: "Sem voucher ativo" }, { status: 403 });
  }

  const isIlimitado = voucher.tempo_desc?.toLowerCase() === "ilimitado";
  const minutosRestantes = isIlimitado
    ? 14400  // 10 dias; re-autoriza automaticamente na próxima conexão
    : Math.max(1, Math.floor((new Date(voucher.data_expiracao!).getTime() - Date.now()) / 60000));

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

  // Server-side polling: aguarda o agent processar (até 45s)
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const { data: check } = await admin
      .from("autorizacoes")
      .select("status")
      .eq("id", inserted.id)
      .single();
    if (check?.status === "autorizado") {
      return NextResponse.json({ status: "autorizado", id: inserted.id });
    }
    if (check?.status === "erro") {
      return NextResponse.json({ status: "erro", id: inserted.id });
    }
  }

  return NextResponse.json({ status: "pendente", id: inserted.id });
}
