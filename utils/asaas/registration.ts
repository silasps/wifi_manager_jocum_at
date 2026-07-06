import { createAdminClient } from "../supabase/admin";

export type ResolveClienteInput = {
  transicaoPgto?: string; // "renovacao" quando é renovação de acesso existente
  accessToken?: string; // obrigatório quando transicaoPgto === "renovacao"
  nome: string;
  email: string;
  whatsApp?: string;
  categoria?: string;
  tipoPlano?: string;
  senha?: string;
};

// O endpoint /auth/v1/admin/users ignora o filtro "email" nesta instância do Supabase
// (retorna a lista completa, mais recentes primeiro) — por isso é obrigatório filtrar
// pelo email exato no cliente. Sem esse filtro, o código pegava o usuário mais recente
// do sistema inteiro e reaproveitava o id/senha dele por engano.
async function findAuthUserIdByEmail(email: string): Promise<string | undefined> {
  const target = email.trim().toLowerCase();
  const perPage = 200;
  for (let page = 1; page <= 10; page++) {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users?page=${page}&per_page=${perPage}`;
    const res = await fetch(url, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { users?: Array<{ id: string; email?: string }> };
    const users = body.users ?? [];
    const match = users.find((u) => u.email?.trim().toLowerCase() === target);
    if (match) return match.id;
    if (users.length < perPage) return undefined;
  }
  return undefined;
}

// Resolve (e cria, se necessário) o cliente ANTES do pagamento ser confirmado.
// Usa o client admin (service role) para não depender de RLS/confirmação de email —
// mesmo padrão já usado em /api/hotspot/register e /api/admin/clients/create.
export async function resolveClienteId(input: ResolveClienteInput): Promise<string> {
  const admin = createAdminClient();

  if (input.transicaoPgto === "renovacao") {
    if (!input.accessToken) throw new Error("Sessão ausente para renovação.");
    const { data, error } = await admin.auth.getUser(input.accessToken);
    if (error || !data.user) throw new Error("Sessão expirada. Faça login novamente.");
    return data.user.id;
  }

  const emailNorm = input.email.trim().toLowerCase();

  const { data: existing } = await admin.from("clientes").select("user_id").eq("email", emailNorm).maybeSingle();
  if (existing?.user_id) return existing.user_id;

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: emailNorm,
    password: input.senha || undefined,
    email_confirm: true,
  });

  let userId = authData?.user?.id;
  let createdFreshUser = Boolean(userId);

  if (authError || !userId) {
    // Só reaproveita um usuário existente se o email dele bater exatamente —
    // caso contrário, é um erro real de criação e não deve ser mascarado.
    const found = await findAuthUserIdByEmail(emailNorm);
    if (!found) throw new Error(authError?.message || "Não foi possível criar o acesso.");
    userId = found;
    createdFreshUser = false;
    await admin.auth.admin.updateUserById(userId, { email_confirm: true, password: input.senha || undefined });
  }

  const { error: clientError } = await admin.from("clientes").insert({
    user_id: userId,
    nome: input.nome,
    email: emailNorm,
    whatsApp: input.whatsApp || "",
    categoria: input.categoria || "Obreiro",
    ativo: true,
    tipo_plano: input.tipoPlano,
    senha: input.senha || null,
    aceite_de_termo: true,
    papel: "user",
  });

  if (clientError) {
    // Só remove o usuário Auth se foi criado agora — nunca apaga uma conta pré-existente.
    if (createdFreshUser) await admin.auth.admin.deleteUser(userId);
    throw new Error("Não foi possível finalizar o cadastro.");
  }

  return userId;
}

function computeQuota(categoria: string | undefined, qtdPessoasMinisterio: number) {
  if (categoria === "Casal") return 12;
  if (categoria === "Ministério") return 6 * (qtdPessoasMinisterio || 1);
  return 6;
}

export type ConfirmPaymentInput = {
  clienteId: string;
  reference: string;
  chargeId: string;
  chargeUrl: string;
  tempo: string;
  categoria?: string;
  qtdPessoasMinisterio?: number;
  valor: number;
};

// Cria voucher ("pendente", igual ao fluxo original) + financas assim que o pagamento é confirmado.
// Idempotente: se já processamos essa referência (retry de webhook), não duplica.
export async function confirmPaidVoucher(input: ConfirmPaymentInput) {
  const admin = createAdminClient();

  const { data: already } = await admin
    .from("financas")
    .select("id")
    .ilike("comprovante_pgto", `${input.reference}%`)
    .maybeSingle();
  if (already) return;

  const quota = computeQuota(input.categoria, input.qtdPessoasMinisterio || 0);

  await admin.from("vouchers").insert({
    cliente_id: input.clienteId,
    status: "pendente",
    tempo_desc: input.tempo,
    quota,
    qtdObreiros: input.qtdPessoasMinisterio || 1,
  });

  await admin.from("financas").insert({
    cliente_id: input.clienteId,
    plano_escolhido: input.tempo,
    comprovante_pgto: `${input.reference} | ${input.chargeId} | ${input.chargeUrl}`,
    valor_pago: input.valor,
  });

  await admin.from("clientes").update({ ativo: true }).eq("user_id", input.clienteId);
}

// O externalReference do Asaas carrega os dados mínimos (não sensíveis) para o webhook
// finalizar o voucher sem depender do navegador continuar aberto. Nunca inclui senha.
export function encodeExternalReference(reference: string, clienteId: string, tempo: string, categoria: string, qtdPessoasMinisterio: number) {
  return [reference, clienteId, tempo, categoria, qtdPessoasMinisterio || 1].join("|");
}

export function decodeExternalReference(value: string) {
  const [reference, clienteId, tempo, categoria, qtd] = value.split("|");
  return { reference, clienteId, tempo, categoria, qtdPessoasMinisterio: Number(qtd || 1) };
}
