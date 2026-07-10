/**
 * Runtime e modo de dados.
 *
 * O app agora e cloud-only: `getDataMode()` sempre retorna `cloud`. O detector
 * de desktop permanece para recursos nativos que nao sao dados locais, como
 * impressao e updater Tauri.
 */

export type DataMode = "cloud";
export type RuntimeShell = "web" | "desktop";

export function getRuntimeShell(): RuntimeShell {
  if (typeof window === "undefined") return "web";
  const w = window as unknown as Record<string, unknown>;
  const g = globalThis as unknown as Record<string, unknown>;
  if (g.isTauri === true) return "desktop";
  if (w.__TAURI__ || w.__TAURI_INTERNALS__) return "desktop";
  const envShell = (import.meta.env.VITE_RUNTIME_SHELL ?? "").toString().trim();
  if (envShell === "desktop") return "desktop";
  return "web";
}

export function isDesktop(): boolean {
  return getRuntimeShell() === "desktop";
}

export function getDataMode(): DataMode {
  return "cloud";
}
