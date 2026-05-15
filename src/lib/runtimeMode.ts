/**
 * ============================================================================
 * runtimeMode — Detecção unificada do modo de operação
 * ============================================================================
 *
 * Combina três sinais já existentes no projeto em UMA função simples para
 * uso pela UI de diagnóstico (Etapa 1 do plano offline-first):
 *
 *   - `getDataMode()`            → cloud | local-server | local-terminal | hybrid
 *   - `getRuntimeShell()`        → web | desktop (Tauri)
 *   - `useNetworkStatus()`       → online (probe HTTP real)
 *
 * Resultado em 4 estados que o usuário entende:
 *
 *   - "online-cloud"        → web/desktop usando Supabase, internet OK
 *   - "desktop-server"      → este PC é o SERVIDOR LOCAL da loja
 *   - "desktop-terminal"    → este PC é um TERMINAL/CAIXA conectado via LAN
 *   - "offline"             → sem internet E sem servidor local detectado
 *
 * Este helper é PURO (sem efeitos colaterais) e NÃO substitui nenhum dos
 * mecanismos existentes — só centraliza a leitura para diagnóstico.
 */

import { getDataMode, getRuntimeShell, type DataMode } from "@/integrations/data/mode";

export type RuntimeMode =
  | "online-cloud"
  | "desktop-server"
  | "desktop-terminal"
  | "offline";

export interface RuntimeModeSnapshot {
  mode: RuntimeMode;
  shell: "web" | "desktop";
  dataMode: DataMode;
  online: boolean;
  /** Mensagem curta legível para mostrar no rodapé/diagnóstico. */
  label: string;
}

export function resolveRuntimeMode(online: boolean): RuntimeModeSnapshot {
  const shell = getRuntimeShell();
  const dataMode = getDataMode();

  let mode: RuntimeMode;
  if (dataMode === "local-server") mode = "desktop-server";
  else if (dataMode === "local-terminal") mode = "desktop-terminal";
  else if (!online) mode = "offline";
  else mode = "online-cloud";

  const label =
    mode === "desktop-server"
      ? "Servidor local da loja (SQLite)"
      : mode === "desktop-terminal"
        ? online
          ? "Terminal conectado ao servidor local"
          : "Terminal — usando cache local (sem internet)"
        : mode === "offline"
          ? "Sem internet — operando em modo de leitura"
          : "Conectado à nuvem (Supabase)";

  return { mode, shell, dataMode, online, label };
}
