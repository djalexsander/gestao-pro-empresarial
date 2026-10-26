import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Login com Google via Supabase Auth (sem Lovable Cloud).
 *
 * Web: fluxo de redirecionamento do próprio Supabase. A URL de retorno
 * (`redirectTo`) precisa estar em Authentication > URL Configuration >
 * Redirect URLs do projeto, e o provedor Google precisa estar habilitado
 * (Client ID/Secret do Google Cloud) em Authentication > Providers.
 *
 * Desktop (Tauri): o Google bloqueia login em WebView embutido e a origem
 * do app (tauri://localhost) não é uma URL de retorno válida; por isso o
 * botão não é oferecido no desktop (e-mail e senha continuam disponíveis).
 */
export function loginGoogleDisponivel(desktop: boolean): boolean {
  return !desktop;
}

/** URL de retorno do OAuth: a origem atual, sem barra final. */
export function googleRedirectTo(origin: string): string {
  return origin.replace(/\/+$/, "");
}

export function iniciarLoginGoogle(
  auth: Pick<SupabaseClient["auth"], "signInWithOAuth">,
  origin: string,
) {
  return auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: googleRedirectTo(origin) },
  });
}
