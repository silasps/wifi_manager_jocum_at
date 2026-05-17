import { NextResponse } from "next/server";

const DEFAULT_ASAAS_API_URL = "https://api.asaas.com/v3";

function getAsaasApiUrl() {
  return (process.env.ASAAS_API_URL || DEFAULT_ASAAS_API_URL).replace(/\/+$/, "");
}

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Configure ASAAS_API_KEY no servidor." }, { status: 500 });

  const { id } = params;
  if (!id) return NextResponse.json({ error: "ID inválido." }, { status: 400 });

  const res = await fetch(`${getAsaasApiUrl()}/payments/${id}`, {
    headers: { accept: "application/json", access_token: apiKey },
    cache: "no-store",
  });

  if (!res.ok) return NextResponse.json({ error: "Não foi possível verificar o pagamento." }, { status: res.status });

  const data = (await res.json()) as { status?: string };
  return NextResponse.json({ status: data.status });
}
