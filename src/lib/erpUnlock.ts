/**
 * Controle de "destravamento" do ERP.
 *
 * Mesmo que o usuário tenha sessão Supabase ativa, o acesso ao ERP só é
 * permitido após uma reconfirmação explícita de senha + verificação de role
 * (admin/gerente). A flag fica em sessionStorage (vive até o fim da aba) e
 * é vinculada ao userId atual para evitar reaproveitamento entre contas.
 */

const KEY = "erp_unlocked_user_id";

export function isErpUnlocked(userId: string | null | undefined): boolean {
  if (!userId || typeof window === "undefined") return false;
  try {
    return sessionStorage.getItem(KEY) === userId;
  } catch {
    return false;
  }
}

export function unlockErp(userId: string) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(KEY, userId);
  } catch {
    /* noop */
  }
}

export function lockErp() {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
