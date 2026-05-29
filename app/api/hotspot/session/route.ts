import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createAdminClient } from "../../../../utils/supabase/admin";

export type SessionState = "guest" | "has-voucher" | "pending-voucher" | "no-voucher";

export interface SessionResponse {
  state: SessionState;
  userName?: string;
  planoTipo?: "free" | "pago";
  auth_id?: string;
}

const MAC_REGEX = /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/;

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
      (v.tempo_desc?.toLowerCase() === "ilimitado" ||
        (v.data_expiracao && new Date(v.data_expiracao).getTime() > Date.now())),
  );
  const pending = vouchers.find((v) => v.status === "pendente");

  function planoFromVoucher(v: VoucherRow): "free" | "pago" {
    return v.tempo_desc?.toLowerCase() === "ilimitado" ? "free" : "pago";
  }

  if (active) {
    // Se MAC foi passado, cria/recupera registro de autorização server-side
    // (evita chamada extra do browser do portal cativo para /authorize)
    const macRaw = new URL(request.url).searchParams.get("mac");
    const mac = macRaw?.toLowerCase().trim();
    let auth_id: string | undefined;

    if (mac && MAC_REGEX.test(mac)) {
      const { data: existing } = await admin
        .from("autorizacoes")
        .select("id, status")
        .eq("cliente_id", user.id)
        .eq("mac_address", mac)
        .in("status", ["autorizado", "pendente"])
        .order("status", { ascending: true }) // "autorizado" antes de "pendente"
        .limit(1);

      if (existing && existing.length > 0) {
        auth_id = existing[0].id;
      } else {
        const isIlimitado = active.tempo_desc?.toLowerCase() === "ilimitado";
        const minutosRestantes = isIlimitado
          ? 14400
          : Math.max(1, Math.floor((new Date(active.data_expiracao!).getTime() - Date.now()) / 60000));

        const { data: inserted } = await admin
          .from("autorizacoes")
          .insert({ cliente_id: user.id, mac_address: mac, minutos: minutosRestantes, status: "pendente" })
          .select("id")
          .single();

        if (inserted) auth_id = inserted.id;
      }
    }

    return NextResponse.json<SessionResponse>({
      state: "has-voucher",
      userName,
      planoTipo: planoFromVoucher(active),
      auth_id,
    });
  }

  if (pending) {
    return NextResponse.json<SessionResponse>({ state: "pending-voucher", userName, planoTipo: planoFromVoucher(pending) });
  }

  return NextResponse.json<SessionResponse>({ state: "no-voucher", userName });
}
