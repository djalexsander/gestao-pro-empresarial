/**
 * Salvamento de arquivos com lembrança de última pasta (desktop/Tauri).
 *
 * - Web: faz download via blob + <a download> (comportamento atual).
 * - Desktop/Tauri: abre diálogo nativo de "Salvar como", grava com fs e
 *   memoriza a última pasta usada por extensão (csv, png, pdf, ...).
 *
 * A chave de última pasta é separada por extensão para que CSVs, PNGs e
 * PDFs possam viver em pastas diferentes sem se atrapalharem.
 */

import { isDesktop } from "@/integrations/data/mode";

export interface SaveResult {
  ok: boolean;
  cancelled?: boolean;
  path?: string;
  error?: string;
}

function lastDirKey(ext: string): string {
  return `gp.savePath.lastDir.${ext.toLowerCase()}`;
}

function getLastDir(ext: string): string | null {
  try {
    return localStorage.getItem(lastDirKey(ext));
  } catch {
    return null;
  }
}

function rememberDir(ext: string, fullPath: string) {
  try {
    const idx = Math.max(fullPath.lastIndexOf("/"), fullPath.lastIndexOf("\\"));
    if (idx > 0) localStorage.setItem(lastDirKey(ext), fullPath.slice(0, idx));
  } catch {}
}

function joinPath(dir: string, file: string): string {
  const sep = dir.includes("\\") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${file}` : `${dir}${sep}${file}`;
}

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot > 0 ? filename.slice(dot + 1).toLowerCase() : "";
}

const FILTER_NAME: Record<string, string> = {
  csv: "Planilha CSV",
  png: "Imagem PNG",
  pdf: "Documento PDF",
  txt: "Texto",
  json: "JSON",
  html: "HTML",
};

/**
 * Salva bytes binários. Em desktop usa diálogo nativo + lembra a pasta.
 * Em web faz download via blob.
 */
export async function saveBytes(
  bytes: Uint8Array,
  filename: string,
  mime: string,
): Promise<SaveResult> {
  const ext = extOf(filename);

  if (isDesktop()) {
    try {
      const dialogMod = (await import(
        /* @vite-ignore */ "@tauri-apps/plugin-dialog"
      )) as typeof import("@tauri-apps/plugin-dialog");
      const fsMod = (await import(
        /* @vite-ignore */ "@tauri-apps/plugin-fs"
      )) as typeof import("@tauri-apps/plugin-fs");

      const lastDir = getLastDir(ext);
      const defaultPath = lastDir ? joinPath(lastDir, filename) : filename;

      const path = await dialogMod.save({
        title: `Salvar ${filename}`,
        defaultPath,
        filters: ext
          ? [{ name: FILTER_NAME[ext] ?? ext.toUpperCase(), extensions: [ext] }]
          : undefined,
      });
      if (!path) return { ok: false, cancelled: true };
      await fsMod.writeFile(path as string, bytes);
      rememberDir(ext, path as string);
      return { ok: true, path: path as string };
    } catch (e) {
      console.error("[desktop-save] erro ao salvar nativo", e);
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // Web: blob download.
  try {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Salva texto (UTF-8). */
export async function saveText(
  text: string,
  filename: string,
  mime: string,
  options: { addBom?: boolean } = {},
): Promise<SaveResult> {
  const prefix = options.addBom ? "\uFEFF" : "";
  const enc = new TextEncoder();
  return saveBytes(enc.encode(prefix + text), filename, mime);
}
