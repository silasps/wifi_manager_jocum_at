import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../../../utils/supabase/admin";

const PIN_REGEX = /^\d{6}$/;
const PIN_MAX_AGE_MINUTES = 10;

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return NextResponse.json({ error: "Faça login para conectar a TV." }, { status: 401 });
  }

  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ error: "Sessão expirada. Faça login novamente." }, { status: 401 });
  }

  let body: { pin?: string };
  try { body = await request.json(); } catch {
    return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
  }

  const pin = body.pin?.replace(/\D/g, "");
  if (!pin || !PIN_REGEX.test(pin)) {
    return NextResponse.json({ error: "Código inválido. Digite os 6 números da TV." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: tvPin } = await admin
    .from("tv_pins")
    .select("id, mac_address, created_at")
    .eq("pin", pin)
    .maybeSingle();

  if (!tvPin) {
    return NextResponse.json(
      { error: "Código não encontrado. Verifique os números na tela da TV." },
      { status: 404 },
    );
  }

  const ageMinutes = (Date.now() - new Date(tvPin.created_at).getTime()) / 60000;
  if (ageMinutes > PIN_MAX_AGE_MINUTES) {
    await admin.from("tv_pins").delete().eq("id", tvPin.id);
    return NextResponse.json(
      { error: "Código expirado. Desconecte e reconecte a TV ao Wi-Fi para gerar um novo." },
      { status: 410 },
    );
  }

  const mac = tvPin.mac_address;

  type VRow = { id: string; data_expiracao: string | null; tempo_desc: string | null };
  const { data: allVouchers } = await admin
    .from("vouchers")
    .select("id, data_expiracao, tempo_desc")
    .eq("cliente_id", user.id)
    .in("status", ["criado", "Quase venc."])
    .order("data_expiracao", { ascending: false })
    .limit(10);

  const now = Date.now();
  const voucher = (allVouchers as VRow[] | null)?.find((v) =>
    v.tempo_desc?.toLowerCase() === "ilimitado" ||
    (v.data_expiracao && new Date(v.data_expiracao).getTime() > now),
  );

  if (!voucher) {
    return NextResponse.json(
      { error: "Você não tem um plano ativo. Renove para conectar a TV." },
      { status: 403 },
    );
  }

  const isIlimitado = voucher.tempo_desc?.toLowerCase() === "ilimitado";
  const minutosRestantes = isIlimitado
    ? 14400
    : Math.max(1, Math.floor((new Date(voucher.data_expiracao!).getTime() - Date.now()) / 60000));

  const { data: existing } = await admin
    .from("autorizacoes")
    .select("id, status")
    .eq("cliente_id", user.id)
    .eq("mac_address", mac)
    .eq("status", "autorizado")
    .limit(1);

  if (existing && existing.length > 0) {
    await admin.from("tv_pins").delete().eq("id", tvPin.id);
    return NextResponse.json({ status: "autorizado", auth_id: existing[0].id });
  }

  const { data: inserted, error: insertError } = await admin
    .from("autorizacoes")
    .insert({ cliente_id: user.id, mac_address: mac, minutos: minutosRestantes, status: "pendente" })
    .select("id")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  await admin.from("tv_pins").delete().eq("id", tvPin.id);

  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 3000));
    const { data: check } = await admin
      .from("autorizacoes")
      .select("status")
      .eq("id", inserted.id)
      .single();
    if (check?.status === "autorizado") {
      return NextResponse.json({ status: "autorizado", auth_id: inserted.id });
    }
    if (check?.status === "erro") {
      return NextResponse.json({ status: "erro", auth_id: inserted.id });
    }
  }

  return NextResponse.json({ status: "pendente", auth_id: inserted.id });
}
