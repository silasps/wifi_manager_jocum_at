import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../../../utils/supabase/admin";

export async function GET(request: Request) {
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

  const { data: byId, error } = await admin
    .from("clientes")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let cliente = byId?.[0] ?? null;

  if (!cliente && user.email) {
    const { data: byEmail } = await admin
      .from("clientes")
      .select("*")
      .eq("email", user.email)
      .order("created_at", { ascending: false })
      .limit(1);
    cliente = byEmail?.[0] ?? null;
  }

  if (!cliente) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json(cliente);
}
