import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../../utils/supabase/admin";

async function requireAdmin(request: Request) {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) return null;

  const admin = createAdminClient();
  const { data: { user }, error } = await admin.auth.getUser(token);
  if (error || !user) return null;

  const { data: cliente } = await admin
    .from("clientes")
    .select("papel")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!cliente?.papel || cliente.papel === "user") return null;
  return user;
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const body = (await request.json()) as { tempo_desc?: string; status?: string };
  if (!body.tempo_desc || !body.status) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("vouchers")
    .update({ tempo_desc: body.tempo_desc, status: body.status })
    .eq("id", params.id);

  if (error) return NextResponse.json({ error: "Erro ao atualizar voucher." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
