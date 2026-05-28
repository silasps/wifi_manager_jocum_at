import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(request: Request) {
  let body: { email?: string; password?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Corpo inválido" }, { status: 400 }); }

  const { email, password } = body;
  if (!email || !password) return NextResponse.json({ error: "Email e senha obrigatórios" }, { status: 400 });

  // Roda no servidor Vercel (tem internet), evitando bloqueio do portal cativo no browser
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const { data, error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

  if (error || !data.session) {
    const code = error?.message?.toLowerCase().includes("invalid") ? "invalid_credentials" : "auth_error";
    return NextResponse.json({ error: error?.message ?? "Falha na autenticação", code }, { status: 401 });
  }

  return NextResponse.json({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_at: data.session.expires_at,
  });
}
