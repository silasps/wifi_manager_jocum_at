import { NextResponse } from "next/server";
import { confirmPaidVoucher, decodeExternalReference } from "../../../../utils/asaas/registration";

const DEFAULT_ASAAS_API_URL = "https://api.asaas.com/v3";
const CONFIRMED_STATUSES = ["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"];
const LOOKBACK_HOURS = 2;

function getAsaasApiUrl() {
  return (process.env.ASAAS_API_URL || DEFAULT_ASAAS_API_URL).replace(/\/+$/, "");
}

type AsaasPayment = { id: string; externalReference?: string; value?: number };

// Rede de segurança final: varre pagamentos confirmados recentes no Asaas e garante que
// confirmPaidVoucher rodou pra cada um (idempotente). Cobre o caso do webhook do Asaas não
// estar configurado/ter falhado E do navegador do usuário ter sido fechado (ex: iOS mata o
// WebView do portal cativo ao abrir o app do banco), cenário em que nenhum dos dois
// caminhos normais de criação de voucher chega a rodar.
export async function GET(request: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
    }
  }

  const apiKey = process.env.ASAAS_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Configure ASAAS_API_KEY no servidor." }, { status: 500 });

  const base = getAsaasApiUrl();
  const headers = { accept: "application/json", access_token: apiKey };

  const since = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000);
  const dateGe = since.toISOString().split("T")[0];

  let processed = 0;
  let failed = 0;

  for (const status of CONFIRMED_STATUSES) {
    const params = new URLSearchParams({ status, "dateCreated[ge]": dateGe, limit: "100" });
    const res = await fetch(`${base}/payments?${params.toString()}`, { headers, cache: "no-store" });
    if (!res.ok) continue;

    const body = (await res.json()) as { data?: AsaasPayment[] };
    for (const payment of body.data ?? []) {
      if (!payment.externalReference) continue;
      const { reference, clienteId, tempo, categoria, qtdPessoasMinisterio } = decodeExternalReference(payment.externalReference);
      if (!clienteId || !tempo) continue;

      try {
        await confirmPaidVoucher({
          clienteId,
          reference,
          chargeId: payment.id,
          chargeUrl: `asaas:${payment.id}`,
          tempo,
          categoria,
          qtdPessoasMinisterio,
          valor: payment.value || 0,
        });
        processed++;
      } catch (e) {
        failed++;
        console.error("[asaas/reconcile] falha ao confirmar voucher", payment.id, e);
      }
    }
  }

  return NextResponse.json({ ok: true, processed, failed });
}
