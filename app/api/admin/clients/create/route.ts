import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../../utils/supabase/admin";
import { requireAdmin } from "../../../../../utils/supabase/requireAdmin";

export async function POST(request: Request) {
  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  let body: { nome?: string; email?: string; senha?: string; whatsApp?: string; tipo?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Corpo inválido" }, { status: 400 }); }

  const { nome, email, senha, whatsApp, tipo } = body;
  if (!nome?.trim() || !email?.trim() || !senha) {
    return NextResponse.json({ error: "Nome, email e senha são obrigatórios." }, { status: 400 });
  }

  const admin = createAdminClient();
  const emailNorm = email.trim().toLowerCase();

  const { data: existing } = await admin
    .from("clientes")
    .select("email")
    .eq("email", emailNorm)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Este email já está cadastrado." }, { status: 409 });
  }

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: emailNorm,
    password: senha,
    email_confirm: true,
  });

  if (authError || !authData.user?.id) {
    return NextResponse.json({ error: authError?.message ?? "Erro ao criar conta" }, { status: 500 });
  }

  const userId = authData.user.id;

  const { error: clientError } = await admin.from("clientes").insert({
    user_id: userId,
    nome: nome.trim(),
    email: emailNorm,
    whatsApp: whatsApp?.trim() ?? "",
    ativo: true,
    categoria: "Obreiro",
    senha,
    papel: "user",
    aceite_de_termo: true,
  });

  if (clientError) {
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: "Erro ao criar perfil: " + clientError.message }, { status: 500 });
  }

  if (tipo === "cortesia") {
    await admin.from("vouchers").insert({
      cliente_id: userId,
      status: "pendente",
      tempo_desc: "ilimitado",
      quota: 6,
    });
  }

  return NextResponse.json({ ok: true, userId });
}
