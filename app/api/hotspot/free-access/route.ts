import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../utils/supabase/admin";

const MAC_REGEX = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;
const PHONE_REGEX = /^\+?55?\d{10,11}$/;

function normalizarTelefone(tel: string): string {
  const digits = tel.replace(/\D/g, "");
  return digits.startsWith("55") ? `+${digits}` : `+55${digits}`;
}

export async function POST(request: Request) {
  let body: { mac?: string; telefone?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
  }

  const mac = body.mac?.toLowerCase().trim();
  if (!mac || !MAC_REGEX.test(mac)) {
    return NextResponse.json({ error: "MAC inválido" }, { status: 400 });
  }

  const rawPhone = body.telefone?.replace(/\D/g, "") ?? "";
  if (!rawPhone || rawPhone.length < 10) {
    return NextResponse.json({ error: "WhatsApp obrigatório" }, { status: 400 });
  }
  const telefone = normalizarTelefone(rawPhone);

  const guestUserId = process.env.GUEST_USER_ID;
  if (!guestUserId) {
    return NextResponse.json({ error: "GUEST_USER_ID não configurado" }, { status: 500 });
  }

  const admin = createAdminClient();

  // Checar autorização já ativa para este MAC
  const { data: activeAuth } = await admin
    .from("autorizacoes")
    .select("id, status")
    .eq("mac_address", mac)
    .eq("cliente_id", guestUserId)
    .eq("status", "autorizado")
    .limit(1);

  if (activeAuth && activeAuth.length > 0) {
    return NextResponse.json({ status: "autorizado", auth_id: activeAuth[0].id });
  }

  // Checar autorização pendente para este MAC
  const { data: pendingAuth } = await admin
    .from("autorizacoes")
    .select("id, status")
    .eq("mac_address", mac)
    .eq("cliente_id", guestUserId)
    .eq("status", "pendente")
    .limit(1);

  if (pendingAuth && pendingAuth.length > 0) {
    return NextResponse.json({ status: "pendente", auth_id: pendingAuth[0].id });
  }

  // Salvar/atualizar telefone na tabela visitantes_free
  const { data: existingVisitor } = await admin
    .from("visitantes_free")
    .select("id")
    .eq("mac_address", mac)
    .limit(1);

  if (existingVisitor && existingVisitor.length > 0) {
    await admin
      .from("visitantes_free")
      .update({ telefone, criado_em: new Date().toISOString(), migrou_pago: false })
      .eq("id", existingVisitor[0].id);
  } else {
    await admin
      .from("visitantes_free")
      .insert({ mac_address: mac, telefone });
  }

  // Buscar voucher ativo do guest
  type VRow = { id: string; status: string; tempo_desc: string | null };
  const { data: vouchers } = await admin
    .from("vouchers")
    .select("id, status, tempo_desc")
    .eq("cliente_id", guestUserId)
    .in("status", ["criado", "Quase venc."])
    .limit(1) as { data: VRow[] | null };

  const activeVoucher = vouchers?.find(
    (v) => v.tempo_desc?.toLowerCase() === "ilimitado",
  );

  if (!activeVoucher) {
    // Checar se já existe voucher pendente
    const { data: pendingVouchers } = await admin
      .from("vouchers")
      .select("id")
      .eq("cliente_id", guestUserId)
      .eq("status", "pendente")
      .limit(1);

    if (!pendingVouchers || pendingVouchers.length === 0) {
      await admin.from("vouchers").insert({
        cliente_id: guestUserId,
        status: "pendente",
        tempo_desc: "ilimitado",
        quota: 6,
      });
    }

    return NextResponse.json({ status: "pending-voucher" });
  }

  // Criar autorização pendente (24h)
  const { data: inserted, error: insertError } = await admin
    .from("autorizacoes")
    .insert({
      cliente_id: guestUserId,
      mac_address: mac,
      minutos: 1440,
      status: "pendente",
    })
    .select("id")
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Server-side polling: aguarda o agent processar (até 45s)
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
