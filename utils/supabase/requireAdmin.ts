import { createAdminClient } from "./admin";

const ADMIN_ROLES = new Set(["admin", "gestor"]);

export async function requireAdmin(request: Request): Promise<string | null> {
  const token = request.headers.get("Authorization")?.replace("Bearer ", "");
  if (!token) { console.error("[requireAdmin] no token"); return null; }

  try {
    const admin = createAdminClient();
    const { data: authData, error: authError } = await admin.auth.getUser(token);
    const userId = authData.user?.id;
    if (authError || !userId) {
      console.error("[requireAdmin] invalid token", authError?.message);
      return null;
    }

    const { data, error } = await admin
      .from("clientes")
      .select("papel")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) { console.error("[requireAdmin] db error", error.message); return null; }
    if (!data?.papel || !ADMIN_ROLES.has(data.papel)) { console.error("[requireAdmin] papel negado", data?.papel); return null; }
    return userId;
  } catch (e) {
    console.error("[requireAdmin] exception", e);
    return null;
  }
}
