import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../../../utils/supabase/admin";
import { requireAdmin } from "../../../../../../utils/supabase/requireAdmin";

type Body = {
  tempo_desc?: string;
  quota?: number;
  qtdObreiros?: number;
  forma_pagamento?: string;
  valor_pago?: number;
};

const FORMA_LABEL: Record<string, string> = {
  pix: "PIX",
  cartao: "Cartão",
  dinheiro: "Dinheiro em espécie",
  gratuito: "Gratuito",
};

const CORTESIA_TEMPO_DESC = "1 mês";
const CORTESIA_QUOTA = 6;

export async function POST(
  request: Request,
  { params }: { params: { id: string } },
) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Configuração incompleta." }, { status: 500 });
  }

  const adminId = await requireAdmin(request);
  if (!adminId) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const body = (await request.json()) as Body;
  const { tempo_desc, quota, qtdObreiros, forma_pagamento, valor_pago } = body;

  if (!tempo_desc?.trim() || !forma_pagamento) {
    return NextResponse.json({ error: "Dados inválidos." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: cliente, error: ce } = await admin
    .from("clientes")
    .select("user_id, tipo_plano")
    .eq("user_id", params.id)
    .maybeSingle();

  if (ce || !cliente) {
    return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
  }

  const isCortesia = String(cliente.tipo_plano || "").toLowerCase() === "cortesia";
  if (forma_pagamento === "gratuito" && !isCortesia) {
    return NextResponse.json({ error: "Voucher gratuito permitido apenas para contas marcadas como cortesia." }, { status: 403 });
  }

  const isVoucherCortesia = forma_pagamento === "gratuito";
  const tempoFinal = isVoucherCortesia ? CORTESIA_TEMPO_DESC : tempo_desc.trim();
  const quotaFinal = isVoucherCortesia ? CORTESIA_QUOTA : (quota || 6);

  const voucherInsert: Record<string, unknown> = {
    cliente_id: params.id,
    status: "pendente",
    tempo_desc: tempoFinal,
    quota: quotaFinal,
  };
  if (qtdObreiros) voucherInsert.qtdObreiros = qtdObreiros;

  const { data: voucher, error: ve } = await admin
    .from("vouchers")
    .insert(voucherInsert)
    .select("id")
    .single();

  if (ve || !voucher) {
    return NextResponse.json({ error: "Erro ao criar voucher." }, { status: 500 });
  }

  const formaLabel = FORMA_LABEL[forma_pagamento] ?? forma_pagamento;
  const valorFinal = forma_pagamento === "gratuito" ? 0 : (valor_pago || 0);

  await admin.from("financas").insert({
    cliente_id: params.id,
    plano_escolhido: tempoFinal,
    comprovante_pgto: `admin:${formaLabel} | atendimento pessoal`,
    valor_pago: valorFinal,
  });

  return NextResponse.json({ ok: true, voucherId: voucher.id });
}
