/**
 * Impressoras nativas — bridge JS → comandos Rust (Tauri).
 *
 * No web, retorna lista vazia / lança erro com mensagem amigável.
 * No desktop, usa @tauri-apps/api/core invoke().
 */

import { isDesktop } from "@/integrations/data/mode";
import { getDesktopConfig, setDesktopConfig } from "@/integrations/desktop/configStore";
import type { PerfilBobina } from "@/lib/etiqueta-layout";
import {
  definirPadrao as definirPadraoPerfil,
  duplicarPerfil as duplicarPerfilPuro,
  garantirPerfis,
  obterAtivo,
  removerPerfil as removerPerfilPuro,
  selecionarAtivo as selecionarAtivoPuro,
  upsertPerfil as upsertPerfilPuro,
  type EstadoPerfis,
} from "@/lib/etiqueta-perfis";

export interface PrinterInfo {
  name: string;
  status: string | null;
  is_default: boolean;
  /** Heurística do Rust: nome sugere térmica (POS-58/POS-80/PT260/TM-T/…). */
  is_thermal: boolean;
  /** Evidencia conservadora de compatibilidade ESC/POS; nao representa certeza. */
  escpos_support: "likely" | "unknown";
}

export type ReceiptPrintMode = "auto" | "raw" | "driver";
export type ResolvedReceiptPrintMode = Exclude<ReceiptPrintMode, "auto">;

export interface ReceiptPrintResult {
  mode: ResolvedReceiptPrintMode;
  message: string;
}

export type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
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
  return list.map((p) => ({
    ...p,
    is_thermal: Boolean(p.is_thermal),
    escpos_support: p.escpos_support === "likely" ? "likely" : "unknown",
  }));
}

