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

  const admin = createAdminClient();

  const { error: revokeError } = await admin
    .from("autorizacoes")
    .update({ status: "revogado" })
    .eq("cliente_id", user.id)
    .in("status", ["autorizado", "pendente"]);

  if (revokeError) {
    return NextResponse.json({ error: revokeError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
