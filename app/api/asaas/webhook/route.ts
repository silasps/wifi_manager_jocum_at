import { NextResponse } from "next/server";
import { confirmPaidVoucher, decodeExternalReference } from "../../../../utils/asaas/registration";

const CONFIRM_EVENTS = new Set(["PAYMENT_CONFIRMED", "PAYMENT_RECEIVED", "PAYMENT_RECEIVED_IN_CASH"]);

export async function POST(request: Request) {
  const expectedToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (expectedToken) {
    const received = request.headers.get("asaas-access-token");
    if (received !== expectedToken) {
      return NextResponse.json({ error: "Token inválido." }, { status: 401 });
    }
  }

  let body: { event?: string; payment?: { id?: string; value?: number; externalReference?: string } };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido." }, { status: 400 });
  }

  const event = body.event;
  const payment = body.payment;

  if (event && CONFIRM_EVENTS.has(event) && payment?.externalReference && payment.id) {
    try {
      const { reference, clienteId, tempo, categoria, qtdPessoasMinisterio } = decodeExternalReference(payment.externalReference);
      if (clienteId && tempo) {
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
      }
    } catch (e) {
      console.error("[asaas/webhook] falha ao confirmar voucher", e);
    }
  }

  // Sempre 200 (exceto token inválido) para o Asaas não ficar reenviando indefinidamente.
  return NextResponse.json({ received: true });
}
