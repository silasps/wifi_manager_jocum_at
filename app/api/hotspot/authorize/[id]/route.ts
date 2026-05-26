import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../../utils/supabase/admin";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("autorizacoes")
    .select("status")
    .eq("id", id)
    .single();

  if (error || !data) return NextResponse.json({ error: "não encontrado" }, { status: 404 });

  return NextResponse.json({ status: data.status });
}
