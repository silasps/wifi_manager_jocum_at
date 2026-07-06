export type Transacao = {
  id: number;
  created_at: string;
  valor_pago: number;
  plano_escolhido: string | null;
  cliente_nome: string | null;
  cliente_email: string | null;
};

export type ResumoMensal = {
  mes: string;
  label: string;
  receita: number;
  transacoes: number;
  cortesias: number;
  ticketMedio: number;
};
