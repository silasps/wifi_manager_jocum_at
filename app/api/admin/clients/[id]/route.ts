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

  const body = (await request.json()) as { papel?: string; tipo_plano?: string; senha?: string };
  if (!body.papel && !body.tipo_plano && !body.senha) {
    return NextResponse.json({ error: "Informe ao menos um campo para atualizar." }, { status: 400 });
  }

  const admin = createAdminClient();

  if (body.senha) {
    if (body.senha.length < 6) {
      return NextResponse.json({ error: "A senha deve ter pelo menos 6 caracteres." }, { status: 400 });
    }
    const { error: authErr } = await admin.auth.admin.updateUserById(params.id, { password: body.senha });
    if (authErr) return NextResponse.json({ error: "Erro ao redefinir senha no Auth." }, { status: 500 });
    const { error: dbErr } = await admin.from("clientes").update({ senha: body.senha }).eq("user_id", params.id);
    if (dbErr) return NextResponse.json({ error: "Senha atualizada no Auth, mas falhou ao salvar no cadastro." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const patch: { papel?: string; tipo_plano?: string } = {};
  if (body.papel) patch.papel = body.papel;
  if (body.tipo_plano) patch.tipo_plano = body.tipo_plano;

  const { error } = await admin
    .from("clientes")
    .update(patch)
    .eq("user_id", params.id);

  if (error) return NextResponse.json({ error: "Erro ao atualizar." }, { status: 500 });

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
