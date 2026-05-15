/**
 * ============================================================================
 * Cache local seguro para validação de PIN de operadores offline (Etapa 4).
 * ============================================================================
 *
 * Espelha a regra do `erpOfflineCache`, mas para o PIN do PDV.
 *
 * - Após uma validação ONLINE bem-sucedida, salvamos localmente apenas um
 *   verificador PBKDF2-SHA-256 (salt + hash). O PIN em texto puro NUNCA
 *   é persistido.
 * - Quando estiver offline (sem internet ou local-server adapter ativo),
 *   o PIN digitado é validado contra o verificador local.
 * - Política de lockout local: 5 falhas em 10 min ⇒ 15 min de bloqueio
 *   (paralelo ao Bloco 11 server-side). Auditoria ainda é gerada online
 *   quando a internet voltar (a próxima validação online registra).
 *
 * Estrutura: localStorage["operador_offline_cache_v1"] = OperadorOfflineEntry[]
 */

import { isDesktop } from "@/integrations/data/mode";
import type { OperadorSessaoDomain } from "@/integrations/data";

const STORAGE_KEY = "operador_offline_cache_v1";
const ITERATIONS = 80_000;
const KEY_LEN = 32;

const MAX_FAILS = 5;
const FAIL_WINDOW_MS = 10 * 60_000;
const LOCKOUT_MS = 15 * 60_000;

export interface OperadorOfflineEntry {
  funcionario_id: string;
  nome: string;
  login: string;
  role: "gerente" | "caixa";
  salt: string; // base64
  hash: string; // base64
  updatedAt: number;
  // Tentativas locais (persistem entre reloads).
  failedAttempts: { at: number }[];
  lockedUntil: number; // ms epoch (0 = não bloqueado)
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

async function pbkdf2(pin: string, salt: Uint8Array): Promise<string> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt.buffer.slice(salt.byteOffset, salt.byteOffset + salt.byteLength) as ArrayBuffer,
      iterations: ITERATIONS,
    },
    baseKey,
    KEY_LEN * 8,
  );
  return bytesToB64(bits);
}

function readAll(): OperadorOfflineEntry[] {
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
function writeAll(entries: OperadorOfflineEntry[]) {
  if (!canUseLocalStorage()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    /* noop */
  }
}

export function hasOperadorOffline(funcionarioId: string): boolean {
  return readAll().some((e) => e.funcionario_id === funcionarioId);
}

export function findOperadorOfflineEntry(
  funcionarioId: string,
): OperadorOfflineEntry | null {
  return readAll().find((e) => e.funcionario_id === funcionarioId) ?? null;
}

/** Salva/atualiza verificador após validação ONLINE bem-sucedida. */
export async function saveOperadorPin(params: {
  funcionario_id: string;
  nome: string;
  login: string;
  role: "gerente" | "caixa";
  pin: string;
}): Promise<void> {
  if (!isDesktop()) return;
  if (typeof crypto?.subtle === "undefined") return;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(params.pin, salt);
  const all = readAll().filter((e) => e.funcionario_id !== params.funcionario_id);
  all.push({
    funcionario_id: params.funcionario_id,
    nome: params.nome,
    login: params.login,
    role: params.role,
    salt: bytesToB64(salt),
    hash,
    updatedAt: Date.now(),
    failedAttempts: [],
    lockedUntil: 0,
  });
  writeAll(all);
}

function pruneFailures(list: { at: number }[], now: number) {
  return list.filter((f) => now - f.at < FAIL_WINDOW_MS);
}

export class OperadorOfflineError extends Error {
  code: "no-cache" | "wrong-pin" | "locked" | "no-crypto";
  remainingMs?: number;
  constructor(code: OperadorOfflineError["code"], message: string, remainingMs?: number) {
    super(message);
    this.code = code;
    this.remainingMs = remainingMs;
  }
}

/**
 * Valida PIN contra o cache local. Lança `OperadorOfflineError` em caso de
 * falha, com mensagens já amigáveis para o toast.
 */
export async function verifyOperadorPinOffline(
  funcionarioId: string,
  pin: string,
): Promise<OperadorSessaoDomain> {
  if (typeof crypto?.subtle === "undefined") {
    throw new OperadorOfflineError("no-crypto", "Validação offline indisponível neste dispositivo.");
  }
  const all = readAll();
  const entry = all.find((e) => e.funcionario_id === funcionarioId);
  if (!entry) {
    throw new OperadorOfflineError(
      "no-cache",
      "PIN offline indisponível. Faça a sincronização inicial com internet antes de usar o PDV offline.",
    );
  }

  const now = Date.now();
  if (entry.lockedUntil && entry.lockedUntil > now) {
    const sec = Math.ceil((entry.lockedUntil - now) / 1000);
    throw new OperadorOfflineError(
      "locked",
      `Operador temporariamente bloqueado. Tente novamente em ${sec} segundo(s).`,
      entry.lockedUntil - now,
    );
  }

  const salt = b64ToBytes(entry.salt);
  const hash = await pbkdf2(pin, salt);

  let ok = hash.length === entry.hash.length;
  if (ok) {
    let diff = 0;
    for (let i = 0; i < hash.length; i++) {
      diff |= hash.charCodeAt(i) ^ entry.hash.charCodeAt(i);
    }
    ok = diff === 0;
  }

  if (!ok) {
    // Registra falha local + aplica lockout se necessário.
    const fails = pruneFailures(entry.failedAttempts ?? [], now);
    fails.push({ at: now });
    entry.failedAttempts = fails;
    if (fails.length >= MAX_FAILS) {
      entry.lockedUntil = now + LOCKOUT_MS;
      writeAll(all);
      throw new OperadorOfflineError(
        "locked",
        `Muitas tentativas inválidas. Operador bloqueado por ${Math.round(LOCKOUT_MS / 60000)} minuto(s).`,
        LOCKOUT_MS,
      );
    }
    writeAll(all);
    const restantes = MAX_FAILS - fails.length;
    throw new OperadorOfflineError(
      "wrong-pin",
      `PIN incorreto. ${restantes} tentativa(s) restante(s).`,
    );
  }

  // Sucesso → limpa contador local.
  entry.failedAttempts = [];
  entry.lockedUntil = 0;
  writeAll(all);
  return {
    id: entry.funcionario_id,
    nome: entry.nome,
    login: entry.login,
    role: entry.role,
  };
}

/** Remove cache de um operador (ex.: funcionário inativado/excluído). */
export function clearOperadorOfflineEntry(funcionarioId: string) {
  writeAll(readAll().filter((e) => e.funcionario_id !== funcionarioId));
}
