import { NextResponse } from "next/server";
import { confirmPaidVoucher, decodeExternalReference } from "../../../../../utils/asaas/registration";

const DEFAULT_ASAAS_API_URL = "https://api.asaas.com/v3";
const CONFIRMED = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);

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

  const data = (await res.json()) as { status?: string; externalReference?: string; value?: number };

  // Fallback: se o webhook do Asaas não disparou (não configurado ou falhou), cria o voucher aqui.
  // confirmPaidVoucher é idempotente — verifica financas antes de inserir.
  if (data.status && CONFIRMED.has(data.status) && data.externalReference) {
    try {
      const { reference, clienteId, tempo, categoria, qtdPessoasMinisterio } = decodeExternalReference(data.externalReference);
      if (clienteId && tempo) {
        await confirmPaidVoucher({
          clienteId,
          reference,
          chargeId: id,
          chargeUrl: `asaas:${id}`,
          tempo,
          categoria,
          qtdPessoasMinisterio,
          valor: data.value || 0,
        });
      }
    } catch {
      // Não bloquear a resposta — o webhook pode ter criado já, ou o frontend vai tentar de novo
    }
  }

  return NextResponse.json({ status: data.status });
}
