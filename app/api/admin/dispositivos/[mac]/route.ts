import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../../utils/supabase/admin";
import { requireAdmin } from "../../../../../utils/supabase/requireAdmin";

const MAC_REGEX = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;

export async function DELETE(request: Request, { params }: { params: Promise<{ mac: string }> }) {
  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const { mac: rawMac } = await params;
  const mac = decodeURIComponent(rawMac || "").toLowerCase().trim();
  if (!mac || !MAC_REGEX.test(mac)) {
    return NextResponse.json({ error: "MAC inválido." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { error: deleteError } = await admin
    .from("dispositivos_confiaveis")
    .delete()
    .eq("mac_address", mac);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });

  // Reaproveita o fluxo de revogação já existente (processar_revogacoes no agent)
  // para derrubar de verdade o guest record no MongoDB da UDM.
  const { error: revokeError } = await admin
    .from("autorizacoes")
    .insert({ cliente_id: user, mac_address: mac, minutos: 0, status: "revogado" });
  if (revokeError) return NextResponse.json({ error: revokeError.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
