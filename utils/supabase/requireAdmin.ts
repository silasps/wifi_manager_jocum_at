import { createAdminClient } from "./admin";

function jwtUserId(token: string): string | null {
  try {
    const b64 = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    return (payload.sub as string) ?? null;
  } catch {
    return null;
  }
}

export async function requireAdmin(request: Request): Promise<string | null> {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) { console.error("[requireAdmin] no token"); return null; }

  const userId = jwtUserId(token);
  if (!userId) { console.error("[requireAdmin] jwt decode failed"); return null; }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("clientes")
      .select("papel")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) { console.error("[requireAdmin] db error", error.message); return null; }
    if (!data?.papel || data.papel === "user") { console.error("[requireAdmin] papel negado", data?.papel); return null; }
    return userId;
  } catch (e) {
    console.error("[requireAdmin] exception", e);
    return null;
  }
}
