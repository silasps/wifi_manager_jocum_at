import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../../../utils/supabase/admin";

export async function POST(request: Request) {
  let body: { nome?: string; email?: string; password?: string; whatsApp?: string; plano?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Corpo inválido" }, { status: 400 }); }

  const { nome, email, password, whatsApp, plano } = body;
  if (!nome?.trim() || !email?.trim() || !password || !plano) {
    return NextResponse.json({ error: "Dados obrigatórios ausentes" }, { status: 400 });
  }

  const admin = createAdminClient();
  const emailNorm = email.trim().toLowerCase();

  const { data: existing } = await admin
    .from("clientes")
    .select("email")
    .eq("email", emailNorm)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: "Este email já está cadastrado.", code: "email_taken" }, { status: 409 });
  }

  // Cria usuário com email já confirmado (sem precisar clicar no email)
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: emailNorm,
    password,
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
    senha: password,
    papel: "user",
    aceite_de_termo: true,
  });

  if (clientError) {
    await admin.auth.admin.deleteUser(userId);
    return NextResponse.json({ error: "Erro ao criar perfil" }, { status: 500 });
  }

  // Plano gratuito: voucher ilimitado a 0,5 Mbps
  // O agente Python reconhece "ilimitado" e define duration=0 + 500 Kbps no UniFi
  if (plano === "free") {
    await admin.from("vouchers").insert({
      cliente_id: userId,
      status: "pendente",
      tempo_desc: "ilimitado",
      quota: 6,
    });
  }

  // Login imediato para retornar tokens de sessão
  const anonClient = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data: signInData, error: signInError } = await anonClient.auth.signInWithPassword({
    email: emailNorm,
    password,
  });

  if (signInError || !signInData.session) {
    return NextResponse.json(
      { error: "Conta criada com sucesso. Faça login para continuar.", code: "login_after_register" },
      { status: 207 },
    );
  }

  return NextResponse.json({
    access_token: signInData.session.access_token,
    refresh_token: signInData.session.refresh_token,
    plano,
  });
}
