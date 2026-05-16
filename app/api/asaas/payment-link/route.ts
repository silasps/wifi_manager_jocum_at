import { NextResponse } from "next/server";

type PaymentRequest = {
  reference?: string;
  nome?: string;
  email?: string;
  whatsApp?: string;
  categoria?: string;
  tipo_plano?: string;
  tempo?: string;
  valor?: number;
  qtd_pessoas_ministerio?: number;
};

type AsaasErrorResponse = {
  errors?: Array<{ description?: string }>;
  error?: string;
  message?: string;
};

const DEFAULT_ASAAS_API_URL = "https://api.asaas.com/v3";

function cleanApiUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function getAsaasApiUrl() {
  return cleanApiUrl(process.env.ASAAS_API_URL || DEFAULT_ASAAS_API_URL);
}

function getAppUrl(request: Request) {
  const configuredUrl = process.env.NEXT_PUBLIC_APP_URL || request.headers.get("origin") || "";
  return cleanApiUrl(configuredUrl);
}

async function readAsaasError(response: Response) {
  try {
    const body = (await response.json()) as AsaasErrorResponse;
    return body.errors?.[0]?.description || body.message || body.error || "O Asaas recusou a criação do pagamento.";
  } catch {
    return "O Asaas recusou a criação do pagamento.";
  }
}

export async function POST(request: Request) {
  const apiKey = process.env.ASAAS_API_KEY;

  if (!apiKey) {
    return NextResponse.json({ error: "Configure ASAAS_API_KEY no servidor antes de ativar o Asaas." }, { status: 500 });
  }

  let payload: PaymentRequest;

  try {
    payload = (await request.json()) as PaymentRequest;
  } catch {
    return NextResponse.json({ error: "Dados do pagamento inválidos." }, { status: 400 });
  }

  const value = Number(Number(payload.valor || 0).toFixed(2));
  const appUrl = getAppUrl(request);

  if (!payload.reference || !payload.nome || !payload.email || !payload.tempo || !payload.tipo_plano || value <= 0 || !appUrl) {
    return NextResponse.json({ error: "Dados do pagamento incompletos." }, { status: 400 });
  }

  const dueDateLimitDays = Math.max(1, Number(process.env.ASAAS_DUE_DATE_LIMIT_DAYS || 3));
  const maxInstallments = Math.min(21, Math.max(1, Number(process.env.ASAAS_MAX_INSTALLMENTS || 1)));
  const chargeType = maxInstallments > 1 ? "INSTALLMENT" : "DETACHED";
  const descriptionParts = [
    payload.categoria,
    payload.tempo,
    payload.tipo_plano,
    payload.qtd_pessoas_ministerio ? `${payload.qtd_pessoas_ministerio} pessoas` : "",
  ].filter(Boolean);

  const asaasPayload = {
    name: `Wi-Fi JOCUM AT - ${payload.nome}`.slice(0, 100),
    description: descriptionParts.join(" | ").slice(0, 500),
    value,
    billingType: "UNDEFINED",
    chargeType,
    dueDateLimitDays,
    maxInstallmentCount: maxInstallments > 1 ? maxInstallments : undefined,
    externalReference: payload.reference,
    notificationEnabled: true,
    isAddressRequired: false,
    callback: {
      successUrl: `${appUrl}/pagamento?asaas=success`,
    },
  };

  const response = await fetch(`${getAsaasApiUrl()}/paymentLinks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      accept: "application/json",
      access_token: apiKey,
    },
    body: JSON.stringify(asaasPayload),
  });

  if (!response.ok) {
    const error = await readAsaasError(response);
    return NextResponse.json({ error }, { status: response.status });
  }

  const data = (await response.json()) as { id?: string; url?: string };

  if (!data.url) {
    return NextResponse.json({ error: "O Asaas criou o pagamento, mas não retornou o link de checkout." }, { status: 502 });
  }

  return NextResponse.json({
    id: data.id,
    url: data.url,
    reference: payload.reference,
  });
}
