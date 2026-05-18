import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../../utils/supabase/admin";
import { requireAdmin } from "../../../../../utils/supabase/requireAdmin";

function missingKey() {
  return NextResponse.json(
    { error: "Configuração do servidor incompleta: SUPABASE_SERVICE_ROLE_KEY ausente." },
    { status: 500 },
  );
}

export async function GET(
  request: Request,
  { params }: { params: { id: string } },
) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return missingKey();

  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const admin = createAdminClient();
  const { id } = params;

  const [
    { data: cliente, error: ce },
    { data: vouchers },
    { data: financas },
  ] = await Promise.all([
    admin.from("clientes").select("*").eq("user_id", id).maybeSingle(),
    admin.from("vouchers").select("*").eq("cliente_id", id).order("data_expiracao", { ascending: false }),
    admin.from("financas").select("*").eq("cliente_id", id).order("created_at", { ascending: false }),
  ]);

  if (ce || !cliente) return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });

  return NextResponse.json({ cliente, vouchers: vouchers ?? [], financas: financas ?? [] });
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } },
) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return missingKey();

  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const body = (await request.json()) as { papel?: string };
  if (!body.papel) return NextResponse.json({ error: "Campo papel é obrigatório." }, { status: 400 });

  const admin = createAdminClient();
  const { error } = await admin
    .from("clientes")
    .update({ papel: body.papel })
    .eq("user_id", params.id);

  if (error) return NextResponse.json({ error: "Erro ao atualizar papel." }, { status: 500 });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  { params }: { params: { id: string } },
) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return missingKey();

  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const admin = createAdminClient();
  const { id } = params;

  // Delete related records first, then the client row, then the auth user
  await admin.from("financas").delete().eq("cliente_id", id);
  await admin.from("vouchers").delete().eq("cliente_id", id);
  await admin.from("clientes").delete().eq("user_id", id);
  const { error } = await admin.auth.admin.deleteUser(id);

  if (error) return NextResponse.json({ error: "Erro ao excluir usuário." }, { status: 500 });

  return NextResponse.json({ ok: true });
}
