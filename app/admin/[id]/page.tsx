"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "../../../utils/supabase/client";

type ClientDetail = {
  nome?: string | null;
  email?: string | null;
  whatsApp?: string | null;
  senha?: string | null;
  categoria?: string | null;
  papel?: string | null;
  ativo?: boolean | null;
  tipo_plano?: string | null;
  tempo?: string | null;
  user_id?: string | null;
  created_at?: string | null;
};

type Voucher = {
  id?: string;
  codigo?: string | null;
  status?: string | null;
  data_expiracao?: string | null;
  tempo_desc?: string | null;
  quota?: number | null;
  usos?: string | number | null;
  qtdObreiros?: number | null;
  created_at?: string | null;
};

function parseUsos(usos?: string | number | null): { used: number; total: number } | null {
  if (usos == null) return null;
  const s = String(usos);
  const [a, b] = s.split("/");
  if (b !== undefined) return { used: Number(a) || 0, total: Number(b) || 0 };
  const n = Number(s);
  return Number.isFinite(n) ? { used: n, total: n } : null;
}

type Financa = {
  id?: string;
  plano_escolhido?: string | null;
  valor_pago?: number | null;
  created_at?: string | null;
};

const twoDays = 172800000;
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

type Category = "Obreiro" | "Aluno" | "Casal" | "Ministério" | "";
type Plan = "Diário" | "Mensal" | "Anual" | "";

const accessPlans = [
  { value: "Diário" as const, title: "Por dias",  description: "Para visitas e períodos curtos",  unit: "dias"  },
  { value: "Mensal" as const, title: "Por meses", description: "Para uma temporada na base",      unit: "meses" },
  { value: "Anual"  as const, title: "Por anos",  description: "Para acesso de longo prazo",      unit: "anos"  },
];

function timeLabel(plan: Plan, amount: string) {
  const v = Number(amount || 1);
  if (plan === "Diário") return v === 1 ? "1 dia"  : `${v} dias`;
  if (plan === "Anual")  return v === 1 ? "1 ano"  : `${v} anos`;
  return v === 1 ? "1 mês" : `${v} meses`;
}
function durationLabel(plan: Plan) {
  if (plan === "Diário") return "Quantos dias de acesso?";
  if (plan === "Anual")  return "Quantos anos de acesso?";
  if (plan === "Mensal") return "Quantos meses de acesso?";
  return "Duração do acesso";
}
function durationUnit(plan: Plan, value?: string) {
  const n = Number(value || 0);
  if (plan === "Diário") return n === 1 ? "dia"  : "dias";
  if (plan === "Mensal") return n === 1 ? "mês"  : "meses";
  if (plan === "Anual")  return n === 1 ? "ano"  : "anos";
  return "tempo";
}
function planDiscountHint(category: Category, plan: Plan, amount: string): string {
  const tempo = Number(amount || 0);
  if (plan === "Diário") {
    if (!tempo)       return "desconto a partir de 15 dias";
    if (tempo >= 20)  return "curta temporada R$ 50";
    if (tempo >= 15)  return "curta temporada R$ 40";
    return "desconto a partir de 15 dias";
  }
  if (plan === "Anual") return category === "Ministério" ? "25% off na base" : "10% off";
  if (plan !== "Mensal") return "";
  if (category === "Ministério") {
    if (!tempo)       return "20% off a partir de 3 meses";
    if (tempo >= 12)  return "25% off na base";
    if (tempo >= 3)   return "20% off na base";
    return "20% off a partir de 3 meses";
  }
  if (category === "Casal") {
    if (tempo === 3)  return "pacote com desconto";
    if (tempo > 3)    return "10% off";
    return "10% off a partir de 3 meses";
  }
  if (category === "Aluno" || category === "Obreiro") {
    if (tempo === 3)  return "R$ 10 off";
    if (tempo > 3)    return "10% off";
    return "10% off a partir de 3 meses";
  }
  return "";
}
function planUnitValue(category: Category, plan: Plan) {
  if (plan === "Diário") return `${money.format(category === "Casal" ? 5 : 3)} / dia`;
  if (plan === "Anual") {
    if (category === "Ministério") return `${money.format(50 * 12 * 0.75)} / ano base`;
    if (category === "Aluno")      return `${money.format(35 * 12 * 0.9)} / ano`;
    if (category === "Casal")      return `${money.format(50 * 12 * 0.9)} / ano`;
    return `${money.format(30 * 12 * 0.9)} / ano`;
  }
  if (category === "Aluno")    return `${money.format(35)} / mês`;
  if (category === "Casal" || category === "Ministério") return `${money.format(50)} / mês`;
  return `${money.format(30)} / mês`;
}
function planPrice(category: Category, plan: Plan, amount: string, people: string) {
  const tempo = Math.max(0, Number(amount || 0));
  const extras = Math.max(0, Number(people || 0) - 3);
  let original = 0, final = 0;
  if (!category || !plan || !tempo) return { original, final, discount: 0 };
  if (plan === "Diário") {
    const unit = category === "Casal" ? 5 : 3;
    original = tempo * unit;
    final = tempo >= 20 ? Math.min(original, 50) : tempo >= 15 ? Math.min(original, 40) : original;
  } else if (plan === "Mensal") {
    if (category === "Aluno")      original = tempo * 35;
    if (category === "Obreiro")    original = tempo * 30;
    if (category === "Casal")      original = tempo * 50;
    if (category === "Ministério") original = tempo * 50 + extras * 15 * tempo;
    final = original;
    if (category === "Aluno" || category === "Obreiro") final = tempo === 3 ? original - 10 : tempo > 3 ? original * 0.9 : original;
    if (category === "Casal")      final = tempo === 3 ? 135 : tempo > 3 ? original * 0.9 : original;
    if (category === "Ministério") { const b = tempo * 50; final = (tempo >= 12 ? b * 0.75 : tempo >= 3 ? b * 0.8 : b) + extras * 15 * tempo; }
  } else if (plan === "Anual") {
    if (category === "Aluno")      original = 35 * 12 * tempo;
    if (category === "Obreiro")    original = 30 * 12 * tempo;
    if (category === "Casal")      original = 50 * 12 * tempo;
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

function daysUntil(value?: string | null): number | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return Math.ceil((d.getTime() - Date.now()) / 86400000);
}

function fmtDate(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
}

function fmtDateWithWeekday(value?: string | null) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const weekday = new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(d);
  const date = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit",
  }).format(d);
  return `${weekday.charAt(0).toUpperCase() + weekday.slice(1)}, ${date}`;
}

