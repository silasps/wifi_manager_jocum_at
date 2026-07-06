import { NextResponse } from "next/server";
import { createAdminClient } from "../../../../utils/supabase/admin";
import { requireAdmin } from "../../../../utils/supabase/requireAdmin";

const MESES_ABREV = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return `${MESES_ABREV[m - 1]}/${String(y).slice(2)}`;
}

export async function GET(request: Request) {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Configuração incompleta." }, { status: 500 });
  }
  const user = await requireAdmin(request);
  if (!user) return NextResponse.json({ error: "Acesso negado." }, { status: 403 });

  const { searchParams } = new URL(request.url);
  const now = new Date();
  const defaultDesde = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const desdeParam = searchParams.get("desde");
  const ateParam = searchParams.get("ate");
  const desde = desdeParam ? new Date(desdeParam) : defaultDesde;
  const ate = ateParam ? new Date(ateParam) : now;

  const admin = createAdminClient();

  const [{ data: financas, error: fe }, { data: clientes, error: ce }] = await Promise.all([
    admin.from("financas").select("id, cliente_id, valor_pago, plano_escolhido, created_at").order("created_at", { ascending: true }),
    admin.from("clientes").select("user_id, nome, email"),
  ]);

  if (fe || ce) return NextResponse.json({ error: "Erro ao buscar dados financeiros." }, { status: 500 });

  const clienteById = new Map<string, { nome: string | null; email: string | null }>();
  for (const c of clientes ?? []) clienteById.set(c.user_id, { nome: c.nome, email: c.email });

  const desdeTs = desde.getTime();
  const ateTs = ate.getTime();

  type FinancaRow = { id: number; cliente_id: string | null; valor_pago: number | null; plano_escolhido: string | null; created_at: string };

  const transacoes = (financas ?? [])
    .filter((f: FinancaRow) => {
      const ts = new Date(f.created_at).getTime();
      return ts >= desdeTs && ts <= ateTs;
    })
    .map((f: FinancaRow) => {
      const cliente = f.cliente_id ? clienteById.get(f.cliente_id) : undefined;
      return {
        id: f.id,
        created_at: f.created_at,
        valor_pago: f.valor_pago ?? 0,
        plano_escolhido: f.plano_escolhido as string | null,
        cliente_nome: cliente?.nome ?? null,
        cliente_email: cliente?.email ?? null,
      };
    });

  const mesMap = new Map<string, { receita: number; transacoes: number; cortesias: number }>();
  for (const t of transacoes) {
    const key = monthKey(new Date(t.created_at));
    const entry = mesMap.get(key) ?? { receita: 0, transacoes: 0, cortesias: 0 };
    if (t.valor_pago > 0) {
      entry.receita += t.valor_pago;
      entry.transacoes += 1;
    } else {
      entry.cortesias += 1;
    }
    mesMap.set(key, entry);
  }

  const porMes = Array.from(mesMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([mes, v]) => ({
      mes,
      label: monthLabel(mes),
      receita: v.receita,
      transacoes: v.transacoes,
      cortesias: v.cortesias,
      ticketMedio: v.transacoes > 0 ? v.receita / v.transacoes : 0,
    }));

  const planoMap = new Map<string, { receita: number; transacoes: number }>();
  for (const t of transacoes) {
    if (t.valor_pago <= 0) continue;
    const key = t.plano_escolhido || "—";
    const entry = planoMap.get(key) ?? { receita: 0, transacoes: 0 };
    entry.receita += t.valor_pago;
    entry.transacoes += 1;
    planoMap.set(key, entry);
  }
  const porPlano = Array.from(planoMap.entries())
    .map(([plano, v]) => ({ plano, receita: v.receita, transacoes: v.transacoes }))
    .sort((a, b) => b.receita - a.receita);

  const nowKey = monthKey(now);
  const prevKey = monthKey(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const receitaMesAtual = mesMap.get(nowKey)?.receita ?? 0;
  const receitaMesAnterior = mesMap.get(prevKey)?.receita ?? 0;
  const variacaoPercentual = receitaMesAnterior > 0
    ? ((receitaMesAtual - receitaMesAnterior) / receitaMesAnterior) * 100
    : (receitaMesAtual > 0 ? 100 : 0);

  const receitaAcumulada = porMes.reduce((sum, m) => sum + m.receita, 0);
  const transacoesTotal = porMes.reduce((sum, m) => sum + m.transacoes, 0);
  const cortesiasTotal = porMes.reduce((sum, m) => sum + m.cortesias, 0);
  const ticketMedioGeral = transacoesTotal > 0 ? receitaAcumulada / transacoesTotal : 0;

  const melhorMes = porMes.reduce<(typeof porMes)[number] | null>((best, m) => {
    if (m.transacoes === 0) return best;
    if (!best || m.receita > best.receita) return m;
    return best;
  }, null);

  return NextResponse.json({
    periodo: { desde: desde.toISOString(), ate: ate.toISOString() },
    transacoes,
    porMes,
    porPlano,
    resumo: {
      receitaMesAtual,
      receitaMesAnterior,
      variacaoPercentual,
      receitaAcumulada,
      transacoesTotal,
      cortesiasTotal,
      ticketMedioGeral,
      melhorMes,
    },
  });
}
