import { resolveMx } from "node:dns/promises";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

function hasEmailShape(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export async function GET(request: Request) {
  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() ?? "";

  if (!hasEmailShape(email)) {
    return NextResponse.json({ valid: false, reason: "Email inválido. Ajuste o email para continuar." }, { status: 400 });
  }

  const domain = email.split("@")[1];

  try {
    const records = await resolveMx(domain);
    const valid = records.length > 0;

    return NextResponse.json({
      valid,
      reason: valid ? null : "Este domínio não parece receber emails. Confira o endereço.",
    });
  } catch {
    return NextResponse.json(
      { valid: false, reason: "Este domínio não parece receber emails. Confira o endereço." },
      { status: 400 },
    );
  }
}
