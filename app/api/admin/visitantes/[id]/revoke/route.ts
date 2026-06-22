import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../../../utils/supabase/admin";
import { requireAdmin } from "../../../../../../utils/supabase/requireAdmin";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const { id } = await params;
  if (!id) return NextResponse.json({ error: "ID obrigatório" }, { status: 400 });

  const admin = createAdminClient();

  const { data: visitor, error: fetchError } = await admin
    .from("visitantes_free")
    .select("id, mac_address")
    .eq("id", id)
    .single();

  if (fetchError || !visitor) {
    return NextResponse.json({ error: "Visitante não encontrado" }, { status: 404 });
  }

  const guestUserId = process.env.GUEST_USER_ID;
  if (!guestUserId) {
    return NextResponse.json({ error: "GUEST_USER_ID não configurado" }, { status: 500 });
  }

  const { error: revokeError } = await admin
    .from("autorizacoes")
    .update({ status: "revogado" })
    .eq("mac_address", visitor.mac_address)
    .eq("cliente_id", guestUserId)
    .in("status", ["autorizado", "pendente"]);

  if (revokeError) {
    return NextResponse.json({ error: revokeError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
