import * as XLSX from "xlsx";
import type { ResumoMensal, Transacao } from "./types";

export function downloadXlsx(transacoes: Transacao[], porMes: ResumoMensal[], filename: string) {
  const wb = XLSX.utils.book_new();

  const linhasTransacoes = transacoes
    .filter((t) => t.valor_pago > 0)
    .map((t) => ({
      Data: new Date(t.created_at).toLocaleString("pt-BR"),
      Cliente: t.cliente_nome || "—",
      Email: t.cliente_email || "—",
      Plano: t.plano_escolhido || "—",
      "Valor (R$)": t.valor_pago,
    }));
  const wsTransacoes = XLSX.utils.json_to_sheet(linhasTransacoes);
  XLSX.utils.book_append_sheet(wb, wsTransacoes, "Transações");

  const linhasMes = porMes.map((m) => ({
    Mês: m.label,
    "Receita (R$)": m.receita,
    Transações: m.transacoes,
    Cortesias: m.cortesias,
    "Ticket médio (R$)": Number(m.ticketMedio.toFixed(2)),
  }));
  const wsMensal = XLSX.utils.json_to_sheet(linhasMes);
  XLSX.utils.book_append_sheet(wb, wsMensal, "Resumo mensal");

  XLSX.writeFile(wb, filename);
}
