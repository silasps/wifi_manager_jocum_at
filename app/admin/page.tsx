"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../utils/supabase/client";

const twoDays = 172800000;

type ClientRow = {
  user_id: string;
  nome?: string | null;
  email?: string | null;
  categoria?: string | null;
  papel?: string | null;
  ativo?: boolean | null;
  tipo_plano?: string | null;
};

type LastVoucher = {
  status?: string | null;
  data_expiracao?: string | null;
  codigo?: string | null;
  created_at?: string | null;
};

type Stats = {
  counts: { ativos: number; vencendo: number; inativos: number };
  lastVoucherByClient: Record<string, LastVoucher>;
};

function voucherStatus(v: LastVoucher): "ativo" | "vencendo" | "inativo" {
  const exp = v.data_expiracao ? new Date(v.data_expiracao).getTime() : null;
  if (!exp) return "inativo";
  const now = Date.now();
  if (exp <= now) return "inativo";
  if (exp <= now + twoDays) return "vencendo";
  return "ativo";
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" }).format(d);
}

function DonutChart({
  ativos, vencendo, inativos, filter, onFilter,
}: {
  ativos: number; vencendo: number; inativos: number;
  filter: "ativo" | "vencendo" | "inativo" | null;
  onFilter: (f: "ativo" | "vencendo" | "inativo" | null) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const total = ativos + vencendo + inativos;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const size = 120;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
    ctx.scale(dpr, dpr);

    const cx = size / 2;
    const cy = size / 2;
    const r = 46;
    const inner = 30;
    const gap = 0.03;

    ctx.clearRect(0, 0, size, size);

    if (total === 0) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fill("evenodd");
      return;
    }

    const segments = [
      { value: ativos, color: "#4ade80" },
      { value: vencendo, color: "#fbbf24" },
      { value: inativos, color: "rgba(255,255,255,0.18)" },
    ].filter((s) => s.value > 0);

    let start = -Math.PI / 2;
    for (const seg of segments) {
      const sweep = (seg.value / total) * (Math.PI * 2) - gap;
      ctx.beginPath();
      ctx.arc(cx, cy, r, start, start + sweep);
      ctx.arc(cx, cy, inner, start + sweep, start, true);
      ctx.closePath();
      ctx.fillStyle = seg.color;
      ctx.fill();
      start += sweep + gap;
    }
  }, [ativos, vencendo, inativos, total]);

  const toggle = (f: "ativo" | "vencendo" | "inativo") => onFilter(filter === f ? null : f);

  return (
    <div className="admin-donut-wrap">
      <div className="admin-donut-chart-wrap">
        <canvas ref={canvasRef} />
        <div className="admin-donut-center">
          <strong>{total}</strong>
          <small>total</small>
        </div>
      </div>
      <div className="admin-donut-legend">
        <button className={`admin-donut-filter-btn${filter === "ativo" ? " active" : ""}`} onClick={() => toggle("ativo")} type="button">
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#4ade80", display: "inline-block", flexShrink: 0 }} />
          {ativos} ativo{ativos !== 1 ? "s" : ""}
        </button>
        <button className={`admin-donut-filter-btn${filter === "vencendo" ? " active" : ""}`} onClick={() => toggle("vencendo")} type="button">
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#fbbf24", display: "inline-block", flexShrink: 0 }} />
          {vencendo} vencendo
        </button>
        <button className={`admin-donut-filter-btn${filter === "inativo" ? " active" : ""}`} onClick={() => toggle("inativo")} type="button">
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: "rgba(255,255,255,0.3)", display: "inline-block", flexShrink: 0 }} />
          {inativos} inativo{inativos !== 1 ? "s" : ""}
        </button>
        {filter && (
          <button className="admin-donut-clear" onClick={() => onFilter(null)} type="button">
            ✕ limpar
          </button>
        )}
      </div>
    </div>
  );
}

