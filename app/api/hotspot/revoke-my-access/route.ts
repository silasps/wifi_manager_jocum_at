import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../../../utils/supabase/admin";

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

  const admin = createAdminClient();

  let query = admin
    .from("autorizacoes")
    .update({ status: "revogado" })
    .eq("cliente_id", user.id)
    .in("status", ["autorizado", "pendente", "erro", "kick_erro"]);

  if (mac) query = query.eq("mac_address", mac);

  const { error: revokeError } = await query;

  if (revokeError) {
    return NextResponse.json({ error: revokeError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
