/**
 * Helpers para diálogos nativos do Tauri (file picker, save, abrir pasta,
 * copiar para clipboard). Todos no-op quando rodando em web puro.
 *
 * Uso típico (Backup):
 *  - pickDbFile()      → seletor de arquivo .db (restauração)
 *  - pickSaveFile()    → "Salvar como" (exportar backup)
 *  - revealInExplorer()→ abrir pasta no Explorer / Finder
 *  - copyToClipboard() → copiar caminho para área de transferência
 */

import { isDesktop } from "@/integrations/data/mode";

export async function pickDbFile(opts?: {
  title?: string;
  defaultPath?: string;
}): Promise<string | null> {
  if (!isDesktop()) return null;
  try {
    const mod = (await import(
      /* @vite-ignore */ "@tauri-apps/plugin-dialog"
    )) as typeof import("@tauri-apps/plugin-dialog");
    const result = await mod.open({
      multiple: false,
      directory: false,
      title: opts?.title ?? "Selecionar backup .db",
      defaultPath: opts?.defaultPath,
      filters: [
        { name: "Backup SQLite", extensions: ["db", "sqlite", "sqlite3"] },
        { name: "Todos os arquivos", extensions: ["*"] },
      ],
    });
    if (typeof result === "string") return result;
    return null;
  } catch (err) {
    console.warn("[nativeDialogs] pickDbFile falhou:", err);
    return null;
  }
}

export async function pickSaveFile(opts?: {
  title?: string;
  defaultPath?: string;
}): Promise<string | null> {
  if (!isDesktop()) return null;
  try {
    const mod = (await import(
      /* @vite-ignore */ "@tauri-apps/plugin-dialog"
    )) as typeof import("@tauri-apps/plugin-dialog");
    const result = await mod.save({
      title: opts?.title ?? "Salvar backup como…",
      defaultPath: opts?.defaultPath,
      filters: [
        { name: "Backup SQLite", extensions: ["db"] },
      ],
    });
    return typeof result === "string" ? result : null;
  } catch (err) {
    console.warn("[nativeDialogs] pickSaveFile falhou:", err);
    return null;
  }
}

export async function pickDirectory(opts?: {
  title?: string;
  defaultPath?: string;
}): Promise<string | null> {
  if (!isDesktop()) return null;
  try {
    const mod = (await import(
      /* @vite-ignore */ "@tauri-apps/plugin-dialog"
    )) as typeof import("@tauri-apps/plugin-dialog");
    const result = await mod.open({
      multiple: false,
      directory: true,
      title: opts?.title ?? "Selecionar pasta",
      defaultPath: opts?.defaultPath,
    });
    return typeof result === "string" ? result : null;
  } catch (err) {
    console.warn("[nativeDialogs] pickDirectory falhou:", err);
    return null;
  }
}

/**
 * Abre uma pasta (ou arquivo) no explorador nativo do SO.
 * No Windows usa `explorer`, no macOS `open`, no Linux `xdg-open`.
 */
export async function revealInExplorer(path: string): Promise<boolean> {
  if (!isDesktop() || !path) return false;
  try {
    const mod = (await import(
      /* @vite-ignore */ "@tauri-apps/plugin-shell"
    )) as typeof import("@tauri-apps/plugin-shell");
    await mod.open(path);
    return true;
  } catch (err) {
    console.warn("[nativeDialogs] revealInExplorer falhou:", err);
    return false;
  }
}

/** Extrai a pasta pai de um path arbitrário (Windows ou POSIX). */
export function dirnameOf(path: string): string {
  if (!path) return "";
  const normalized = path.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx < 0) return path;
  // Mantém separador original
  return path.includes("\\")
    ? path.substring(0, idx).replace(/\//g, "\\")
    : path.substring(0, idx);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  // Usa API web (funciona em desktop também via webview)
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fallback abaixo */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    return true;
  } catch {
    return false;
  }
}