function formatPhoneBR(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 2) return digits;
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 3)} ${digits.slice(3, 7)}-${digits.slice(7)}`;
}

const inputStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10, padding: "10px 14px", color: "#fff", fontSize: "0.85rem",
  outline: "none", width: "100%",
};

// ── Plano/pagamento — mesma lógica usada em /admin/[id] e no cadastro público,
// reaproveitada aqui para que criar cliente já deixe o voucher pronto.
type Category = "Obreiro" | "Aluno" | "Casal" | "Ministério" | "";
type Plan = "Diário" | "Quinzenal" | "Mensal" | "Anual" | "";

const categories: Category[] = ["Obreiro", "Aluno", "Casal", "Ministério"];
const accessPlans = [
  { value: "Diário" as const, title: "Por dias", description: "Para visitas curtas, até 14 dias", unit: "dias" },
  { value: "Quinzenal" as const, title: "15 dias", description: "Pacote fechado para quem fica ~2 semanas", unit: "dias" },
  { value: "Mensal" as const, title: "Por meses", description: "Para uma temporada na base", unit: "meses" },
  { value: "Anual" as const, title: "Por anos", description: "Para acesso de longo prazo", unit: "anos" },
];

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

// Preço fechado dos 15 dias — sempre menor que o mensal da mesma categoria (mensal - R$10).
function quinzenalPrice(category: Category): number {
  if (category === "Casal" || category === "Ministério") return 40;
  if (category === "Aluno") return 25;
  return 20;
}

function timeLabel(plan: Plan, amount: string) {
  const v = Number(amount || 1);
  if (plan === "Diário") return v === 1 ? "1 dia" : `${v} dias`;
  if (plan === "Quinzenal") return "15 dias";
  if (plan === "Anual") return v === 1 ? "1 ano" : `${v} anos`;
  return v === 1 ? "1 mês" : `${v} meses`;
}
function durationLabel(plan: Plan) {
  if (plan === "Diário") return "Quantos dias de acesso?";
  if (plan === "Quinzenal") return "Duração fixa";
  if (plan === "Anual") return "Quantos anos de acesso?";
  if (plan === "Mensal") return "Quantos meses de acesso?";
  return "Duração do acesso";
}
function durationUnit(plan: Plan, value?: string) {
  const n = Number(value || 0);
  if (plan === "Diário") return n === 1 ? "dia" : "dias";
  if (plan === "Quinzenal") return "dias";
  if (plan === "Mensal") return n === 1 ? "mês" : "meses";
  if (plan === "Anual") return n === 1 ? "ano" : "anos";
  return "tempo";
}
function planDiscountHint(category: Category, plan: Plan, amount: string): string {
  const tempo = Number(amount || 0);
  if (plan === "Diário") return "até 14 dias";
  if (plan === "Quinzenal") {
    const full = 15 * (category === "Casal" ? 5 : 3);
    const price = quinzenalPrice(category);
    const pct = full > 0 ? Math.round((1 - price / full) * 100) : 0;
    return pct > 0 ? `economize ${pct}%` : "";
  }
  if (plan === "Anual") return category === "Ministério" ? "25% off na base" : "10% off";
  if (plan !== "Mensal") return "";
  if (category === "Ministério") {
    if (!tempo) return "20% off a partir de 3 meses";
    if (tempo >= 12) return "25% off na base";
    if (tempo >= 3) return "20% off na base";
    return "20% off a partir de 3 meses";
  }
  if (category === "Casal") {
    if (tempo === 3) return "pacote com desconto";
    if (tempo > 3) return "10% off";
    return "10% off a partir de 3 meses";
  }
  if (category === "Aluno" || category === "Obreiro") {
    if (tempo === 3) return "R$ 10 off";
    if (tempo > 3) return "10% off";
    return "10% off a partir de 3 meses";
  }
  return "";
}
function planUnitValue(category: Category, plan: Plan) {
  if (plan === "Diário") return `${money.format(category === "Casal" ? 5 : 3)} / dia`;
  if (plan === "Quinzenal") return `${money.format(quinzenalPrice(category) / 15)} / dia`;
  if (plan === "Anual") {
    if (category === "Ministério") return `${money.format(50 * 12 * 0.75)} / ano base`;
    if (category === "Aluno") return `${money.format(35 * 12 * 0.9)} / ano`;
    if (category === "Casal") return `${money.format(50 * 12 * 0.9)} / ano`;
    return `${money.format(30 * 12 * 0.9)} / ano`;
  }
  if (category === "Aluno") return `${money.format(35)} / mês`;
  if (category === "Casal" || category === "Ministério") return `${money.format(50)} / mês`;
  return `${money.format(30)} / mês`;
}
function planPrice(category: Category, plan: Plan, amount: string, people: string) {
  const tempo = Math.max(0, Number(amount || 0));
  const extras = Math.max(0, Number(people || 0) - 3);
  let original = 0, final = 0;
  if (!category || !plan) return { original, final, discount: 0 };

  if (plan === "Quinzenal") {
    original = 15 * (category === "Casal" ? 5 : 3);
    final = quinzenalPrice(category);
    return { original, final, discount: Math.max(0, original - final) };
  }

  if (!tempo) return { original, final, discount: 0 };

  if (plan === "Diário") {
    const unit = category === "Casal" ? 5 : 3;
    original = tempo * unit;
    final = original;
  } else if (plan === "Mensal") {
    if (category === "Aluno") original = tempo * 35;
    if (category === "Obreiro") original = tempo * 30;
    if (category === "Casal") original = tempo * 50;
    if (category === "Ministério") original = tempo * 50 + extras * 15 * tempo;
    final = original;
    if (category === "Aluno" || category === "Obreiro") final = tempo === 3 ? original - 10 : tempo > 3 ? original * 0.9 : original;
    if (category === "Casal") final = tempo === 3 ? 135 : tempo > 3 ? original * 0.9 : original;
    if (category === "Ministério") { const b = tempo * 50; final = (tempo >= 12 ? b * 0.75 : tempo >= 3 ? b * 0.8 : b) + extras * 15 * tempo; }
  } else if (plan === "Anual") {
    if (category === "Aluno") original = 35 * 12 * tempo;
    if (category === "Obreiro") original = 30 * 12 * tempo;
    if (category === "Casal") original = 50 * 12 * tempo;
    if (category === "Ministério") original = 50 * 12 * tempo + extras * 15 * 12 * tempo;
    final = original;
    if (category === "Aluno" || category === "Obreiro" || category === "Casal") final = original * 0.9;
    if (category === "Ministério") final = 50 * 12 * tempo * 0.75 + extras * 15 * 12 * tempo;
  }
  return { original, final, discount: Math.max(0, original - final) };
}
function fmtValorMask(price: number): string {
  const cents = Math.round(price * 100);
  return `${Math.floor(cents / 100).toLocaleString("pt-BR")},${String(cents % 100).padStart(2, "0")}`;
}

type NewVoucher = {
  codigo?: string | null;
  status?: string | null;
  data_expiracao?: string | null;
  tempo_desc?: string | null;
  quota?: number | null;
};

function whatsAppUrl(phone?: string): string {
  if (!phone) return "";
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

function voucherWhatsAppMessage(nome: string, email: string, senha: string, whatsApp: string, voucher: NewVoucher): string {
  const base = whatsAppUrl(whatsApp);
  if (!base) return "";
  const first = nome.trim().split(/\s+/)[0] || "cliente";
  const lines = [
    `Olá, ${first}!`,
    "",
    `*Email:* ${email || "—"}`,
    `*Acesso:* https://wifi-manager-react.vercel.app`,
    "",
    `🔑 *Voucher:* ${voucher.codigo || "pendente"}`,
    `📋 *Plano:* ${voucher.tempo_desc || "—"}`,
    `📅 *Vencimento:* ${fmtDate(voucher.data_expiracao)}`,
  ];
  return `${base}?text=${encodeURIComponent(lines.join("\n"))}`;
}

