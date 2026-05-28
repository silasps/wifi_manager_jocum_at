import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../../../utils/supabase/admin";

export type SessionState = "guest" | "has-voucher" | "pending-voucher" | "no-voucher";

export interface SessionResponse {
  state: SessionState;
  userName?: string;
  planoTipo?: "free" | "pago";
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) return NextResponse.json<SessionResponse>({ state: "guest" });

  const token = authHeader.replace("Bearer ", "");

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );

  const { data: { user }, error: userError } = await supabase.auth.getUser(token);
  if (userError || !user) return NextResponse.json<SessionResponse>({ state: "guest" });

  const admin = createAdminClient();

  const { data: cliente } = await admin
    .from("clientes")
    .select("nome")
    .eq("user_id", user.id)
    .maybeSingle();

  const userName = cliente?.nome?.trim().split(/\s+/)[0] ?? "";

  const now = new Date().toISOString();
  type VoucherRow = { id: string; status: string; data_expiracao: string | null; tempo_desc: string | null };
  const { data: vouchers } = await admin
    .from("vouchers")
    .select("id, status, data_expiracao, tempo_desc")
    .eq("cliente_id", user.id)
    .order("data_expiracao", { ascending: false }) as { data: VoucherRow[] | null };

  if (!vouchers || vouchers.length === 0) {
    return NextResponse.json<SessionResponse>({ state: "no-voucher", userName });
  }

  const active = vouchers.find(
    (v) =>
      (v.status === "criado" || v.status === "Quase venc.") &&
      (v.tempo_desc?.toLowerCase() === "ilimitado" || (v.data_expiracao && new Date(v.data_expiracao).getTime() > Date.now())),
  );
  const pending = vouchers.find((v) => v.status === "pendente");

  function planoFromVoucher(v: VoucherRow): "free" | "pago" {
    return v.tempo_desc?.toLowerCase() === "ilimitado" ? "free" : "pago";
  }

  if (active) {
    return NextResponse.json<SessionResponse>({ state: "has-voucher", userName, planoTipo: planoFromVoucher(active) });
  }
  if (pending) {
    return NextResponse.json<SessionResponse>({ state: "pending-voucher", userName, planoTipo: planoFromVoucher(pending) });
  }

  return NextResponse.json<SessionResponse>({ state: "no-voucher", userName });
}
