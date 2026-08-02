import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../utils/supabase/admin";
import { requireAdmin } from "../../../../utils/supabase/requireAdmin";

const MAC_REGEX = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;

export async function GET(request: Request) {
  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const admin = createAdminClient();

  const { data: confiaveis, error: confiaveisError } = await admin
    .from("dispositivos_confiaveis")
    .select("id, mac_address, nome, criado_em")
    .order("criado_em", { ascending: false });
  if (confiaveisError) return NextResponse.json({ error: "Erro ao buscar dispositivos confiáveis." }, { status: 500 });

  const macsConfiaveis = new Set((confiaveis ?? []).map((d: { mac_address: string }) => d.mac_address));

  const { data: detectados, error: detectadosError } = await admin
    .from("dispositivos_detectados")
    .select("mac_address, hostname, last_seen")
    .order("last_seen", { ascending: false })
    .limit(100);
  if (detectadosError) return NextResponse.json({ error: "Erro ao buscar dispositivos detectados." }, { status: 500 });

  return NextResponse.json({
    confiaveis: confiaveis ?? [],
    detectados: (detectados ?? []).filter((d: { mac_address: string }) => !macsConfiaveis.has(d.mac_address)),
  });
}

export async function POST(request: Request) {
  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  let body: { mac_address?: string; nome?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Corpo inválido." }, { status: 400 }); }

  const mac = body.mac_address?.toLowerCase().trim();
  if (!mac || !MAC_REGEX.test(mac)) {
    return NextResponse.json({ error: "MAC inválido." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("dispositivos_confiaveis")
    .upsert({ mac_address: mac, nome: body.nome?.trim() || null, criado_por: user }, { onConflict: "mac_address" });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Remove da lista de detectados — vira confiável, o agent assume a autorização.
  await admin.from("dispositivos_detectados").delete().eq("mac_address", mac);

  return NextResponse.json({ ok: true });
}
