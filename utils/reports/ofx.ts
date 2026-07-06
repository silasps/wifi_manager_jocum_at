import type { Transacao } from "./types";

function ofxDate(iso: string) {
  const d = new Date(iso);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${String(d.getHours()).padStart(2, "0")}${String(d.getMinutes()).padStart(2, "0")}${String(d.getSeconds()).padStart(2, "0")}`;
}

function ofxEscape(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// OFX v1 (SGML) — formato aceito por Quicken, GnuCash e softwares contábeis em geral.
// Cada transação paga vira um <STMTTRN> (depósito/CREDIT) dentro do extrato do período.
export function buildOfx(transacoes: Transacao[], desde: Date, ate: Date): string {
  const pagas = transacoes.filter((t) => t.valor_pago > 0);
  const total = pagas.reduce((sum, t) => sum + t.valor_pago, 0);
  const now = ofxDate(new Date().toISOString());

  const stmttrns = pagas
    .map(
      (t) => `<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>${ofxDate(t.created_at)}
<TRNAMT>${t.valor_pago.toFixed(2)}
<FITID>${t.id}
<NAME>${ofxEscape(t.cliente_nome || "Cliente Wi-Fi")}
<MEMO>${ofxEscape(t.plano_escolhido || "Wi-Fi JOCUM AT")}
</STMTTRN>`,
    )
    .join("\n");

  return `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1>
<SONRS>
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<DTSERVER>${now}
<LANGUAGE>POR
</SONRS>
</SIGNONMSGSRSV1>
<BANKMSGSRSV1>
<STMTTRNRS>
<TRNUID>1
<STATUS>
<CODE>0
<SEVERITY>INFO
</STATUS>
<STMTRS>
<CURDEF>BRL
<BANKACCTFROM>
<BANKID>0
<ACCTID>WIFIJOCUMAT
<ACCTTYPE>CHECKING
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>${ofxDate(desde.toISOString())}
<DTEND>${ofxDate(ate.toISOString())}
${stmttrns}
</BANKTRANLIST>
<LEDGERBAL>
<BALAMT>${total.toFixed(2)}
<DTASOF>${ofxDate(ate.toISOString())}
</LEDGERBAL>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;
}

export function downloadOfx(transacoes: Transacao[], desde: Date, ate: Date, filename: string) {
  const content = buildOfx(transacoes, desde, ate);
  const blob = new Blob([content], { type: "application/x-ofx" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
