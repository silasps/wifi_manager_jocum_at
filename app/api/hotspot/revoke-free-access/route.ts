import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../../../utils/supabase/admin";

const GUEST_USER_ID = process.env.GUEST_USER_ID ?? "5b0e3ee1-a588-460e-8572-2c658f52fde2";

export async function POST(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const token = authHeader.replace("Bearer ", "");
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return NextResponse.json({ error: "Invalid token" }, { status: 401 });

  let mac: string | undefined;
  try {
    const body = await request.json();
    mac = typeof body?.mac === "string" ? body.mac.toLowerCase().trim() : undefined;
  } catch {
    mac = undefined;
  }

  if (!mac) {
    // Sem o MAC do dispositivo atual não dá pra saber qual visitante é o "meu" dentro do
    // acesso gratuito compartilhado (GUEST_USER_ID) — não revogamos o acesso de todo mundo.
    return NextResponse.json({ ok: true, skipped: true });
  }

  const admin = createAdminClient();

  const { error: revokeError } = await admin
    .from("autorizacoes")
    .update({ status: "revogado" })
    .eq("cliente_id", GUEST_USER_ID)
    .eq("mac_address", mac)
    .in("status", ["autorizado", "pendente", "erro", "kick_erro"]);

  if (revokeError) {
    return NextResponse.json({ error: revokeError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
