/**
 * Cache local seguro para login offline do ERP (Desktop/Tauri).
 *
 * Armazena APENAS hash PBKDF2-SHA256 + salt da senha do administrador,
 * junto com userId, e-mail normalizado e papéis. A senha em texto puro
 * nunca é persistida.
 *
 * Estrutura: localStorage["erp_offline_cache_v1"] = ErpOfflineEntry[]
 */

import { isDesktop } from "@/integrations/data/mode";

const STORAGE_KEY = "erp_offline_cache_v1";
const ITERATIONS = 120_000;
const KEY_LEN = 32; // bytes

export interface ErpOfflineEntry {
  email: string;
  userId: string;
  salt: string; // base64
  hash: string; // base64
  roles: string[];
  updatedAt: number;
}

function canUseLocalStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function bytesToB64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer, iterations: ITERATIONS },
    baseKey,
    KEY_LEN * 8,
  );
  return bytesToB64(bits);
}

function readAll(): ErpOfflineEntry[] {
  if (!canUseLocalStorage()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(entries: ErpOfflineEntry[]) {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* noop */
  }
}

function normEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Salva/atualiza a entrada offline após login online bem-sucedido. */
export async function saveOfflineCredential(params: {
  email: string;
  password: string;
  userId: string;
  roles: string[];
}): Promise<void> {
  if (!isDesktop()) return;
  if (typeof crypto?.subtle === "undefined") return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(params.password, salt);
  const entry: ErpOfflineEntry = {
    email: normEmail(params.email),
    userId: params.userId,
    salt: bytesToB64(salt),
    hash,
    roles: params.roles,
    updatedAt: Date.now(),
  };
  const all = readAll().filter((e) => e.email !== entry.email);
  all.push(entry);
  writeAll(all);
}

/** Retorna a entrada local para um e-mail, se existir. */
export function findOfflineEntry(email: string): ErpOfflineEntry | null {
  const target = normEmail(email);
  return readAll().find((e) => e.email === target) ?? null;
}

export function hasAnyOfflineEntry(): boolean {
  return readAll().length > 0;
}

/** Verifica senha contra a entrada local. */
export async function verifyOfflineCredential(
  email: string,
  password: string,
): Promise<ErpOfflineEntry | null> {
  if (!isDesktop()) return null;
  if (typeof crypto?.subtle === "undefined") return null;
  const entry = findOfflineEntry(email);
  if (!entry) return null;
  const salt = b64ToBytes(entry.salt);
  const hash = await pbkdf2(password, salt);
  // Comparação em tempo constante simples
  if (hash.length !== entry.hash.length) return null;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) {
    diff |= hash.charCodeAt(i) ^ entry.hash.charCodeAt(i);
  }
  return diff === 0 ? entry : null;
}

/** Detecta se o erro retornado pelo signIn é falha de rede. */
export function isNetworkAuthError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : (err as { message?: string })?.message ?? "";
  const m = msg.toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("network") ||
    m.includes("networkerror") ||
    m.includes("timeout") ||
    m.includes("fetch") ||
    m.includes("load failed") ||
    m.includes("err_internet") ||
    m.includes("err_network")
  );
}

/** Promise.race com timeout que rejeita com erro de rede amigável. */
export function withAuthTimeout<T>(p: Promise<T>, ms = 6000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("network timeout")), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}
