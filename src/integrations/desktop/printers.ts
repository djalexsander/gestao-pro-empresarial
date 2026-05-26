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
  /** Heurística do Rust: nome sugere térmica (POS-58/POS-80/PT260/TM-T/…). */
  is_thermal: boolean;
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
  const list = await invoke<PrinterInfo[]>("list_printers");
  // Garantia defensiva: backend antigo pode não devolver is_thermal.
  return list.map((p) => ({ ...p, is_thermal: Boolean(p.is_thermal) }));
}

/** Imprime bytes de PDF na impressora informada (Windows: SumatraPDF → ShellExecute printto; Unix: lp). */
export async function printPdfBytes(
  bytes: Uint8Array,
  printerName: string,
): Promise<string> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("Impressão nativa só está disponível no desktop.");
  console.info("[printers] printPdfBytes", { printerName, bytes: bytes.byteLength });
  return invoke<string>("print_pdf_bytes", {
    bytes: Array.from(bytes),
    printerName,
  });
}

/**
 * Imprime bytes ESC/POS RAW direto em uma impressora térmica. Não passa
 * por driver de PDF, não usa Start-Process, funciona offline.
 */
export async function printRawEscpos(
  bytes: Uint8Array,
  printerName: string,
): Promise<string> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("Impressão RAW só está disponível no desktop.");
  console.info("[printers] printRawEscpos", {
    printerName,
    bytes: bytes.byteLength,
  });
  return invoke<string>("print_raw_escpos", {
    bytes: Array.from(bytes),
    printerName,
  });
}

/**
 * Imprime um texto plano como cupom ESC/POS. O Rust gera os bytes
 * (init, code page, wrap em colunas, GS V 1 no fim).
 */
export async function printReceiptText(
  text: string,
  printerName: string,
  opts: { widthMm?: 58 | 80; cut?: boolean } = {},
): Promise<string> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("Impressão RAW só está disponível no desktop.");
  const widthMm = opts.widthMm ?? 80;
  const cut = opts.cut ?? true;
  console.info("[printers] printReceiptText", {
    printerName,
    widthMm,
    cut,
    chars: text.length,
  });
  return invoke<string>("print_receipt_text", {
    text,
    printerName,
    widthMm,
    cut,
  });
}

// ---------------------------------------------------------------------------
// Impressoras padrão por máquina (persistidas no DesktopConfig)
//
// Separação por finalidade:
//   - receiptPrinter → cupom/PDV (térmica 58/80mm normalmente).
//   - labelPrinter   → etiquetas de produto (50x30, 60x40, 80x40).
//
// `defaultPrinter` (legado) é mantido como alias do receiptPrinter para
// não quebrar instalações existentes.
// ---------------------------------------------------------------------------

export function getReceiptPrinter(): string | null {
  const cfg = getDesktopConfig();
  return cfg.receiptPrinter ?? cfg.defaultPrinter ?? null;
}

export function setReceiptPrinter(name: string | null): void {
  const cfg = getDesktopConfig();
  setDesktopConfig({
    ...cfg,
    receiptPrinter: name,
    // Mantém o legado em sincronia para retrocompat.
    defaultPrinter: name,
  });
}

export function getReceiptWidthMm(): 58 | 80 {
  const v = getDesktopConfig().receiptWidthMm;
  return v === 58 ? 58 : 80;
}

export function setReceiptWidthMm(width: 58 | 80): void {
  const cfg = getDesktopConfig();
  setDesktopConfig({ ...cfg, receiptWidthMm: width });
}

export function getLabelPrinter(): string | null {
  return getDesktopConfig().labelPrinter ?? null;
}

export function setLabelPrinter(name: string | null): void {
  const cfg = getDesktopConfig();
  setDesktopConfig({ ...cfg, labelPrinter: name });
}

export function getLabelFormat(): string | null {
  return getDesktopConfig().labelFormat ?? null;
}

export function setLabelFormat(format: string | null): void {
  const cfg = getDesktopConfig();
  setDesktopConfig({ ...cfg, labelFormat: format });
}

/** @deprecated use `getReceiptPrinter`. */
export function getDefaultPrinter(): string | null {
  return getReceiptPrinter();
}

/** @deprecated use `setReceiptPrinter`. */
export function setDefaultPrinter(name: string | null): void {
  setReceiptPrinter(name);
}
