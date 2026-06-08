import type { TerminalConexaoConfig } from "./types";

const LOCAL_REQUEST_TIMEOUT_MS = 5000;
const LOCAL_AUTH_HEADER = "X-Gestao-Token";

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
  const url = `${baseUrl}${path}`;
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    const localToken = resolveTokenForUrl(baseUrl);
    if (localToken) headers[LOCAL_AUTH_HEADER] = localToken;
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    console.info("[local-http] POST", { url, timeoutMs, hasLocalToken: Boolean(localToken), hasAuth: Boolean(authToken) });
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[local-http] POST failed", { url, status: res.status, body: text });
      throw new Error(`Servidor local retornou HTTP ${res.status} em ${path}: ${text || res.statusText}`);
    }
    return (await res.json()) as TRes;
  } catch (error) {
    clearTimeout(timer);
    const isAbort = error instanceof DOMException && error.name === "AbortError";
    console.error("[local-http] POST error", { url, timeoutMs, error });
    if (isAbort) {
      throw new Error(`Servidor local demorou para responder em ${path}. A operação não foi confirmada; tente novamente.`);
    }
    throw error instanceof Error ? error : new Error(String(error));
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
    const localToken = resolveTokenForUrl(baseUrl);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (localToken) headers[LOCAL_AUTH_HEADER] = localToken;
    console.info("[local-http] GET", { url: url.toString(), hasLocalToken: Boolean(localToken) });
    const res = await fetchWithTimeout(url.toString(), {
      headers,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[local-http] GET failed", { url: url.toString(), status: res.status, body: text });
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    console.error("[local-http] GET error", { url: url.toString(), error });
    return null;
  }
}

export async function getJson<T>(
  cfg: TerminalConexaoConfig | undefined,
  path: string,
): Promise<T | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const url = `${baseUrl}${path}`;
  try {
    const localToken = resolveTokenForUrl(baseUrl);
    const headers: Record<string, string> = { Accept: "application/json" };
    if (localToken) headers[LOCAL_AUTH_HEADER] = localToken;
    console.info("[local-http] GET", { url, hasLocalToken: Boolean(localToken) });
    const res = await fetchWithTimeout(url, {
      headers,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn("[local-http] GET failed", { url, status: res.status, body: text });
      return null;
    }
    return (await res.json()) as T;
  } catch (error) {
    console.error("[local-http] GET error", { url, error });
    return null;
  }
}