function voucherDot(voucher: Voucher): { color: "green" | "yellow" | "red"; label: string } {
  const exp = voucher.data_expiracao ? new Date(voucher.data_expiracao).getTime() : null;
  if (!exp) return { color: "red", label: "Sem data" };
  const now = Date.now();
  if (exp <= now) return { color: "red", label: "Vencido" };
  if (exp <= now + twoDays) return { color: "yellow", label: "Vencendo" };
  return { color: "green", label: "Ativo" };
}

function whatsAppUrl(phone?: string | null): string {
  if (!phone) return "";
  return `https://wa.me/${phone.replace(/\D/g, "")}`;
}

function voucherWhatsAppUrl(
  phone: string | null | undefined,
  nome: string | null | undefined,
  voucher: Voucher,
): string {
  const base = whatsAppUrl(phone);
  if (!base) return "";

  const first = nome?.trim().split(/\s+/)[0] || "cliente";
  const lines = [
    `Olá, ${first}!`,
    "",
    "Seguem seus dados de acesso ao Wi-Fi da Base:",
    "",
    `🔑 *Voucher:* ${voucher.codigo || "pendente"}`,
    `📋 *Plano:* ${voucher.tempo_desc || "—"}`,
    `📅 *Vencimento:* ${fmtDate(voucher.data_expiracao)}`,
  ];
  if (voucher.quota != null) {
    lines.push(`🔢 *Acessos disponíveis:* ${voucher.quota}`);
  }

  return `${base}?text=${encodeURIComponent(lines.join("\n"))}`;
}

function userWhatsAppUrl(cliente: ClientDetail, vouchers: Voucher[]): string {
  const base = whatsAppUrl(cliente.whatsApp);
  if (!base) return "";

  const first = cliente.nome?.trim().split(/\s+/)[0] || "cliente";

  const active = vouchers.find((v) => {
    const exp = v.data_expiracao ? new Date(v.data_expiracao).getTime() : null;
    return v.status === "criado" && exp !== null && exp > Date.now();
  }) ?? vouchers[0] ?? null;

  const lines = [
    `Olá, ${first}!`,
    "",
    `*Email:* ${cliente.email || "—"}`,
    `*Senha:* ${cliente.senha || "—"}`,
    `*Acesso:* https://wifi-manager-react.vercel.app`,
    `*Categoria:* ${cliente.categoria || "—"}`,
  ];

  if (active) {
    const usos = Number.isFinite(Number(active.usos)) ? Number(active.usos) : 0;
    const dot = voucherDot(active);
    lines.push(
      "",
      `📋 *Voucher ${dot.label.toLowerCase()}*`,
      `*Código:* ${active.codigo || "pendente"}`,
      `*Plano:* ${active.tempo_desc || "—"}`,
      `*Vencimento:* ${fmtDate(active.data_expiracao)}`,
    );
    if (active.quota != null) {
      lines.push(`*Acessos:* ${usos} de ${active.quota} usados`);
    }
    const days = daysUntil(active.data_expiracao);
    if (days !== null && days > 0) {
      lines.push(`*Dias restantes:* ${days}`);
    }
  }

  return `${base}?text=${encodeURIComponent(lines.join("\n"))}`;
}

const ROLES = ["user", "admin", "gestor"];

