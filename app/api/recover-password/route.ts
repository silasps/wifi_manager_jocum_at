import { NextResponse } from "next/server";
import { createAdminClient } from "../../../utils/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() ?? "";

  if (!email) {
    return NextResponse.json({ error: "Email não informado." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("clientes")
    .select("senha")
    .eq("email", email)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: "Erro ao buscar cadastro." }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ error: "Nenhum cadastro encontrado com este email." }, { status: 404 });
  }

  return NextResponse.json({ senha: data.senha });
}
