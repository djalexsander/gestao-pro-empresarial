/**
 * Impressoras nativas — bridge JS → comandos Rust (Tauri).
 *
 * No web, retorna lista vazia / lança erro com mensagem amigável.
 * No desktop, usa @tauri-apps/api/core invoke().
 */

import { isDesktop } from "@/integrations/data/mode";
import {
  getDesktopConfig,
  setDesktopConfig,
} from "@/integrations/desktop/configStore";

export interface PrinterInfo {
  name: string;
  status: string | null;
  is_default: boolean;
}

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
let cachedInvoke: TauriInvoke | null = null;

async function getInvoke(): Promise<TauriInvoke | null> {
  if (!isDesktop()) return null;
  if (cachedInvoke) return cachedInvoke;
  try {
    const mod = (await import(/* @vite-ignore */ "@tauri-apps/api/core")) as {
      invoke: TauriInvoke;
    };
    cachedInvoke = mod.invoke;
    return cachedInvoke;
  } catch {
    return null;
  }
}

/** Lista impressoras disponíveis no SO desta máquina. */
export async function listPrinters(): Promise<PrinterInfo[]> {
  const invoke = await getInvoke();
  if (!invoke) return [];
  return invoke<PrinterInfo[]>("list_printers");
}

/** Imprime bytes de PDF na impressora informada (via Start-Process PrintTo). */
export async function printPdfBytes(
  bytes: Uint8Array,
  printerName: string,
): Promise<string> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("Impressão nativa só está disponível no desktop.");
  return invoke<string>("print_pdf_bytes", {
    bytes: Array.from(bytes),
    printerName,
  });
}

/**
 * Envia bytes RAW (ESC/POS) direto para o spooler da impressora.
 * Recomendado para impressoras térmicas POS-80 — não depende de
 * aplicativo associado a tipo de arquivo no Windows.
 */
export async function printRawBytes(
  bytes: Uint8Array,
  printerName: string,
): Promise<string> {
  const invoke = await getInvoke();
  if (!invoke)
    throw new Error("Impressão nativa só está disponível no desktop.");
  return invoke<string>("print_raw_bytes", {
    bytes: Array.from(bytes),
    printerName,
  });
}


// ---------------------------------------------------------------------------
// Impressora padrão por máquina (persistida no DesktopConfig)
// ---------------------------------------------------------------------------

export function getDefaultPrinter(): string | null {
  return getDesktopConfig().defaultPrinter ?? null;
}

export function setDefaultPrinter(name: string | null): void {
  const cfg = getDesktopConfig();
  setDesktopConfig({ ...cfg, defaultPrinter: name });
}

// Impressora de etiqueta (separada da impressora de cupom)
export function getDefaultLabelPrinter(): string | null {
  return getDesktopConfig().defaultLabelPrinter ?? null;
}

export function setDefaultLabelPrinter(name: string | null): void {
  const cfg = getDesktopConfig();
  setDesktopConfig({ ...cfg, defaultLabelPrinter: name });
}
