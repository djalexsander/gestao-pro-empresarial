import type { TerminalConexaoConfig } from "./types";

const LOCAL_REQUEST_TIMEOUT_MS = 5000;

const tokenRegistry = new Map<string, string>();

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = LOCAL_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(input, {
      ...init,
      signal: init.signal ?? ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export function getBaseUrl(cfg?: TerminalConexaoConfig): string | null {
  if (!cfg?.host || !cfg?.porta) return null;
  const host = cfg.host.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return `http://${host}:${cfg.porta}`;
}

export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

export function resolveTokenForUrl(url: string): string | null {
  for (const [base, token] of tokenRegistry) {
    if (url.startsWith(base)) return token;
  }
  return null;
}

export function registerLocalServerAuth(
  baseUrl: string | null | undefined,
  token: string | null | undefined,
): void {
  if (!baseUrl) return;
  const key = normalizeBaseUrl(baseUrl);
  if (!token) {
    tokenRegistry.delete(key);
    return;
  }
  tokenRegistry.set(key, token);
}

export function clearLocalServerAuth(): void {
  tokenRegistry.clear();
}

export async function postLocalJson<TReq, TRes>(
  cfg: TerminalConexaoConfig | undefined,
  path: string,
  body: TReq,
  authToken?: string | null,
  timeoutMs = 12_000,
): Promise<TRes | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as TRes;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function getLocalJson<T>(
  cfg: TerminalConexaoConfig | undefined,
  path: string,
  query?: Record<string, string | null | undefined>,
): Promise<T | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const url = new URL(`${baseUrl}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v) url.searchParams.set(k, v);
    }
  }
  try {
    const res = await fetchWithTimeout(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getJson<T>(
  cfg: TerminalConexaoConfig | undefined,
  path: string,
): Promise<T | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetchWithTimeout(`${baseUrl}${path}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
