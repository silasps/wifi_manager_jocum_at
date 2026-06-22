import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../utils/supabase/admin";
import { requireAdmin } from "../../../../utils/supabase/requireAdmin";

export async function GET(request: Request) {
  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const filter = searchParams.get("filter") ?? "all";

  const admin = createAdminClient();
  let query = admin
    .from("visitantes_free")
    .select("id, mac_address, telefone, criado_em, migrou_pago")
    .order("criado_em", { ascending: false });

  if (filter === "active") {
    query = query.eq("migrou_pago", false);
  }

  const { data, error } = await query.limit(200);
  if (error) return NextResponse.json({ error: "Erro ao buscar visitantes." }, { status: 500 });

  return NextResponse.json({ visitantes: data ?? [] });
}