/** Imprime bytes de PDF na impressora informada (Windows: SumatraPDF → ShellExecute printto; Unix: lp). */
export async function printPdfBytes(bytes: Uint8Array, printerName: string): Promise<string> {
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
export async function printRawEscpos(bytes: Uint8Array, printerName: string): Promise<string> {
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
 * Imprime uma ETIQUETA como imagem PNG via GDI/spooler normal do Windows.
 * Caminho separado do cupom ESC/POS — compatível com PT260, Argox,
 * Zebra-GK em modo Windows e qualquer driver GDI. Não passa por handler
 * PDF nem por RAW.
 */
export async function printLabelImage(
  pngBytes: Uint8Array,
  printerName: string,
  copies = 1,
): Promise<string> {
  const invoke = await getInvoke();
  if (!invoke) throw new Error("Impressão de etiqueta só está disponível no desktop.");
  console.info("[printers] printLabelImage", {
    printerName,
    bytes: pngBytes.byteLength,
    copies,
  });
  return invoke<string>("print_label_image", {
    bytes: Array.from(pngBytes),
    printerName,
    copies,
  });
}

/**
 * Imprime uma FOLHA de etiquetas: cada item de `pages` é uma linha da
 * bobina (uma imagem PNG já composta com todas as colunas do perfil lado a
 * lado), enviada como uma página GDI própria dentro do MESMO job de
 * impressão — preserva o avanço contínuo do rolo entre linhas.
 *
 * Caminho central para qualquer tela que imprima etiquetas via perfil de
 * bobina (ver `@/lib/etiqueta-layout` e `@/lib/etiqueta-render`). Não
 * substitui `printLabelImage` (mantido por compat / uso avulso de 1 imagem).
 */
export async function printLabelSheet(
  pages: Uint8Array[],
  printerName: string,
  copies = 1,
  dependencies: { invoke?: TauriInvoke } = {},
): Promise<string> {
  const invoke = dependencies.invoke ?? (await getInvoke());
  if (!invoke) throw new Error("Impressão de etiqueta só está disponível no desktop.");
  console.info("[printers] printLabelSheet", {
    printerName,
    paginas: pages.length,
    copies,
  });
  return invoke<string>("print_label_sheet", {
    pages: pages.map((p) => Array.from(p)),
    printerName,
    copies,
  });
}

export interface PrinterDpi {
  x: number;
  y: number;
}

/**
 * Consulta o DPI relatado pelo driver do Windows para esta impressora
 * (usado pelo modo "Automático" do perfil de bobina). Retorna `null` no web
 * ou se a consulta falhar — quem chama deve cair para um DPI padrão nesse
 * caso (ver `resolveDpi` em `@/lib/etiqueta-layout`).
 */
export async function getPrinterDpi(
  printerName: string,
  dependencies: { invoke?: TauriInvoke } = {},
): Promise<PrinterDpi | null> {
  const invoke = dependencies.invoke ?? (await getInvoke());
  if (!invoke) return null;
  try {
    return await invoke<PrinterDpi>("get_printer_dpi", { printerName });
  } catch (e) {
    console.warn("[printers] getPrinterDpi falhou", e);
    return null;
  }
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

/**
 * Pipeline central de cupom do desktop. O comando Rust valida a impressora,
 * resolve Automatico/RAW/Driver e nunca usa PDF como fallback de cupom.
 */
export async function printReceipt(
  text: string,
  printerName: string,
  opts: {
    mode?: ReceiptPrintMode;
    widthMm?: 58 | 80;
    cut?: boolean;
  } = {},
  dependencies: { invoke?: TauriInvoke } = {},
): Promise<ReceiptPrintResult> {
  const invoke = dependencies.invoke ?? (await getInvoke());
  if (!invoke) throw new Error("Impressao de cupom so esta disponivel no desktop.");
  const mode = opts.mode ?? "auto";
  const widthMm = opts.widthMm ?? 80;
  const cut = opts.cut ?? true;
  console.info("[printers] printReceipt", {
    printerName,
    mode,
    widthMm,
    cut,
    chars: text.length,
  });
  return invoke<ReceiptPrintResult>("print_receipt", {
    text,
    printerName,
    mode,
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

export function getReceiptPrintMode(): ReceiptPrintMode {
  const value = getDesktopConfig().receiptPrintMode;
  return value === "raw" || value === "driver" ? value : "auto";
}

export function setReceiptPrintMode(mode: ReceiptPrintMode): void {
  const cfg = getDesktopConfig();
  setDesktopConfig({ ...cfg, receiptPrintMode: mode });
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

export function getLabelCustomFormats(): string[] {
  const values = getDesktopConfig().labelCustomFormats ?? [];
  return values.filter((v) => /^\d{2,3}x\d{2,3}$/i.test(v));
}

export function addLabelCustomFormat(format: string): void {
  const normalized = format.trim().toLowerCase();
  if (!/^\d{2,3}x\d{2,3}$/.test(normalized)) return;
  const cfg = getDesktopConfig();
  const current = cfg.labelCustomFormats ?? [];
  if (current.includes(normalized)) return;
  setDesktopConfig({ ...cfg, labelCustomFormats: [...current, normalized] });
}

// ---------------------------------------------------------------------------
// Perfis de bobina/etiqueta — persistidos no DesktopConfig (por terminal).
//
// A lista de perfis e o perfil ativo vivem neste terminal (mesmo mecanismo
// já usado para `labelPrinter`/`labelFormat`), então cada máquina mantém
// seus próprios perfis sem interferir em outras. `garantirPerfis` cuida da
// migração a partir do formato legado — ver `@/lib/etiqueta-perfis`.
// ---------------------------------------------------------------------------

function lerEstadoPerfis(): EstadoPerfis {
  const cfg = getDesktopConfig();
  return garantirPerfis(
    { labelProfiles: cfg.labelProfiles, labelProfileId: cfg.labelProfileId ?? null },
    { labelFormat: cfg.labelFormat, labelCustomFormats: cfg.labelCustomFormats },
  );
}

function gravarEstadoPerfis(estado: EstadoPerfis): void {
  const cfg = getDesktopConfig();
  setDesktopConfig({
    ...cfg,
    labelProfiles: estado.labelProfiles,
    labelProfileId: estado.labelProfileId,
  });
}

/** Lista os perfis de bobina cadastrados neste terminal. */
export function getBobinaProfiles(): PerfilBobina[] {
  return lerEstadoPerfis().labelProfiles;
}

/** Perfil de bobina em uso neste terminal (selecionado, com fallback pro padrão). */
export function getActiveBobinaProfile(): PerfilBobina | null {
  return obterAtivo(lerEstadoPerfis());
}

/** Troca qual perfil este terminal usa para imprimir etiquetas — sem alterar o perfil em si. */
export function setActiveBobinaProfileId(id: string): void {
  gravarEstadoPerfis(selecionarAtivoPuro(lerEstadoPerfis(), id));
}

/** Cria (quando `perfil.id` é novo) ou atualiza (quando já existe) um perfil de bobina. */
export function saveBobinaProfile(perfil: PerfilBobina): void {
  gravarEstadoPerfis(upsertPerfilPuro(lerEstadoPerfis(), perfil));
}

/** Duplica um perfil existente com um novo id/nome ("… (cópia)"). Retorna o novo perfil, ou `null` se o id não existir. */
export function duplicateBobinaProfile(id: string): PerfilBobina | null {
  const { estado, novo } = duplicarPerfilPuro(lerEstadoPerfis(), id);
  if (novo) gravarEstadoPerfis(estado);
  return novo;
}

/** Exclui um perfil. Recusa excluir o último perfil restante (sempre sobra ao menos um). */
export function deleteBobinaProfile(id: string): { ok: boolean; mensagem?: string } {
  const { estado, ok, mensagem } = removerPerfilPuro(lerEstadoPerfis(), id);
  if (ok) gravarEstadoPerfis(estado);
  return { ok, mensagem };
}

/** Define qual perfil é o padrão (exclusivo — remove a flag dos demais). */
export function setDefaultBobinaProfile(id: string): void {
  gravarEstadoPerfis(definirPadraoPerfil(lerEstadoPerfis(), id));
}

/** @deprecated use `getReceiptPrinter`. */
export function getDefaultPrinter(): string | null {
  return getReceiptPrinter();
}

/** @deprecated use `setReceiptPrinter`. */
export function setDefaultPrinter(name: string | null): void {
  setReceiptPrinter(name);
}