type ModalStep = "info" | "plan" | "pix" | "card" | "cash" | "free" | "waiting" | "result";

export default function AdminPage() {
  const [query, setQuery] = useState("");
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [chartFilter, setChartFilter] = useState<"ativo" | "vencendo" | "inativo" | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    nome: "", email: "", whatsApp: "", senha: "",
    tipo: "pagante" as "pagante" | "cortesia",
    categoria: "Obreiro" as Category,
  });
  const [createMsg, setCreateMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const tokenRef = useRef<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── fluxo de plano/voucher — o cliente só é gravado no banco ao final (doCreateVoucher) ──
  const [step, setStep] = useState<ModalStep>("info");
  const [planType, setPlanType] = useState<Plan>("Mensal");
  const [amount, setAmount] = useState("1");
  const [quota, setQuota] = useState(6);
  const [valor, setValor] = useState("");
  const [voucherError, setVoucherError] = useState<string | null>(null);
  const [voucherCreating, setVoucherCreating] = useState(false);
  const [stepLoading, setStepLoading] = useState(false);
  const [pixData, setPixData] = useState<{ chargeId: string; qrCodeImage: string; copyPasteCode: string } | null>(null);
  const [pixCopied, setPixCopied] = useState(false);
  const [cardData, setCardData] = useState({ holderName: "", number: "", expiry: "", cvv: "", cpf: "" });
  const [resultVoucher, setResultVoucher] = useState<NewVoucher | null>(null);
  const valorNumRef = useRef(0);
  const pendingVoucherIdRef = useRef<string | null>(null);

  useEffect(() => {
    async function init() {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error || !session) { window.location.href = "/"; return; }

      const { data: clienteData } = await supabase
        .from("clientes")
        .select("papel")
        .eq("user_id", session.user.id)
        .maybeSingle();

      if (!clienteData?.papel || clienteData.papel === "user") {
        window.location.href = "/home";
        return;
      }

      tokenRef.current = session.access_token;
      await Promise.all([
        fetchClients("", session.access_token),
        fetchStats(session.access_token),
      ]);
    }
    void init();
  }, []);

  const fetchClients = async (q: string, token?: string) => {
    const t = token ?? tokenRef.current;
    if (!t) return;
    setLoading(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/admin/clients?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${t}` },
      });
      const data = (await res.json()) as { clients?: ClientRow[]; error?: string };
      if (data.error) { setMessage(data.error); } else { setClients(data.clients ?? []); }
    } catch {
      setMessage("Erro ao buscar clientes.");
    } finally {
      setLoading(false);
    }
  };

  const fetchStats = async (token: string) => {
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as Stats & { error?: string };
      if (!data.error) setStats(data);
    } catch {
      // stats are optional, don't block
    }
  };

  const handleSearch = (value: string) => {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => void fetchClients(value), 350);
  };

  const resetCreateFlow = () => {
    setShowCreateModal(false);
    setStep("info");
    setCreateForm({ nome: "", email: "", whatsApp: "", senha: "", tipo: "pagante", categoria: "Obreiro" });
    setCreateMsg(null);
    setPlanType("Mensal");
    setAmount("1");
    setQuota(6);
    setValor("");
    setVoucherError(null);
    setPixData(null);
    setCardData({ holderName: "", number: "", expiry: "", cvv: "", cpf: "" });
    setResultVoucher(null);
  };

  const openPlanStep = (cat: Category) => {
    setQuota(cat === "Casal" ? 12 : 6);
    setPlanType("Mensal");
    setAmount("1");
    setPixData(null);
    setVoucherError(null);
    const { final } = planPrice(cat, "Mensal", "1", "3");
    setValor(fmtValorMask(final));
    setStep("plan");
  };

  // O cliente só é criado no fim do fluxo (junto com o voucher), em doCreateVoucher —
  // aqui só validamos e avançamos para a escolha do plano, sem tocar no banco.
  const handleContinueToPlan = () => {
    const { nome, email, senha } = createForm;
    if (!nome.trim() || !email.trim() || !senha) { setCreateMsg({ ok: false, text: "Preencha nome, email e senha." }); return; }
    setCreateMsg(null);
    openPlanStep(createForm.categoria);
  };

  const finishAfterVoucher = (voucherId: string) => {
    pendingVoucherIdRef.current = voucherId;
    setStep("waiting");
    setTimeout(() => void loadResultVoucher(), 6000);
  };

  const loadResultVoucher = async () => {
    const id = pendingVoucherIdRef.current;
    if (!id || !tokenRef.current) { setStep("result"); return; }
    try {
      const res = await fetch(`/api/admin/vouchers/${id}?t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${tokenRef.current}` }, cache: "no-store",
      });
      const d = (await res.json()) as { voucher?: NewVoucher };
      if (d.voucher) setResultVoucher(d.voucher);
    } catch {
      // se falhar, mostra o resultado mesmo assim — cliente já foi criado
    }
    setStep("result");
  };

  const doCreateVoucher = async (forma_pagamento: string, valorPago: number) => {
    if (!tokenRef.current) return;
    setVoucherCreating(true);
    setVoucherError(null);
    try {
      const { nome, email, senha, whatsApp, tipo, categoria } = createForm;
      const createRes = await fetch("/api/admin/clients/create", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify({ nome: nome.trim(), email: email.trim().toLowerCase(), senha, whatsApp: whatsApp.trim(), tipo, categoria }),
      });
      const createData = await createRes.json();
      if (!createRes.ok || !createData.userId) {
        setVoucherError(createData.error || "Erro ao criar cliente.");
        setVoucherCreating(false);
        return;
      }

      const res = await fetch(`/api/admin/clients/${createData.userId}/voucher`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenRef.current}` },
        body: JSON.stringify({
          tempo_desc: timeLabel(planType, amount),
          quota,
          forma_pagamento,
          valor_pago: valorPago,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; voucherId?: string; error?: string };
      if (data.ok && data.voucherId) {
        void fetchClients(query);
        finishAfterVoucher(data.voucherId);
      } else {
        setVoucherError(data.error || "Cliente criado, mas houve erro ao gerar o voucher. Abra o cliente na lista para tentar novamente.");
      }
    } catch {
      setVoucherError("Erro de rede ao criar voucher.");
    }
    setVoucherCreating(false);
  };

  const handlePaymentSelect = async (method: "pix" | "card" | "cash" | "free") => {
    if (!planType || !amount) { setVoucherError("Selecione o plano e informe a duração."); return; }
    setVoucherError(null);
    const valorNum = Number(valor.replace(/\./g, "").replace(",", ".")) || 0;
    valorNumRef.current = valorNum;
    if (method === "cash") { setStep("cash"); return; }
    if (method === "free") { setStep("free"); return; }
    if (method === "card") {
      setCardData((d) => ({ ...d, holderName: createForm.nome }));
      setStep("card");
      return;
    }
    // PIX
    setStepLoading(true);
    setStep("pix");
    try {
      const res = await fetch("/api/asaas/pix", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: crypto.randomUUID(),
          nome: createForm.nome, email: createForm.email, whatsApp: createForm.whatsApp,
          valor: valorNum,
        }),
      });
      const pixRes = (await res.json()) as { chargeId?: string; qrCodeImage?: string; copyPasteCode?: string; error?: string };
      if (!pixRes.chargeId || !pixRes.qrCodeImage || !pixRes.copyPasteCode) {
        setVoucherError(pixRes.error || "Não foi possível gerar o PIX.");
        setStep("plan");
      } else {
        setPixData({ chargeId: pixRes.chargeId, qrCodeImage: pixRes.qrCodeImage, copyPasteCode: pixRes.copyPasteCode });
      }
    } catch {
      setVoucherError("Não foi possível gerar o PIX.");
      setStep("plan");
    }
    setStepLoading(false);
  };

  useEffect(() => {
    if (!pixData || step !== "pix") return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/asaas/pix/${pixData.chargeId}`);
        const d = (await res.json()) as { status?: string };
        if (!cancelled && (d.status === "RECEIVED" || d.status === "CONFIRMED" || d.status === "RECEIVED_IN_CASH")) {
          cancelled = true;
          clearInterval(timer);
          await doCreateVoucher("pix", valorNumRef.current);
        }
      } catch { /* ignore transient errors */ }
    };
    const timer = setInterval(() => void poll(), 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [pixData, step]); // eslint-disable-line react-hooks/exhaustive-deps

  const submitCard = async (e: React.FormEvent) => {
    e.preventDefault();
    setStepLoading(true);
    setVoucherError(null);
    const valorNum = valorNumRef.current;
    try {
      const res = await fetch("/api/asaas/card", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: crypto.randomUUID(),
          nome: createForm.nome, email: createForm.email, whatsApp: createForm.whatsApp,
          valor: valorNum,
          cardNumber: cardData.number, cardHolderName: cardData.holderName,
          cardExpiry: cardData.expiry, cardCvv: cardData.cvv, cpf: cardData.cpf,
        }),
      });
      const data = (await res.json()) as { chargeId?: string; error?: string };
      if (!data.chargeId) { setStepLoading(false); setVoucherError(data.error || "Não foi possível processar o cartão."); return; }
      await doCreateVoucher("cartao", valorNum);
    } catch {
      setVoucherError("Não foi possível processar o cartão.");
    }
    setStepLoading(false);
  };

  const counts = stats?.counts ?? { ativos: 0, vencendo: 0, inativos: 0 };
  const cat = createForm.categoria;
  const price = planPrice(cat, planType, amount, "3");
  const ready = Boolean(planType && amount);
  const wppUrl = resultVoucher ? voucherWhatsAppMessage(createForm.nome, createForm.email, createForm.senha, createForm.whatsApp, resultVoucher) : "";

  return (
    <main className="admin-page">
      <header className="admin-nav">
        <a href="/home" className="admin-nav-back">‹ Início</a>
        <div className="admin-nav-tabs">
          <span className="admin-nav-tab active">Clientes</span>
          <a href="/admin/vouchers" className="admin-nav-tab">Vouchers</a>
          <a href="/admin/financeiro" className="admin-nav-tab">Financeiro</a>
        </div>
      </header>

      {stats ? (
        <div className="admin-donut-section">
          <DonutChart
            ativos={counts.ativos} vencendo={counts.vencendo} inativos={counts.inativos}
            filter={chartFilter} onFilter={setChartFilter}
          />
        </div>
      ) : (
        <div className="skeleton skeleton-donut" />
      )}

      <div className="admin-search-wrap" style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="search"
          className="admin-search-input"
          placeholder="Buscar por nome ou e-mail…"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          autoFocus
          style={{ flex: 1 }}
        />
        <button
          type="button"
          onClick={() => { setShowCreateModal(true); setCreateMsg(null); }}
          style={{
            background: "#ef700b", border: "none", borderRadius: 10, padding: "10px 16px",
            color: "#fff", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          + Novo cliente
        </button>
      </div>

      {/* ── Passo 1: dados do cliente ── */}
      {showCreateModal && step === "info" && (
        <div className="admin-modal-backdrop" role="presentation" onClick={resetCreateFlow}>
          <div className="admin-modal admin-modal--form" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-close" type="button" onClick={resetCreateFlow} aria-label="Fechar">×</button>
            <h3 className="admin-modal-title">Novo cliente</h3>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
              <input
                type="text" placeholder="Nome completo" value={createForm.nome}
                onChange={(e) => setCreateForm((f) => ({ ...f, nome: e.target.value }))}
                style={inputStyle}
              />
              <input
                type="email" placeholder="Email" value={createForm.email}
                onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))}
                style={inputStyle}
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ color: "#71717a", fontSize: "0.85rem", flexShrink: 0 }}>+55</span>
                <input
                  type="tel" placeholder="(67) 9 9632-0072" value={createForm.whatsApp}
                  onChange={(e) => setCreateForm((f) => ({ ...f, whatsApp: formatPhoneBR(e.target.value) }))}
                  inputMode="numeric"
                  style={inputStyle}
                />
              </div>
              <input
                type="text" placeholder="Senha de acesso" value={createForm.senha}
                onChange={(e) => setCreateForm((f) => ({ ...f, senha: e.target.value }))}
                style={inputStyle}
              />

              <select
                className="admin-select"
                value={createForm.categoria}
                onChange={(e) => setCreateForm((f) => ({ ...f, categoria: e.target.value as Category }))}
                style={inputStyle}
              >
                {categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>

              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                <button
                  type="button"
                  onClick={() => setCreateForm((f) => ({ ...f, tipo: "pagante" }))}
                  style={{
                    flex: 1, padding: "10px 0", borderRadius: 10, fontSize: "0.82rem", fontWeight: 600,
                    cursor: "pointer", border: "1px solid",
                    ...(createForm.tipo === "pagante"
                      ? { background: "rgba(74,222,128,0.12)", borderColor: "#4ade80", color: "#4ade80" }
                      : { background: "transparent", borderColor: "rgba(255,255,255,0.15)", color: "#71717a" }),
                  }}
                >
                  Pagante
                </button>
                <button
                  type="button"
                  onClick={() => setCreateForm((f) => ({ ...f, tipo: "cortesia" }))}
                  style={{
                    flex: 1, padding: "10px 0", borderRadius: 10, fontSize: "0.82rem", fontWeight: 600,
                    cursor: "pointer", border: "1px solid",
                    ...(createForm.tipo === "cortesia"
                      ? { background: "rgba(251,191,36,0.12)", borderColor: "#fbbf24", color: "#fbbf24" }
                      : { background: "transparent", borderColor: "rgba(255,255,255,0.15)", color: "#71717a" }),
                  }}
                >
                  Cortesia
                </button>
              </div>

              <p style={{ color: "#71717a", fontSize: "0.72rem", margin: "2px 0 0", lineHeight: 1.4 }}>
                No próximo passo você escolhe o plano e já gera o voucher deste cliente.
              </p>
            </div>

            {createMsg && (
              <p style={{ color: createMsg.ok ? "#4ade80" : "#f87171", fontSize: "0.8rem", margin: "12px 0 0", textAlign: "center" }}>
                {createMsg.text}
              </p>
            )}

            <div style={{ display: "flex", gap: 10, marginTop: 18, width: "100%" }}>
              <button
                type="button"
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)",
                  background: "transparent", color: "#a1a1aa", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
                }}
                onClick={resetCreateFlow}
              >
                Cancelar
              </button>
              <button
                type="button"
                style={{
                  flex: 1, padding: "12px 0", borderRadius: 10, border: "none",
                  background: "#ef700b", color: "#fff", fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
                }}
                onClick={handleContinueToPlan}
              >
                Seguinte
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Passo 2: plano ── */}
      {showCreateModal && step === "plan" && (
        <div className="admin-modal-backdrop" role="presentation" onClick={resetCreateFlow}>
          <div className="admin-modal admin-modal--form" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <button className="admin-modal-close" type="button" onClick={resetCreateFlow} aria-label="Fechar">×</button>
            <h3 className="admin-modal-title">Plano de {createForm.nome || "cliente"}</h3>
            <p className="admin-modal-info" style={{ fontSize: "0.82rem", textAlign: "center" }}>{cat}</p>

            <fieldset style={{ border: 0, padding: 0, margin: 0, width: "100%" }}>
              <legend className="admin-create-label" style={{ marginBottom: 8 }}>Tempo de acesso desejado</legend>
              <div className="billing-options">
                {accessPlans.map((plan) => {
                  const hint = planDiscountHint(cat, plan.value, amount);
                  return (
                    <button key={plan.value} type="button" role="radio" aria-checked={planType === plan.value}
                      className={planType === plan.value ? "plan-option selected" : "plan-option"}
                      onClick={() => {
                        const amt = plan.value === "Diário" ? "2" : plan.value === "Quinzenal" ? "15" : "1";
                        setPlanType(plan.value);
                        setAmount(amt);
                        const { final } = planPrice(cat, plan.value, amt, "3");
                        setValor(fmtValorMask(final));
                      }}
                    >
                      {hint && <em className="discount-badge">{hint}</em>}
                      <strong>{plan.title}</strong>
                      <small className="unit-price">{planUnitValue(cat, plan.value)}</small>
                      <span>{plan.description}</span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="admin-create-field">
              <label className="admin-create-label">{durationLabel(planType)}</label>
              <span className="duration-input">
                <input type="text" inputMode="numeric" value={amount} disabled={!planType || planType === "Quinzenal"}
                  onChange={(e) => {
                    const val = e.target.value.replace(/\D/g, "").slice(0, 3);
                    setAmount(val);
                    if (val && planType) { const { final } = planPrice(cat, planType, val, "3"); setValor(fmtValorMask(final)); }
                  }}
                  onBlur={() => {
                    if (planType === "Diário" && Number(amount) < 2) setAmount("2");
                    if (planType === "Diário" && Number(amount) > 14) setAmount("14");
                  }}
                />
                <span>{durationUnit(planType, amount)}</span>
              </span>
            </div>

            <div className="package-summary">
              <div>
                <p>Resumo do plano</p>
                <ul>
                  <li className="done"><span>✓</span>{cat}</li>
                  <li className={planType ? "done" : ""}><span>{planType ? "✓" : "○"}</span>{planType || "Escolha o tempo"}</li>
                  <li className={amount ? "done" : ""}><span>{amount ? "✓" : "○"}</span>{amount ? timeLabel(planType, amount) : "Informe a duração"}</li>
                </ul>
              </div>
              <div>
                {ready ? (<>
                  {price.discount > 0 && <span className="old-price">{money.format(price.original)}</span>}
                  <strong>{money.format(price.final)}</strong>
                  <span>{price.discount > 0 ? `Desconto de ${money.format(price.discount)}` : "Sem desconto"}</span>
                  <small>{cat} · {timeLabel(planType, amount)}</small>
                </>) : (<><strong>--</strong><span>Preencha acima</span></>)}
              </div>
            </div>

            <div className="admin-create-field">
              <span className="admin-create-label">Dispositivos (quota)</span>
              <input className="admin-create-input" type="number" min={1} max={200} value={quota}
                onChange={(e) => setQuota(Math.max(1, Number(e.target.value) || 1))} />
            </div>

            <div className="admin-create-field">
              <span className="admin-create-label">Valor a cobrar</span>
              <div className="admin-currency-wrap">
                <span className="admin-currency-prefix">R$</span>
                <input className="admin-create-input admin-create-input--currency" type="text" inputMode="numeric"
                  placeholder="0,00" value={valor}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 9);
                    if (!digits) { setValor(""); return; }
                    const cents = parseInt(digits, 10);
                    setValor(`${Math.floor(cents / 100).toLocaleString("pt-BR")},${String(cents % 100).padStart(2, "0")}`);
                  }} />
              </div>
            </div>

            {voucherError && <p className="admin-modal-error">{voucherError}</p>}

            <p className="admin-create-label" style={{ textAlign: "center" }}>Como o cliente vai pagar?</p>
            <div className="admin-payment-opts">
              {([["pix", "Pix"], ["card", "Cartão"], ["cash", "Dinheiro"], ["free", "Gratuito"]] as const).map(([m, label]) => (
                <button key={m} type="button" className="admin-payment-btn"
                  onClick={() => void handlePaymentSelect(m)}
                  disabled={!ready || stepLoading}
                >{label}</button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Pix ── */}
      {showCreateModal && step === "pix" && (
        <div className="admin-modal-backdrop" role="presentation">
          <div className="admin-modal admin-modal--form" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-title">Pagamento Pix</h3>
            <p className="admin-modal-info" style={{ textAlign: "center", fontSize: "0.82rem" }}>
              {createForm.nome} · {money.format(valorNumRef.current)} · {timeLabel(planType, amount)}
            </p>
            {stepLoading ? (
              <div className="admin-result-loading"><div className="admin-result-spinner" /><p>Gerando QR Code…</p></div>
            ) : pixData ? (<>
              <img src={`data:image/png;base64,${pixData.qrCodeImage}`} alt="QR Code PIX"
                style={{ width: 200, height: 200, display: "block", margin: "0 auto", borderRadius: 8 }} />
              <div className="admin-currency-wrap" style={{ marginTop: 4 }}>
                <input readOnly value={pixData.copyPasteCode}
                  style={{ flex: 1, fontSize: 11, fontFamily: "monospace", padding: "8px 10px", border: "none", background: "transparent", color: "#fff7ef", minWidth: 0 }}
                  onFocus={(e) => e.target.select()} />
                <button className="admin-save-button" type="button" style={{ borderRadius: "0 8px 8px 0", margin: 0 }}
                  onClick={async () => { await navigator.clipboard.writeText(pixData.copyPasteCode); setPixCopied(true); setTimeout(() => setPixCopied(false), 2000); }}>
                  {pixCopied ? "Copiado!" : "Copiar"}
                </button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", display: "inline-block", animation: "pulse 1.5s infinite" }} />
                <span style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)" }}>Aguardando confirmação…</span>
              </div>
            </>) : null}
            {voucherError && <p className="admin-modal-error">{voucherError}</p>}
            <button className="admin-modal-confirm admin-modal-confirm--ghost" type="button" onClick={() => { setStep("plan"); setPixData(null); setVoucherError(null); }}>‹ Voltar</button>
          </div>
        </div>
      )}

      {/* ── Cartão ── */}
      {showCreateModal && step === "card" && (() => {
        const fmt4 = (v: string) => v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ");
        const fmtExp = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 4); return d.length > 2 ? `${d.slice(0, 2)}/${d.slice(2)}` : d; };
        const fmtCpf = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 11); if (d.length <= 3) return d; if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`; if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`; return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`; };
        const setCard = (k: keyof typeof cardData) => (e: React.ChangeEvent<HTMLInputElement>) => setCardData((d) => ({ ...d, [k]: e.target.value }));
        return (
          <div className="admin-modal-backdrop" role="presentation">
            <div className="admin-modal admin-modal--form" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h3 className="admin-modal-title">Cartão de crédito</h3>
              <p className="admin-modal-info" style={{ textAlign: "center", fontSize: "0.82rem" }}>
                {createForm.nome} · {money.format(valorNumRef.current)} · {timeLabel(planType, amount)}
              </p>
              <form className="form-stack" onSubmit={submitCard} style={{ width: "100%" }}>
                <label>Nome no cartão<input value={cardData.holderName} onChange={setCard("holderName")} autoComplete="cc-name" required /></label>
                <label>Número<input value={cardData.number} onChange={(e) => setCardData((d) => ({ ...d, number: fmt4(e.target.value) }))} inputMode="numeric" placeholder="0000 0000 0000 0000" autoComplete="cc-number" required /></label>
                <div className="phone-row">
                  <label>Validade<input value={cardData.expiry} onChange={(e) => setCardData((d) => ({ ...d, expiry: fmtExp(e.target.value) }))} inputMode="numeric" placeholder="MM/AA" autoComplete="cc-exp" required /></label>
                  <label>CVV<input value={cardData.cvv} onChange={setCard("cvv")} inputMode="numeric" maxLength={4} placeholder="000" autoComplete="cc-csc" required /></label>
                </div>
                <label>CPF do titular<input value={cardData.cpf} onChange={(e) => setCardData((d) => ({ ...d, cpf: fmtCpf(e.target.value) }))} inputMode="numeric" placeholder="000.000.000-00" required /></label>
                {voucherError && <p className="admin-modal-error">{voucherError}</p>}
                <button className="admin-modal-confirm" type="submit" disabled={stepLoading || voucherCreating}>
                  {stepLoading || voucherCreating ? "Processando…" : `Pagar ${money.format(valorNumRef.current)}`}
                </button>
              </form>
              <button className="admin-modal-confirm admin-modal-confirm--ghost" type="button" onClick={() => { setStep("plan"); setVoucherError(null); }}>‹ Voltar</button>
            </div>
          </div>
        );
      })()}

      {/* ── Dinheiro ── */}
      {showCreateModal && step === "cash" && (
        <div className="admin-modal-backdrop" role="presentation" onClick={() => setStep("plan")}>
          <div className="admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-title">Dinheiro em espécie</h3>
            <div className="admin-result-grid" style={{ width: "100%" }}>
              <div className="admin-result-row"><span>Cliente</span><strong>{createForm.nome || "—"}</strong></div>
              <div className="admin-result-row"><span>Plano</span><strong>{timeLabel(planType, amount)}</strong></div>
              <div className="admin-result-row"><span>Valor</span><strong style={{ color: "#4ade80" }}>{money.format(valorNumRef.current)}</strong></div>
            </div>
            <p className="admin-modal-info" style={{ fontSize: "0.82rem" }}>Confirme o recebimento do dinheiro para gerar o voucher.</p>
            {voucherError && <p className="admin-modal-error">{voucherError}</p>}
            <button className="admin-modal-confirm" type="button" disabled={voucherCreating}
              onClick={() => void doCreateVoucher("dinheiro", valorNumRef.current)}>
              {voucherCreating ? "Criando…" : "Confirmar recebimento"}
            </button>
            <button className="admin-modal-confirm admin-modal-confirm--ghost" type="button" onClick={() => setStep("plan")}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── Gratuito ── */}
      {showCreateModal && step === "free" && (
        <div className="admin-modal-backdrop" role="presentation" onClick={() => setStep("plan")}>
          <div className="admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-title">Voucher gratuito</h3>
            <div className="admin-result-grid" style={{ width: "100%" }}>
              <div className="admin-result-row"><span>Cliente</span><strong>{createForm.nome || "—"}</strong></div>
              <div className="admin-result-row"><span>Plano</span><strong>{timeLabel(planType, amount)}</strong></div>
              <div className="admin-result-row"><span>Dispositivos</span><strong>{quota}</strong></div>
              <div className="admin-result-row"><span>Valor</span><strong style={{ color: "#4ade80" }}>Gratuito</strong></div>
            </div>
            <p className="admin-modal-info admin-modal-info--warn" style={{ fontSize: "0.82rem" }}>Confirme para gerar o voucher gratuito para este cliente, sem cobrança.</p>
            {voucherError && <p className="admin-modal-error">{voucherError}</p>}
            <button className="admin-modal-confirm" type="button" disabled={voucherCreating}
              onClick={() => void doCreateVoucher("gratuito", 0)}>
              {voucherCreating ? "Criando…" : "Confirmar voucher gratuito"}
            </button>
            <button className="admin-modal-confirm admin-modal-confirm--ghost" type="button" onClick={() => setStep("plan")}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── Aguardando processamento ── */}
      {showCreateModal && step === "waiting" && (
        <div className="admin-modal-backdrop" role="presentation">
          <div className="admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <div className="admin-result-loading"><div className="admin-result-spinner" /><p>Gerando voucher…</p></div>
          </div>
        </div>
      )}

      {/* ── Resultado ── */}
      {showCreateModal && step === "result" && (
        <div className="admin-modal-backdrop" role="presentation">
          <div className="admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h3 className="admin-modal-title">Cliente e voucher criados</h3>
            {resultVoucher ? (
              <code className="admin-modal-code">{resultVoucher.codigo || "pendente"}</code>
            ) : null}
            <div className="admin-result-grid">
              <div className="admin-result-row"><span>Cliente</span><strong>{createForm.nome}</strong></div>
              <div className="admin-result-row"><span>Plano</span><strong>{resultVoucher?.tempo_desc || timeLabel(planType, amount)}</strong></div>
              <div className="admin-result-row"><span>Vencimento</span><strong>{fmtDate(resultVoucher?.data_expiracao)}</strong></div>
            </div>
            {wppUrl && (
              <a href={wppUrl} target="_blank" rel="noopener noreferrer" className="admin-modal-wpp">
                <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                </svg>
                Enviar pelo WhatsApp
              </a>
            )}
            <button className="admin-modal-confirm admin-modal-confirm--ghost" type="button"
              onClick={() => { resetCreateFlow(); if (tokenRef.current) void fetchStats(tokenRef.current); }}
            >
              Fechar
            </button>
          </div>
        </div>
      )}

      {message && <p className="admin-message">{message}</p>}

      {loading ? (
        <div className="admin-client-list">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton skeleton-card" />
          ))}
        </div>
      ) : clients.length === 0 ? (
        <p className="admin-empty">Nenhum cliente encontrado.</p>
      ) : (
        <div className="admin-client-list">
          {clients
            .filter((c) => {
              if (!chartFilter) return true;
              const lastV = stats?.lastVoucherByClient[c.user_id] ?? null;
              const vs = lastV ? voucherStatus(lastV) : "inativo";
              return vs === chartFilter;
            })
            .map((c) => {
              const lastV = stats?.lastVoucherByClient[c.user_id] ?? null;
              const vs = lastV ? voucherStatus(lastV) : null;
              const isExpired = lastV && vs === "inativo" && lastV.data_expiracao && new Date(lastV.data_expiracao).getTime() <= Date.now();
              return (
                <a key={c.user_id} href={`/admin/${c.user_id}`} className="admin-client-row">
                  <div className="admin-client-info">
                    <strong>{c.nome || "Sem nome"}</strong>
                    <span>{c.email || "—"}</span>
                    {lastV && (
                      <span className="admin-client-voucher">
                        <span
                          className={`voucher-status-dot ${vs === "ativo" ? "green" : vs === "vencendo" ? "yellow" : "red"}`}
                          style={{ width: 7, height: 7, display: "inline-block", borderRadius: "50%", marginRight: 4 }}
                        />
                        {lastV.codigo || "sem código"} · {isExpired ? `vencido ${fmtDate(lastV.data_expiracao)}` : `vence ${fmtDate(lastV.data_expiracao)}`}
                      </span>
                    )}
                  </div>
                  <div className="admin-client-tags">
                    {c.categoria && <span className="admin-tag">{c.categoria}</span>}
                    {c.tipo_plano === "cortesia" && <span className="admin-tag admin-tag--courtesy">Cortesia</span>}
                    {c.papel && c.papel !== "user" && (
                      <span className="admin-tag admin-tag--role">{c.papel}</span>
                    )}
                    {vs === "ativo" && <span className="admin-tag admin-tag--active">Ativo</span>}
                    {vs === "vencendo" && <span className="admin-tag admin-tag--warn">Vencendo</span>}
                    {vs === "inativo" && <span className="admin-tag admin-tag--inactive">Inativo</span>}
                    {vs === null && c.ativo === false && (
                      <span className="admin-tag admin-tag--inactive">Inativo</span>
                    )}
                  </div>
                  <span className="admin-chevron">›</span>
                </a>
              );
            })}
        </div>
      )}
    </main>
  );
}
