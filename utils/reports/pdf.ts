import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { ResumoMensal, Transacao } from "./types";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function downloadPdf(
  transacoes: Transacao[],
  porMes: ResumoMensal[],
  periodoLabel: string,
  resumo: { receitaAcumulada: number; transacoesTotal: number; ticketMedioGeral: number },
  filename: string,
) {
  const doc = new jsPDF();

  doc.setFontSize(16);
  doc.text("Wi-Fi JOCUM AT — Relatório Financeiro", 14, 18);
  doc.setFontSize(10);
  doc.setTextColor(100);
  doc.text(`Período: ${periodoLabel}`, 14, 25);
  doc.text(
    `Receita total: ${money.format(resumo.receitaAcumulada)}  ·  Transações: ${resumo.transacoesTotal}  ·  Ticket médio: ${money.format(resumo.ticketMedioGeral)}`,
    14,
    31,
  );

  autoTable(doc, {
    startY: 38,
    head: [["Mês", "Receita", "Transações", "Cortesias", "Ticket médio"]],
    body: porMes.map((m) => [m.label, money.format(m.receita), String(m.transacoes), String(m.cortesias), money.format(m.ticketMedio)]),
    theme: "grid",
    headStyles: { fillColor: [239, 112, 11] },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 38;

  autoTable(doc, {
    startY: finalY + 10,
    head: [["Data", "Cliente", "Plano", "Valor"]],
    body: transacoes
      .filter((t) => t.valor_pago > 0)
      .map((t) => [
        new Date(t.created_at).toLocaleDateString("pt-BR"),
        t.cliente_nome || "—",
        t.plano_escolhido || "—",
        money.format(t.valor_pago),
      ]),
    theme: "striped",
    headStyles: { fillColor: [239, 112, 11] },
    styles: { fontSize: 8 },
  });

  doc.save(filename);
}
