/**
 * Auth — implementação cloud (Supabase). Onda 6.
 *
 * Mantemos isolado do `cloud.ts` (já pesado) para deixar a dependência de auth
 * explícita e fácil de remover no futuro. O `local-terminal` adapter delega
 * direto para esta implementação porque não há banco de auth local.
 */
import { supabase } from "@/integrations/supabase/client";
import type { AuthAdapter } from "../auth-adapter";

export const cloudAuthAdapter: AuthAdapter = {
  async getSession() {
    const { data } = await supabase.auth.getSession();
    return {
      session: data.session,
      access_token: data.session?.access_token ?? null,
    };
  },
  async getUser() {
    const { data } = await supabase.auth.getUser();
    return { user: data.user };
  },
  async getAccessToken() {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  },
  async signInWithPassword(input) {
    const { data, error } = await supabase.auth.signInWithPassword(input);
    return { user: data.user, error: error ?? null };
  },
  async signUp(input) {
    const { data, error } = await supabase.auth.signUp(input);
    return { user: data.user, error: error ?? null };
  },
  async signOut() {
    await supabase.auth.signOut();
  },
  onAuthStateChange(cb) {
    const { data } = supabase.auth.onAuthStateChange(cb);
    return { unsubscribe: () => data.subscription.unsubscribe() };
  },
  async garantirEmpresaAtual() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any).rpc("garantir_empresa_atual");
  },
};
