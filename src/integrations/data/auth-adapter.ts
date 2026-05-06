/**
 * Auth adapter — Onda 6.
 *
 * Centraliza todos os usos de `supabase.auth` em um único contrato. Componentes
 * e hooks NÃO devem mais importar `supabase` diretamente para auth/sessão.
 *
 * Nota: mantemos tipos `User` e `Session` do `@supabase/supabase-js` por serem
 * padrão da indústria e cobrirem o domínio de auth com fidelidade — isso não
 * acopla o app ao Supabase em outros domínios (são tipos puros).
 */
import type { Session, User, AuthChangeEvent } from "@supabase/supabase-js";

export interface AuthSignInInput {
  email: string;
  password: string;
}

export interface AuthSignUpInput {
  email: string;
  password: string;
  options?: {
    emailRedirectTo?: string;
    data?: Record<string, unknown>;
  };
}

export interface AuthSubscription {
  unsubscribe: () => void;
}

export interface AuthAdapter {
  getSession(): Promise<{ session: Session | null; access_token: string | null }>;
  getUser(): Promise<{ user: User | null }>;
  getAccessToken(): Promise<string | null>;
  signInWithPassword(input: AuthSignInInput): Promise<{ user: User | null; error: Error | null }>;
  signUp(input: AuthSignUpInput): Promise<{ user: User | null; error: Error | null }>;
  signOut(): Promise<void>;
  onAuthStateChange(
    cb: (event: AuthChangeEvent, session: Session | null) => void,
  ): AuthSubscription;
  garantirEmpresaAtual(): Promise<void>;
}
