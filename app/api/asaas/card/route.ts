import { NextResponse } from "next/server";

type CardRequest = {
  reference?: string;
  nome?: string;
  email?: string;
  whatsApp?: string;
  valor?: number;
  cardNumber?: string;
  cardHolderName?: string;
  cardExpiry?: string; // "MM/AA"
  cardCvv?: string;
  cpf?: string;
};

type AsaasErrorBody = { errors?: Array<{ description?: string }>; message?: string };

const BASE = () => (process.env.ASAAS_API_URL || "https://api.asaas.com/v3").replace(/\/+$/, "");
const H = (k: string) => ({ accept: "application/json", access_token: k, "Content-Type": "application/json" });

async function readErr(res: Response) {
  try {
    const b = (await res.json()) as AsaasErrorBody;
    return b.errors?.[0]?.description || b.message || "Erro no Asaas.";
  } catch { return "Erro no Asaas."; }
}

function cleanPhone(raw?: string): string {
  let p = (raw || "").replace(/\D/g, "");
  if (p.startsWith("55") && p.length > 11) p = p.slice(2);
  return p.slice(0, 11);
}

async function findOrCreateCustomer(k: string, nome: string, email: string, phone?: string, cpf?: string) {
  const h = H(k);
  const s = await fetch(`${BASE()}/customers?email=${encodeURIComponent(email)}&limit=1`, { headers: h });
  if (s.ok) {
    const d = (await s.json()) as { data?: Array<{ id: string }> };
    if (d.data?.[0]?.id) return d.data[0].id;
  }
  const p = cleanPhone(phone);
  const cleanCpf = cpf?.replace(/\D/g, "");
  const body: Record<string, unknown> = { name: nome.slice(0, 100), email: email.trim() };
  if (p && p.length >= 10) body.mobilePhone = p;
  if (cleanCpf && cleanCpf.length >= 11) body.cpfCnpj = cleanCpf;
  const r = await fetch(`${BASE()}/customers`, { method: "POST", headers: h, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(await readErr(r));
  const d = (await r.json()) as { id?: string };
  if (!d.id) throw new Error("Asaas não retornou ID do cliente.");
  return d.id;
}

export async function POST(request: Request) {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Configure ASAAS_API_KEY." }, { status: 500 });

  let p: CardRequest;
  try { p = (await request.json()) as CardRequest; }
  catch { return NextResponse.json({ error: "Dados inválidos." }, { status: 400 }); }

  const value = Number(Number(p.valor || 0).toFixed(2));
  if (!p.nome || !p.email || !p.reference || !p.cardNumber || !p.cardHolderName || !p.cardExpiry || !p.cardCvv || value <= 0) {
    return NextResponse.json({ error: "Dados incompletos." }, { status: 400 });
  }

  const [expMonth, expYearShort] = p.cardExpiry.split("/");
  if (!expMonth || !expYearShort) return NextResponse.json({ error: "Validade inválida." }, { status: 400 });

  try {
    const customerId = await findOrCreateCustomer(apiKey, p.nome, p.email, p.whatsApp, p.cpf);
    const today = new Date().toISOString().split("T")[0];

    const res = await fetch(`${BASE()}/payments`, {
      method: "POST",
      headers: H(apiKey),
      body: JSON.stringify({
        customer: customerId,
        billingType: "CREDIT_CARD",
        value,
        dueDate: today,
        externalReference: p.reference,
        description: "Wi-Fi JOCUM AT",
        creditCard: {
          holderName: p.cardHolderName.slice(0, 100),
          number: p.cardNumber.replace(/\D/g, ""),
          expiryMonth: expMonth.padStart(2, "0"),
          expiryYear: `20${expYearShort.slice(-2)}`,
          ccv: p.cardCvv,
        },
        creditCardHolderInfo: {
          name: p.nome.slice(0, 100),
          email: p.email.trim(),
          cpfCnpj: p.cpf?.replace(/\D/g, "") || undefined,
          phone: p.whatsApp?.replace(/\D/g, "").slice(0, 11) || undefined,
        },
      }),
    });

    if (!res.ok) return NextResponse.json({ error: await readErr(res) }, { status: 400 });

    const data = (await res.json()) as { id?: string; status?: string };
    if (!data.id) return NextResponse.json({ error: "Asaas não retornou ID da cobrança." }, { status: 502 });
    if (data.status === "DECLINED") return NextResponse.json({ error: "Cartão recusado. Verifique os dados e tente novamente." }, { status: 402 });

    return NextResponse.json({ chargeId: data.id, status: data.status });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno." }, { status: 500 });
  }
}
