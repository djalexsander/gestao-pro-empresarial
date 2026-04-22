/**
 * Controle de "destravamento" do ERP.
 *
 * Mesmo que o usuário tenha sessão Supabase ativa, o acesso ao ERP só é
 * permitido após uma reconfirmação explícita de senha + verificação de role
 * (admin/gerente). A flag fica em sessionStorage (vive até o fim da aba) e
 * é vinculada ao userId atual para evitar reaproveitamento entre contas.
 */

const KEY = "erp_unlocked_user_id";

function canUseSessionStorage() {
  return typeof window !== "undefined" && typeof window.sessionStorage !== "undefined";
}

export function isErpUnlockReady(): boolean {
  return canUseSessionStorage();
}

export function isErpUnlocked(userId: string | null | undefined): boolean {
  if (!userId || !canUseSessionStorage()) return false;
  try {
    return sessionStorage.getItem(KEY) === userId;
  } catch {
    return false;
  }
}

export function unlockErp(userId: string) {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.setItem(KEY, userId);
  } catch {
    /* noop */
  }
}

export function lockErp() {
  if (!canUseSessionStorage()) return;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* noop */
  }
}