export default function AdminClientPage({ params }: { params: { id: string } }) {
  const [cliente, setCliente] = useState<ClientDetail | null>(null);
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [financas, setFinancas] = useState<Financa[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [papelEdit, setPapelEdit] = useState("user");
  const [saving, setSaving] = useState(false);
  const [renewVoucher, setRenewVoucher] = useState<Voucher | null>(null);
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [updatedVoucher, setUpdatedVoucher] = useState<Voucher | null>(null);
  const [showResult, setShowResult] = useState(false);
  const [loadingResult, setLoadingResult] = useState(false);
  const [showCreateVoucher, setShowCreateVoucher] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [createPlanType, setCreatePlanType] = useState<Plan>("Mensal");
  const [createAmount, setCreateAmount] = useState("1");
  const [createQuota, setCreateQuota] = useState(6);
  const [createValor, setCreateValor] = useState("");
  type CreateStep = "plan" | "pix" | "card" | "cash" | "free";
  const [createStep, setCreateStep] = useState<CreateStep>("plan");
  const [createPixData, setCreatePixData] = useState<{ chargeId: string; qrCodeImage: string; copyPasteCode: string } | null>(null);
  const [createPixCopied, setCreatePixCopied] = useState(false);
  const [createCardData, setCreateCardData] = useState({ holderName: "", number: "", expiry: "", cvv: "", cpf: "" });
  const [stepLoading, setStepLoading] = useState(false);
  const createValorNumRef = useRef(0);
  const tokenRef = useRef<string | null>(null);
  const pendingVoucherIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown === 0) {
      setCountdown(null);
      void refreshVouchers();
      const id = pendingVoucherIdRef.current;
      if (id && tokenRef.current) {
        const tok = tokenRef.current;
        setLoadingResult(true);
        setShowResult(true);
        fetch(`/api/admin/vouchers/${id}?t=${Date.now()}`, { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" })
          .then((r) => r.json())
          .then((d: { voucher?: Voucher }) => {
            if (d.voucher) setUpdatedVoucher(d.voucher);
            setLoadingResult(false);
          })
          .catch(() => setLoadingResult(false));
      } else {
        setShowResult(true);
      }
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c !== null ? c - 1 : null), 1000);
    return () => clearTimeout(t);
  }, [countdown]);

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

      const res = await fetch(`/api/admin/clients/${params.id}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const data = (await res.json()) as {
        cliente?: ClientDetail;
        vouchers?: Voucher[];
        financas?: Financa[];
        error?: string;
      };

      if (data.error || !data.cliente) {
        setMessage(data.error || "Cliente não encontrado.");
        setLoading(false);
        return;
      }

      setCliente(data.cliente);
      setPapelEdit(data.cliente.papel || "user");
      setVouchers(data.vouchers ?? []);
      setFinancas(data.financas ?? []);
      setLoading(false);
    }

    void init();
  }, [params.id]);

  useEffect(() => {
    if (!createPixData || !showCreateVoucher) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/asaas/pix/${createPixData.chargeId}`);
        const d = (await res.json()) as { status?: string };
        if (!cancelled && (d.status === "RECEIVED" || d.status === "CONFIRMED" || d.status === "RECEIVED_IN_CASH")) {
          cancelled = true;
          clearInterval(timer);
          await doCreateVoucher("pix", createValorNumRef.current);
        }
      } catch { /* ignore transient errors */ }
    };
    const timer = setInterval(() => void poll(), 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [createPixData, showCreateVoucher]); // eslint-disable-line react-hooks/exhaustive-deps

  const savePapel = async () => {
    if (!tokenRef.current || !cliente) return;
    setSaving(true);
    setMessage(null);

    const res = await fetch(`/api/admin/clients/${params.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenRef.current}`,
      },
      body: JSON.stringify({ papel: papelEdit }),
    });

    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (data.ok) {
      setCliente((prev) => prev ? { ...prev, papel: papelEdit } : prev);
      setMessage("Papel atualizado com sucesso.");
    } else {
      setMessage(data.error || "Erro ao atualizar papel.");
    }
    setSaving(false);
  };

  const deleteClient = async () => {
    if (!tokenRef.current) return;
    setDeleting(true);
    setDeleteError(null);
    const res = await fetch(`/api/admin/clients/${params.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${tokenRef.current}` },
    });
    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (data.ok) {
      window.location.href = "/admin";
    } else {
      setDeleteError(data.error || "Erro ao excluir.");
      setDeleting(false);
    }
  };

  const copyVoucher = async (voucher: Voucher) => {
    if (!voucher.codigo || !voucher.id) return;
    await navigator.clipboard.writeText(voucher.codigo);
    setCopiedId(voucher.id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const confirmUpdate = async () => {
    if (!tokenRef.current || !renewVoucher?.id) return;
    setUpdating(true);
    setUpdateError(null);

    const days = daysUntil(renewVoucher.data_expiracao);
    const safedays = Math.max(0, days ?? 0);
    const newTempDesc = `${safedays} dias`;

    const res = await fetch(`/api/admin/vouchers/${renewVoucher.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tokenRef.current}`,
      },
      body: JSON.stringify({ tempo_desc: newTempDesc, status: "pendente" }),
    });

    const data = (await res.json()) as { ok?: boolean; error?: string };
    if (data.ok) {
      pendingVoucherIdRef.current = renewVoucher.id ?? null;
      setRenewVoucher(null);
      setCountdown(20);
    } else {
      setUpdateError(data.error || "Erro ao atualizar voucher.");
    }
    setUpdating(false);
  };

  const refreshVouchers = async () => {
    if (!tokenRef.current) return;
    const res = await fetch(`/api/admin/clients/${params.id}`, {
      headers: { Authorization: `Bearer ${tokenRef.current}` },
    });
    const data = (await res.json()) as { vouchers?: Voucher[]; financas?: Financa[] };
    if (data.vouchers) setVouchers(data.vouchers);
    if (data.financas) setFinancas(data.financas);
  };

  const openCreateVoucher = () => {
    setCreateError(null);
    const cat = (cliente?.categoria || "Obreiro") as Category;
    setCreateQuota(cat === "Casal" ? 12 : 6);
    setCreatePlanType("Mensal");
    setCreateAmount("1");
    setCreateStep("plan");
    setCreatePixData(null);
    setCreatePixCopied(false);
    const { final } = planPrice(cat, "Mensal", "1", "3");
    setCreateValor(fmtValorMask(final));
    setShowCreateVoucher(true);
  };

  const doCreateVoucher = async (forma_pagamento: string, valor_pago: number): Promise<boolean> => {
    if (!tokenRef.current) return false;
    setCreating(true);
    const res = await fetch(`/api/admin/clients/${params.id}/voucher`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${tokenRef.current}` },
      body: JSON.stringify({ tempo_desc: timeLabel(createPlanType, createAmount), quota: createQuota, forma_pagamento, valor_pago }),
    });
    const data = (await res.json()) as { ok?: boolean; voucherId?: string; error?: string };
    setCreating(false);
    if (data.ok && data.voucherId) {
      pendingVoucherIdRef.current = data.voucherId;
      setShowCreateVoucher(false);
      setCreateStep("plan");
      setCreatePixData(null);
      setCountdown(20);
      return true;
    }
    setCreateError(data.error || "Erro ao criar voucher.");
    return false;
  };

  const handlePaymentSelect = async (method: "pix" | "card" | "cash" | "free") => {
    if (!createPlanType || !createAmount) { setCreateError("Selecione o plano e informe a duração."); return; }
    setCreateError(null);
    const valorNum = Number(createValor.replace(/\./g, "").replace(",", ".")) || 0;
    createValorNumRef.current = valorNum;
    if (method === "cash") { setCreateStep("cash"); return; }
    if (method === "free") { setCreateStep("free"); return; }
    if (method === "card") {
      setCreateCardData((d) => ({ ...d, holderName: cliente?.nome || "" }));
      setCreateStep("card");
      return;
    }
    // PIX
    setStepLoading(true);
    setCreateStep("pix");
    const res = await fetch("/api/asaas/pix", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reference: crypto.randomUUID(), nome: cliente?.nome || "", email: cliente?.email || "", whatsApp: cliente?.whatsApp || "", valor: valorNum }),
    });
    const pixRes = (await res.json()) as { chargeId?: string; qrCodeImage?: string; copyPasteCode?: string; error?: string };
    setStepLoading(false);
    if (!pixRes.chargeId || !pixRes.qrCodeImage || !pixRes.copyPasteCode) {
      setCreateError(pixRes.error || "Não foi possível gerar o PIX.");
      setCreateStep("plan");
      return;
    }
    setCreatePixData({ chargeId: pixRes.chargeId, qrCodeImage: pixRes.qrCodeImage, copyPasteCode: pixRes.copyPasteCode });
  };

  const submitCard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cliente) return;
    setStepLoading(true);
    setCreateError(null);
    const valorNum = createValorNumRef.current;
    const res = await fetch("/api/asaas/card", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reference: crypto.randomUUID(),
        nome: cliente.nome || "", email: cliente.email || "", whatsApp: cliente.whatsApp || "",
        valor: valorNum,
        cardNumber: createCardData.number, cardHolderName: createCardData.holderName,
        cardExpiry: createCardData.expiry, cardCvv: createCardData.cvv, cpf: createCardData.cpf,
      }),
    });
    const data = (await res.json()) as { chargeId?: string; error?: string };
    if (!data.chargeId) { setStepLoading(false); setCreateError(data.error || "Não foi possível processar o cartão."); return; }
    await doCreateVoucher("cartao", valorNum);
    setStepLoading(false);
  };

  if (countdown !== null) {
    return (
      <main className="admin-page admin-countdown-page">
        <div className="countdown-card motion-in">
          <img className="auth-logo" src="/brand/logo-at-symbol.png" alt="JOCUM AT" />
          <div className="countdown-circle">
            <span className="countdown-number">{countdown}</span>
            <small>segundos</small>
          </div>
          <p className="countdown-title">Atualizando voucher…</p>
          <p className="countdown-subtitle">Aguarde um momento</p>
        </div>
      </main>
    );
  }

  if (loading) {
    return (
      <main className="admin-page">
        <header className="admin-topbar">
          <a href="/admin" className="admin-back">‹ Clientes</a>
          <h1>Carregando…</h1>
        </header>
        <p className="admin-loading">Buscando dados do cliente…</p>
      </main>
    );
  }

  if (!cliente) {
    return (
      <main className="admin-page">
        <header className="admin-topbar">
          <a href="/admin" className="admin-back">‹ Clientes</a>
          <h1>Não encontrado</h1>
        </header>
        <p className="admin-message">{message || "Cliente não encontrado."}</p>
      </main>
    );
  }

  const isMinistry = cliente.categoria === "Ministério";
  const wppUrl = userWhatsAppUrl(cliente, vouchers);

  return (
    <main className="admin-page">
      <header className="admin-topbar">
        <a href="/admin" className="admin-back">‹ Clientes</a>
        <h1>{cliente.nome || "Cliente"}</h1>
      </header>

      <div className="admin-detail-stack">
        {/* ── Dados do usuário ── */}
        <section className="admin-section">
          <h2 className="admin-section-title">Dados do usuário</h2>
          <dl className="admin-field-grid">
            <div className="admin-field">
              <dt>Nome</dt>
              <dd>{cliente.nome || "—"}</dd>
            </div>
            <div className="admin-field">
              <dt>E-mail</dt>
              <dd>{cliente.email || "—"}</dd>
            </div>
            <div className="admin-field">
              <dt>WhatsApp</dt>
              <dd className="admin-field-wpp">
                <span>{cliente.whatsApp || "—"}</span>
                {wppUrl && (
                  <a
                    href={wppUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="admin-wpp-link"
                    aria-label="Abrir WhatsApp"
                  >
                    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                    </svg>
                  </a>
                )}
              </dd>
            </div>
            <div className="admin-field">
              <dt>Categoria</dt>
              <dd>{cliente.categoria || "—"}</dd>
            </div>
            <div className="admin-field">
              <dt>Plano</dt>
              <dd>{cliente.tipo_plano || "—"}</dd>
            </div>
            <div className="admin-field">
              <dt>Período</dt>
              <dd>{cliente.tempo || "—"}</dd>
            </div>
            <div className="admin-field">
              <dt>Ativo</dt>
              <dd>{cliente.ativo ? "Sim" : "Não"}</dd>
            </div>
            <div className="admin-field">
              <dt>Membro desde</dt>
              <dd>{fmtDate(cliente.created_at)}</dd>
            </div>
          </dl>

          <div className="admin-papel-editor">
            <label htmlFor="papel-select" className="admin-papel-label">
              Papel (permissão de acesso)
            </label>
            <div className="admin-papel-row">
              <select
                id="papel-select"
                className="admin-select"
                value={papelEdit}
                onChange={(e) => setPapelEdit(e.target.value)}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>{r}</option>
                ))}
              </select>
              <button
                className="admin-save-button"
                type="button"
                onClick={savePapel}
                disabled={saving || papelEdit === cliente.papel}
              >
                {saving ? "Salvando…" : "Salvar"}
              </button>
            </div>
            {message && <p className="admin-message">{message}</p>}
          </div>

          <button
            className="admin-delete-button"
            type="button"
            onClick={() => { setDeleteError(null); setShowDeleteModal(true); }}
          >
            Excluir cliente
          </button>
        </section>

        {/* ── Dados financeiros ── */}
        <section className="admin-section">
          <div className="admin-section-header">
            <h2 className="admin-section-title">Dados financeiros</h2>
            {financas.length > 0 && (
              <span className="admin-section-count">
                {financas.length} {financas.length === 1 ? "transação" : "transações"}
              </span>
            )}
          </div>
          {financas.length === 0 ? (
            <p className="admin-empty">Nenhum registro financeiro.</p>
          ) : (
            <div className="admin-scroll-container">
              {financas.map((f, i) => (
                <div key={f.id || i} className="admin-financa-row">
                  <div className="admin-financa-field">
                    <span>Data do pagamento</span>
                    <strong>{fmtDateWithWeekday(f.created_at)}</strong>
                  </div>
                  <div className="admin-financa-divider" />
                  <div className="admin-financa-bottom">
                    <div className="admin-financa-field">
                      <span>Plano contratado</span>
                      <strong>{f.plano_escolhido || "—"}</strong>
                    </div>
                    <div className="admin-financa-field admin-financa-field--right">
                      <span>Valor pago</span>
                      <strong className="admin-financa-value">
                        {f.valor_pago != null ? money.format(f.valor_pago) : "—"}
                      </strong>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Vouchers ── */}
        <section className="admin-section">
          <div className="admin-section-header">
            <h2 className="admin-section-title">Vouchers</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {vouchers.length > 0 && (
                <span className="admin-section-count">
                  {vouchers.length} {vouchers.length === 1 ? "voucher" : "vouchers"}
                </span>
              )}
              <button
                className="admin-save-button"
                type="button"
                onClick={openCreateVoucher}
                style={{ padding: "6px 14px", fontSize: "0.82rem" }}
              >
                + Criar
              </button>
            </div>
          </div>
          {vouchers.length === 0 ? (
            <p className="admin-empty">Nenhum voucher encontrado.</p>
          ) : (
            <div className="admin-scroll-container">
              {vouchers.map((v, i) => {
                const dot = voucherDot(v);
                const inactive = dot.color === "red";
                return (
                  <div
                    key={v.id || i}
                    className={`admin-voucher-row${inactive ? " admin-voucher-row--inactive" : ""}`}
                  >
                    <div className="admin-voucher-header">
                      <span
                        className={`voucher-status-dot ${dot.color}`}
                        title={dot.label}
                        aria-label={dot.label}
                      />
                      <code className="admin-voucher-code">{v.codigo || "pendente"}</code>
                      <button
                        className="admin-voucher-copy"
                        type="button"
                        onClick={() => void copyVoucher(v)}
                        aria-label="Copiar voucher"
                        disabled={!v.codigo}
                      >
                        {copiedId === v.id ? "Copiado!" : "⧉"}
                      </button>
                      {(() => {
                        const wpp = voucherWhatsAppUrl(cliente.whatsApp, cliente.nome, v);
                        return wpp ? (
                          <a
                            href={wpp}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="admin-voucher-wpp"
                            aria-label="Enviar pelo WhatsApp"
                          >
                            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                            </svg>
                          </a>
                        ) : null;
                      })()}
                    </div>
                    <div className="admin-voucher-details">
                      <span>
                        Vence: {fmtDate(v.data_expiracao)}
                        {(() => {
                          const d = daysUntil(v.data_expiracao);
                          if (d === null) return null;
                          if (d <= 0) return <em> · vencido</em>;
                          return <em> · {d} dia{d !== 1 ? "s" : ""} restantes</em>;
                        })()}
                      </span>
                      {(() => {
                        const u = parseUsos(v.usos);
                        if (!u) return null;
                        return <span>{u.used}/{u.total} dispositivos</span>;
                      })()}
                      {isMinistry && v.qtdObreiros != null && v.qtdObreiros > 0 && (
                        <span>{v.qtdObreiros} {v.qtdObreiros === 1 ? "obreiro" : "obreiros"}</span>
                      )}
                    </div>
                    <button
                      className="admin-voucher-renew"
                      type="button"
                      onClick={() => { setUpdateError(null); setRenewVoucher(v); }}
                    >
                      Atualizar
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* ── Delete modal ── */}
      {showDeleteModal && (
        <div
          className="admin-modal-backdrop"
          role="presentation"
          onClick={() => !deleting && setShowDeleteModal(false)}
        >
          <div
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="admin-modal-close"
              type="button"
              onClick={() => setShowDeleteModal(false)}
              aria-label="Fechar"
              disabled={deleting}
            >
              ×
            </button>
            <h3 id="delete-title" className="admin-modal-title">Excluir cliente</h3>
            <p className="admin-modal-info admin-modal-info--warn">
              Tem certeza que deseja excluir <strong>{cliente.nome || "este cliente"}</strong>?
              Todos os dados serão removidos permanentemente. Esta ação é <strong>irreversível</strong>.
            </p>
            {deleteError && <p className="admin-modal-error">{deleteError}</p>}
            <button
              className="admin-modal-confirm admin-modal-confirm--danger"
              type="button"
              onClick={deleteClient}
              disabled={deleting}
            >
              {deleting ? "Excluindo…" : "Sim, excluir permanentemente"}
            </button>
            <button
              className="admin-modal-confirm admin-modal-confirm--ghost"
              type="button"
              onClick={() => setShowDeleteModal(false)}
              disabled={deleting}
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* ── Renewal modal ── */}
      {renewVoucher && (
        <div
          className="admin-modal-backdrop"
          role="presentation"
          onClick={() => !updating && setRenewVoucher(null)}
        >
          <div
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="renew-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="admin-modal-close"
              type="button"
              onClick={() => setRenewVoucher(null)}
              aria-label="Fechar"
              disabled={updating}
            >
              ×
            </button>
            <h3 id="renew-title" className="admin-modal-title">Atualizar voucher</h3>
            <code className="admin-modal-code">{renewVoucher.codigo || "pendente"}</code>

            {(() => {
              const days = daysUntil(renewVoucher.data_expiracao);
              if (days === null) return <p className="admin-modal-info">Sem data de vencimento definida.</p>;
              if (days <= 0) return <p className="admin-modal-info admin-modal-info--warn">Voucher vencido há {Math.abs(days)} dia{Math.abs(days) !== 1 ? "s" : ""}.</p>;
              return <p className="admin-modal-info">Falta{days === 1 ? "" : "m"} <strong>{days} dia{days !== 1 ? "s" : ""}</strong> para o vencimento.</p>;
            })()}

            {updateError && <p className="admin-modal-error">{updateError}</p>}

            <button
              className="admin-modal-confirm"
              type="button"
              onClick={confirmUpdate}
              disabled={updating}
            >
              {updating ? "Atualizando…" : "Atualizar"}
            </button>
          </div>
        </div>
      )}

      {/* ── Create voucher modal ── */}
      {showCreateVoucher && (() => {
        const cat = (cliente?.categoria || "Obreiro") as Category;
        const valorNum = createValorNumRef.current;

        const backBtn = (label = "‹ Voltar") => (
          <button className="admin-modal-confirm admin-modal-confirm--ghost" type="button"
            onClick={() => { setCreateStep("plan"); setCreatePixData(null); setCreateError(null); }}
            disabled={creating}
          >{label}</button>
        );

        // ── Pix step ──
        if (createStep === "pix") return (
          <div className="admin-modal-backdrop" role="presentation">
            <div className="admin-modal admin-modal--form" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h3 className="admin-modal-title">Pagamento Pix</h3>
              <p className="admin-modal-info" style={{ textAlign: "center", fontSize: "0.82rem" }}>
                {cliente?.nome} · {money.format(valorNum)} · {timeLabel(createPlanType, createAmount)}
              </p>
              {stepLoading ? (
                <div className="admin-result-loading"><div className="admin-result-spinner" /><p>Gerando QR Code…</p></div>
              ) : createPixData ? (<>
                <img src={`data:image/png;base64,${createPixData.qrCodeImage}`} alt="QR Code PIX"
                  style={{ width: 200, height: 200, display: "block", margin: "0 auto", borderRadius: 8 }} />
                <div className="admin-currency-wrap" style={{ marginTop: 4 }}>
                  <input readOnly value={createPixData.copyPasteCode}
                    style={{ flex: 1, fontSize: 11, fontFamily: "monospace", padding: "8px 10px", border: "none", background: "transparent", color: "#fff7ef", minWidth: 0 }}
                    onFocus={(e) => e.target.select()} />
                  <button className="admin-save-button" type="button" style={{ borderRadius: "0 8px 8px 0", margin: 0 }}
                    onClick={async () => { await navigator.clipboard.writeText(createPixData.copyPasteCode); setCreatePixCopied(true); setTimeout(() => setCreatePixCopied(false), 2000); }}>
                    {createPixCopied ? "Copiado!" : "Copiar"}
                  </button>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, justifyContent: "center" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", display: "inline-block", animation: "pulse 1.5s infinite" }} />
                  <span style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.7)" }}>Aguardando confirmação…</span>
                </div>
              </>) : null}
              {createError && <p className="admin-modal-error">{createError}</p>}
              {backBtn()}
            </div>
          </div>
        );

        // ── Card step ──
        if (createStep === "card") {
          const fmt4 = (v: string) => v.replace(/\D/g, "").slice(0, 16).replace(/(.{4})(?=.)/g, "$1 ");
          const fmtExp = (v: string) => { const d = v.replace(/\D/g, "").slice(0, 4); return d.length > 2 ? `${d.slice(0,2)}/${d.slice(2)}` : d; };
          const fmtCpf = (v: string) => { const d = v.replace(/\D/g, "").slice(0,11); if (d.length<=3) return d; if (d.length<=6) return `${d.slice(0,3)}.${d.slice(3)}`; if (d.length<=9) return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6)}`; return `${d.slice(0,3)}.${d.slice(3,6)}.${d.slice(6,9)}-${d.slice(9)}`; };
          const setCard = (k: keyof typeof createCardData) => (e: React.ChangeEvent<HTMLInputElement>) => setCreateCardData((d) => ({ ...d, [k]: e.target.value }));
          return (
            <div className="admin-modal-backdrop" role="presentation">
              <div className="admin-modal admin-modal--form" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
                <h3 className="admin-modal-title">Cartão de crédito</h3>
                <p className="admin-modal-info" style={{ textAlign: "center", fontSize: "0.82rem" }}>
                  {cliente?.nome} · {money.format(valorNum)} · {timeLabel(createPlanType, createAmount)}
                </p>
                <form className="form-stack" onSubmit={submitCard} style={{ width: "100%" }}>
                  <label>Nome no cartão<input value={createCardData.holderName} onChange={setCard("holderName")} autoComplete="cc-name" required /></label>
                  <label>Número<input value={createCardData.number} onChange={(e) => setCreateCardData((d) => ({ ...d, number: fmt4(e.target.value) }))} inputMode="numeric" placeholder="0000 0000 0000 0000" autoComplete="cc-number" required /></label>
                  <div className="phone-row">
                    <label>Validade<input value={createCardData.expiry} onChange={(e) => setCreateCardData((d) => ({ ...d, expiry: fmtExp(e.target.value) }))} inputMode="numeric" placeholder="MM/AA" autoComplete="cc-exp" required /></label>
                    <label>CVV<input value={createCardData.cvv} onChange={setCard("cvv")} inputMode="numeric" maxLength={4} placeholder="000" autoComplete="cc-csc" required /></label>
                  </div>
                  <label>CPF do titular<input value={createCardData.cpf} onChange={(e) => setCreateCardData((d) => ({ ...d, cpf: fmtCpf(e.target.value) }))} inputMode="numeric" placeholder="000.000.000-00" required /></label>
                  {createError && <p className="admin-modal-error">{createError}</p>}
                  <button className="admin-modal-confirm" type="submit" disabled={stepLoading || creating}>
                    {stepLoading || creating ? "Processando…" : `Pagar ${money.format(valorNum)}`}
                  </button>
                </form>
                {backBtn()}
              </div>
            </div>
          );
        }

        // ── Cash step ──
        if (createStep === "cash") return (
          <div className="admin-modal-backdrop" role="presentation" onClick={() => setCreateStep("plan")}>
            <div className="admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h3 className="admin-modal-title">Dinheiro em espécie</h3>
              <div className="admin-result-grid" style={{ width: "100%" }}>
                <div className="admin-result-row"><span>Cliente</span><strong>{cliente?.nome || "—"}</strong></div>
                <div className="admin-result-row"><span>Plano</span><strong>{timeLabel(createPlanType, createAmount)}</strong></div>
                <div className="admin-result-row"><span>Valor</span><strong style={{ color: "#4ade80" }}>{money.format(valorNum)}</strong></div>
              </div>
              <p className="admin-modal-info" style={{ fontSize: "0.82rem" }}>Confirme o recebimento do dinheiro para gerar o voucher.</p>
              {createError && <p className="admin-modal-error">{createError}</p>}
              <button className="admin-modal-confirm" type="button" disabled={creating}
                onClick={() => void doCreateVoucher("dinheiro", valorNum)}>
                {creating ? "Criando…" : "Confirmar recebimento"}
              </button>
              {backBtn("Cancelar")}
            </div>
          </div>
        );

        // ── Free step ──
        if (createStep === "free") return (
          <div className="admin-modal-backdrop" role="presentation" onClick={() => setCreateStep("plan")}>
            <div className="admin-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
              <h3 className="admin-modal-title">Voucher gratuito</h3>
              <div className="admin-result-grid" style={{ width: "100%" }}>
                <div className="admin-result-row"><span>Cliente</span><strong>{cliente?.nome || "—"}</strong></div>
                <div className="admin-result-row"><span>Plano</span><strong>{timeLabel(createPlanType, createAmount)}</strong></div>
                <div className="admin-result-row"><span>Valor</span><strong>R$ 0,00</strong></div>
              </div>
              <p className="admin-modal-info admin-modal-info--warn" style={{ fontSize: "0.82rem" }}>Ao confirmar, o voucher será gerado sem cobrança.</p>
              {createError && <p className="admin-modal-error">{createError}</p>}
              <button className="admin-modal-confirm" type="button" disabled={creating}
                onClick={() => void doCreateVoucher("gratuito", 0)}>
                {creating ? "Criando…" : "Confirmar voucher gratuito"}
              </button>
              {backBtn("Cancelar")}
            </div>
          </div>
        );

        // ── Plan step (default) ──
        const price = planPrice(cat, createPlanType, createAmount, "3");
        const ready = Boolean(createPlanType && createAmount);
        return (
          <div className="admin-modal-backdrop" role="presentation" onClick={() => setShowCreateVoucher(false)}>
            <div className="admin-modal admin-modal--form" role="dialog" aria-modal="true"
              aria-labelledby="create-title" onClick={(e) => e.stopPropagation()}>
              <button className="admin-modal-close" type="button" onClick={() => setShowCreateVoucher(false)}>×</button>
              <h3 id="create-title" className="admin-modal-title">Criar voucher</h3>
              <p className="admin-modal-info" style={{ fontSize: "0.82rem", textAlign: "center" }}>
                {cliente?.nome || "Cliente"} · {cliente?.categoria || "—"}
              </p>

              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="admin-create-label" style={{ marginBottom: 8 }}>Tempo de acesso desejado</legend>
                <div className="billing-options">
                  {accessPlans.map((plan) => {
                    const hint = planDiscountHint(cat, plan.value, createAmount);
                    return (
                      <button key={plan.value} type="button" role="radio" aria-checked={createPlanType === plan.value}
                        className={createPlanType === plan.value ? "plan-option selected" : "plan-option"}
                        onClick={() => {
                          const amt = plan.value === "Diário" ? "2" : "1";
                          setCreatePlanType(plan.value);
                          setCreateAmount(amt);
                          const { final } = planPrice(cat, plan.value, amt, "3");
                          setCreateValor(fmtValorMask(final));
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
                <label className="admin-create-label">{durationLabel(createPlanType)}</label>
                <span className="duration-input">
                  <input type="text" inputMode="numeric" value={createAmount} disabled={!createPlanType}
                    onChange={(e) => {
                      const val = e.target.value.replace(/\D/g, "").slice(0, 3);
                      setCreateAmount(val);
                      if (val && createPlanType) { const { final } = planPrice(cat, createPlanType, val, "3"); setCreateValor(fmtValorMask(final)); }
                    }}
                    onBlur={() => { if (createPlanType === "Diário" && Number(createAmount) < 2) setCreateAmount("2"); }}
                  />
                  <span>{durationUnit(createPlanType, createAmount)}</span>
                </span>
              </div>

              <div className="package-summary">
                <div>
                  <p>Resumo do plano</p>
                  <ul>
                    <li className="done"><span>✓</span>{cat}</li>
                    <li className={createPlanType ? "done" : ""}><span>{createPlanType ? "✓" : "○"}</span>{createPlanType || "Escolha o tempo"}</li>
                    <li className={createAmount ? "done" : ""}><span>{createAmount ? "✓" : "○"}</span>{createAmount ? timeLabel(createPlanType, createAmount) : "Informe a duração"}</li>
                  </ul>
                </div>
                <div>
                  {ready ? (<>
                    {price.discount > 0 && <span className="old-price">{money.format(price.original)}</span>}
                    <strong>{money.format(price.final)}</strong>
                    <span>{price.discount > 0 ? `Desconto de ${money.format(price.discount)}` : "Sem desconto"}</span>
                    <small>{cat} · {timeLabel(createPlanType, createAmount)}</small>
                  </>) : (<><strong>--</strong><span>Preencha acima</span></>)}
                </div>
              </div>

              <div className="admin-create-field">
                <span className="admin-create-label">Dispositivos (quota)</span>
                <input className="admin-create-input" type="number" min={1} max={200} value={createQuota}
                  onChange={(e) => setCreateQuota(Math.max(1, Number(e.target.value) || 1))} />
              </div>

              <div className="admin-create-field">
                <span className="admin-create-label">Valor a cobrar</span>
                <div className="admin-currency-wrap">
                  <span className="admin-currency-prefix">R$</span>
                  <input className="admin-create-input admin-create-input--currency" type="text" inputMode="numeric"
                    placeholder="0,00" value={createValor}
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 9);
                      if (!digits) { setCreateValor(""); return; }
                      const cents = parseInt(digits, 10);
                      setCreateValor(`${Math.floor(cents / 100).toLocaleString("pt-BR")},${String(cents % 100).padStart(2, "0")}`);
                    }} />
                </div>
              </div>

              {createError && <p className="admin-modal-error">{createError}</p>}

              <p className="admin-create-label" style={{ textAlign: "center" }}>Como o cliente vai pagar?</p>
              <div className="admin-payment-opts">
                {([["pix","Pix"],["card","Cartão"],["cash","Dinheiro"],["free","Gratuito"]] as const).map(([m, label]) => (
                  <button key={m} type="button"
                    className="admin-payment-btn"
                    onClick={() => void handlePaymentSelect(m)}
                    disabled={!ready || stepLoading}
                  >{label}</button>
                ))}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Result modal ── */}
      {showResult && (
        <div className="admin-modal-backdrop" role="presentation">
          <div
            className="admin-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="result-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="result-title" className="admin-modal-title">Voucher gerado</h3>
            {loadingResult ? (
              <div className="admin-result-loading">
                <div className="admin-result-spinner" />
                <p>Carregando dados…</p>
              </div>
            ) : updatedVoucher ? (<>
            <code className="admin-modal-code">{updatedVoucher.codigo || "pendente"}</code>

            <div className="admin-result-grid">
              <div className="admin-result-row">
                <span>Status</span>
                <strong>{updatedVoucher.status || "—"}</strong>
              </div>
              <div className="admin-result-row">
                <span>Plano</span>
                <strong>{updatedVoucher.tempo_desc || "—"}</strong>
              </div>
              <div className="admin-result-row">
                <span>Vencimento</span>
                <strong>{fmtDate(updatedVoucher.data_expiracao)}</strong>
              </div>
              {(() => {
                const u = parseUsos(updatedVoucher.usos);
                if (!u) return null;
                return (
                  <div className="admin-result-row">
                    <span>Dispositivos</span>
                    <strong>{u.used}/{u.total}</strong>
                  </div>
                );
              })()}
            </div>

            {(() => {
              const wpp = voucherWhatsAppUrl(cliente?.whatsApp, cliente?.nome, updatedVoucher);
              return wpp ? (
                <a
                  href={wpp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="admin-modal-wpp"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
                  </svg>
                  Enviar pelo WhatsApp
                </a>
              ) : null;
            })()}

            <button
              className="admin-modal-confirm admin-modal-confirm--ghost"
              type="button"
              onClick={() => { setShowResult(false); setUpdatedVoucher(null); }}
            >
              Fechar
            </button>
            </>) : null}
          </div>
        </div>
      )}
    </main>
  );
}
