import { NextResponse } from "next/server";

type PixRequest = {
  reference?: string;
  nome?: string;
  email?: string;
  whatsApp?: string;
  valor?: number;
  cpf?: string;
};

type AsaasErrorBody = {
  errors?: Array<{ description?: string }>;
  error?: string;
  message?: string;
};

const DEFAULT_ASAAS_API_URL = "https://api.asaas.com/v3";

function getAsaasApiUrl() {
  return (process.env.ASAAS_API_URL || DEFAULT_ASAAS_API_URL).replace(/\/+$/, "");
}

function asaasHeaders(apiKey: string) {
  return { accept: "application/json", access_token: apiKey, "Content-Type": "application/json" };
}

async function readError(res: Response) {
  try {
    const body = (await res.json()) as AsaasErrorBody;
    return body.errors?.[0]?.description || body.message || body.error || "Erro no Asaas.";
  } catch {
    return "Erro no Asaas.";
  }
}

function cleanPhone(raw?: string): string {
  let p = (raw || "").replace(/\D/g, "");
  if (p.startsWith("55") && p.length > 11) p = p.slice(2);
  return p.slice(0, 11);
}

async function findOrCreateCustomer(apiKey: string, nome: string, email: string, whatsApp?: string, cpf?: string) {
  const base = getAsaasApiUrl();
  const headers = asaasHeaders(apiKey);

  const searchRes = await fetch(`${base}/customers?email=${encodeURIComponent(email)}&limit=1`, { headers });
  if (searchRes.ok) {
    const body = (await searchRes.json()) as { data?: Array<{ id: string }> };
    if (body.data?.[0]?.id) return body.data[0].id;
  }

  const phone = cleanPhone(whatsApp);
  const cleanCpf = cpf?.replace(/\D/g, "");
  const customerBody: Record<string, unknown> = { name: nome.slice(0, 100), email: email.trim(), notificationDisabled: false };
  if (phone && phone.length >= 10) customerBody.mobilePhone = phone;
  if (cleanCpf && cleanCpf.length >= 11) customerBody.cpfCnpj = cleanCpf;

  const createRes = await fetch(`${base}/customers`, { method: "POST", headers, body: JSON.stringify(customerBody) });
  if (createRes.ok) {
    const created = (await createRes.json()) as { id?: string };
    if (created.id) return created.id;
  }

  // Retry without phone if first attempt failed
  const retryBody: Record<string, unknown> = { name: nome.slice(0, 100), email: email.trim(), notificationDisabled: false };
  if (cleanCpf && cleanCpf.length >= 11) retryBody.cpfCnpj = cleanCpf;
  const retryRes = await fetch(`${base}/customers`, { method: "POST", headers, body: JSON.stringify(retryBody) });
  if (!retryRes.ok) throw new Error(await readError(retryRes));

  const retried = (await retryRes.json()) as { id?: string };
  if (!retried.id) throw new Error("Asaas não retornou ID do cliente.");
  return retried.id;
}

export async function POST(request: Request) {
  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Configure ASAAS_API_KEY no servidor." }, { status: 500 });

  let payload: PixRequest;
  try {
    payload = (await request.json()) as PixRequest;
  } catch {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  const value = Number(Number(payload.valor || 0).toFixed(2));
  if (!payload.nome || !payload.email || !payload.reference || value <= 0) {
    return NextResponse.json({ error: "Dados incompletos para gerar o PIX." }, { status: 400 });
  }

  try {
    const base = getAsaasApiUrl();
    const headers = asaasHeaders(apiKey);

    const customerId = process.env.ASAAS_DEFAULT_CUSTOMER_ID
      || await findOrCreateCustomer(apiKey, payload.nome, payload.email, payload.whatsApp, payload.cpf);

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 1);
    const dueDateStr = dueDate.toISOString().split("T")[0];

    const chargeRes = await fetch(`${base}/payments`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        customer: customerId,
        billingType: "PIX",
        value,
        dueDate: dueDateStr,
        externalReference: payload.reference,
        description: "Wi-Fi JOCUM AT",
      }),
    });

    if (!chargeRes.ok) return NextResponse.json({ error: await readError(chargeRes) }, { status: 400 });

    const charge = (await chargeRes.json()) as { id?: string };
    if (!charge.id) return NextResponse.json({ error: "Asaas não retornou ID da cobrança." }, { status: 502 });

    const qrRes = await fetch(`${base}/payments/${charge.id}/pixQrCode`, { headers });
    if (!qrRes.ok) return NextResponse.json({ error: "Não foi possível obter o QR Code PIX." }, { status: 502 });

    const qr = (await qrRes.json()) as { encodedImage?: string; payload?: string; expirationDate?: string };

    return NextResponse.json({
      chargeId: charge.id,
      qrCodeImage: qr.encodedImage,
      copyPasteCode: qr.payload,
      expirationDate: qr.expirationDate,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Erro interno." }, { status: 500 });
  }
}
