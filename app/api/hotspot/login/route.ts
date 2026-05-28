import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../../../utils/supabase/admin";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Corpo inválido" }, { status: 400 }); }

  const { email, password } = body;
  if (!email || !password) return NextResponse.json({ error: "Email e senha obrigatórios" }, { status: 400 });

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

  if (!error && data.session) {
    return NextResponse.json({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
    });
  }

  // Tenta auto-confirmar email se o usuário existe no sistema mas o email não foi confirmado
  // (ocorre quando o usuário se cadastrou pelo app mas não clicou no email de confirmação)
  if (error) {
    try {
      const admin = createAdminClient();
      const { data: clientRecord } = await admin
        .from("clientes")
        .select("user_id")
        .eq("email", email.trim().toLowerCase())
        .maybeSingle();

      if (clientRecord?.user_id) {
        await admin.auth.admin.updateUserById(clientRecord.user_id, { email_confirm: true });

        const retry = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (retry.data?.session) {
          return NextResponse.json({
            access_token: retry.data.session.access_token,
            refresh_token: retry.data.session.refresh_token,
            expires_at: retry.data.session.expires_at,
          });
        }
      }
    } catch { /* Se a operação admin falhar, retorna o erro original */ }

    const code = error?.message?.toLowerCase().includes("invalid") ? "invalid_credentials" : "auth_error";
    return NextResponse.json({ error: error?.message ?? "Falha na autenticação", code }, { status: 401 });
  }

  return NextResponse.json({ error: "Falha na autenticação", code: "auth_error" }, { status: 401 });
}
