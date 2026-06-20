/**
 * ============================================================================
 * Bridge JS → Comandos Tauri do backend local
 * ============================================================================
 *
 * Em web (sem Tauri), retorna no-op com `running: false`. No desktop, chama
 * os comandos Rust expostos em `src-tauri/src/lib.rs`.
 *
 * Importação dinâmica de `@tauri-apps/api/core` evita quebrar o build web —
 * o pacote pode nem estar instalado fora do ambiente desktop.
 */

import { isDesktop } from "@/integrations/data/mode";

export interface LocalServerStatus {
  running: boolean;
  port: number | null;
  started_at: number | null;
  server_name: string | null;
  server_id: string | null;
  hostname: string | null;
  app: string;
  version: string;
  upstream_configured?: boolean;
  terminals_conectados?: number;
  /** Token de pareamento que o backend local exige (X-Gestao-Token). */
  auth_token?: string | null;
}

const STATUS_OFF: LocalServerStatus = {
  running: false,
  port: null,
  started_at: null,
  server_name: null,
  server_id: null,
  hostname: null,
  app: "Gestao Pro",
  version: "0",
  upstream_configured: false,
  terminals_conectados: 0,
  auth_token: null,
};

type TauriInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
type TauriUnlisten = () => void;

let cachedInvoke: TauriInvoke | null = null;
let lastLocalServerStatus: LocalServerStatus | null = null;
let nativeStartInFlight: Promise<LocalServerStatus> | null = null;

export function isLocalServerStartInProgress(): boolean {
  return nativeStartInFlight !== null;
}

export function isLocalServerLifecycleTransition(error: unknown): boolean {
  const message = String(error).toLowerCase();
  return (
    message.includes("stop_in_progress") ||
    message.includes("start_in_progress")
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${label} demorou para responder (${timeoutMs}ms).`));
      }, timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

async function getInvoke(): Promise<TauriInvoke | null> {
  if (!isDesktop()) return null;
  if (cachedInvoke) return cachedInvoke;

  const win = typeof window !== "undefined" ? window as unknown as Record<string, unknown> : null;
  if (win && !win.__TAURI__ && !win.__TAURI_INTERNALS__) {
    console.warn("[tauriBridge] runtime Tauri não detectado; invoke indisponível");
    return null;
  }

  try {
    // Import dinâmico — só existe no bundle desktop.
    const mod = (await import(/* @vite-ignore */ "@tauri-apps/api/core")) as {
      invoke?: TauriInvoke;
    };
    if (typeof mod.invoke !== "function") {
      console.warn("[tauriBridge] invoke não disponível no módulo Tauri");
      return null;
    }

    const wrappedInvoke = async <T>(
      cmd: string,
      args?: Record<string, unknown>,
    ): Promise<T> => {
      try {
        return (await mod.invoke!.call(mod, cmd, args)) as T;
      } catch (error) {
        const msg = String(error).toLowerCase();
        if (msg.includes("cannot read properties") || msg.includes("undefined")) {
          cachedInvoke = null;
        }
        throw error;
      }
    };

    cachedInvoke = wrappedInvoke as TauriInvoke;
    return wrappedInvoke as TauriInvoke;
  } catch (error) {
    console.warn("[tauriBridge] getInvoke falhou", error);
    return null;
  }
}

export interface StartLocalServerOptions {
  port: number;
  serverName: string | null;
  serverId?: string | null;
  upstreamUrl?: string | null;
  upstreamAnonKey?: string | null;
  /**
   * Token previamente persistido. Quando informado, o backend reusa esse
   * mesmo token (não gera um novo). Mantém terminais pareados funcionando
   * entre reinícios do servidor.
   */
  authToken?: string | null;
}

export async function startLocalServer(
  opts: StartLocalServerOptions,
): Promise<LocalServerStatus> {
  const invoke = await getInvoke();
  if (!invoke) {
    if (isDesktop()) {
      throw new Error("API Tauri indisponível para iniciar o servidor local.");
    }
    return STATUS_OFF;
  }
  if (!nativeStartInFlight) {
    console.info("[START REQUEST]", { port: opts.port });
    const invoked = invoke<LocalServerStatus>("start_local_server", {
      port: opts.port,
      serverName: opts.serverName,
      serverId: opts.serverId ?? null,
      upstreamUrl: opts.upstreamUrl ?? null,
      upstreamAnonKey: opts.upstreamAnonKey ?? null,
      authToken: opts.authToken ?? null,
    });
    const tracked = invoked
      .then((status) => {
        lastLocalServerStatus = status;
        return status;
      })
      .finally(() => {
        nativeStartInFlight = null;
      });
    nativeStartInFlight = tracked;
    console.info("[START ACCEPTED]", { port: opts.port });
  } else {
    console.warn("[START REJECTED_ALREADY_RUNNING]", { port: opts.port });
  }
  const startPromise = nativeStartInFlight!;
  const status = await withTimeout(
    startPromise,
    12_000,
    "start_local_server",
  ).catch(async (error) => {
    console.warn("[tauriBridge] start_local_server timeout; verificando status final", {
      port: opts.port,
      error,
    });
    try {
      const recovered = await withTimeout(
        invoke<LocalServerStatus>("local_server_status"),
        5_000,
        "local_server_status after start timeout",
      );
      if (recovered.running && (recovered.port === opts.port || recovered.port == null)) {
        console.warn("[tauriBridge] start_local_server recuperado pelo status do daemon", {
          port: recovered.port,
          running: recovered.running,
        });
        return recovered;
      }
    } catch (statusError) {
      console.warn("[tauriBridge] status apos timeout de start tambem falhou", statusError);
    }
    throw error;
  });
  lastLocalServerStatus = status;
  return status;
}

export async function stopLocalServer(
  requestedBy: string,
): Promise<LocalServerStatus> {
  const invoke = await getInvoke();
  if (!invoke) {
    if (isDesktop()) {
      console.error("[tauriBridge] stop_local_server indisponivel: invoke Tauri nao carregou");
      throw new Error("API Tauri indisponível para parar o servidor local.");
    }
    return STATUS_OFF;
  }
  const status = await withTimeout(
    invoke<LocalServerStatus>("stop_local_server", { requestedBy }),
    10_000,
    "stop_local_server",
  );
  lastLocalServerStatus = status;
  return status;
}

export async function getLocalServerStatus(): Promise<LocalServerStatus> {
  const invoke = await getInvoke();
  if (!invoke) return STATUS_OFF;
  try {
    const status = await withTimeout(
      invoke<LocalServerStatus>("local_server_status"),
      3_000,
      "local_server_status",
    );
    const normalized =
      !status.running && status.port == null && lastLocalServerStatus?.port != null
        ? { ...status, port: lastLocalServerStatus.port }
        : status;
    lastLocalServerStatus = normalized;
    return normalized;
  } catch (error) {
    console.warn("[tauriBridge] local_server_status falhou; preservando ultimo status conhecido", error);
    return lastLocalServerStatus ?? STATUS_OFF;
  }
}

export async function hasDesktopCaixaAberto(): Promise<boolean | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return await withTimeout(
      invoke<boolean>("desktop_has_caixa_aberto"),
      2_000,
      "desktop_has_caixa_aberto",
    );
  } catch (error) {
    console.warn("[tauriBridge] desktop_has_caixa_aberto falhou", error);
    return null;
  }
}

export async function setDesktopCaixaExitGuard(hasCaixaAberto: boolean): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  try {
    await invoke<void>("desktop_set_caixa_exit_guard", {
      hasCaixaAberto,
    });
  } catch (error) {
    console.warn("[tauriBridge] desktop_set_caixa_exit_guard falhou", error);
  }
}

export async function listenDesktopCaixaCloseBlocked(
  callback: (message: string) => void,
): Promise<TauriUnlisten | null> {
  if (!isDesktop()) return null;
  try {
    const mod = (await import(/* @vite-ignore */ "@tauri-apps/api/event")) as {
      listen?: (
        event: string,
        handler: (event: { payload?: unknown }) => void,
      ) => Promise<TauriUnlisten>;
    };
    if (typeof mod.listen !== "function") return null;
    return await mod.listen("gp://caixa-close-blocked", (event) => {
      callback(
        typeof event.payload === "string"
          ? event.payload
          : "Existe um caixa aberto. Feche o caixa antes de encerrar o aplicativo.",
      );
    });
  } catch (error) {
    console.warn("[tauriBridge] listenDesktopCaixaCloseBlocked falhou", error);
    return null;
  }
}

export interface DesktopAuthorizedUser {
  user_id: string;
  email: string;
}

export interface DesktopAuthorizedUserStatus {
  exists: boolean;
  user_id?: string | null;
  email?: string | null;
}

export interface DesktopFuncionarioLocalRow {
  funcionario_id: string;
  nome: string;
  login: string;
  role: string;
  ativo: boolean;
  synced_at_ms: number;
}

export async function saveDesktopAuthorizedUser(
  email: string,
  userId: string,
  password: string,
): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke<void>("desktop_authorized_user_save", {
    email,
    user_id: userId,
    password,
  });
}

export async function verifyDesktopAuthorizedUser(
  email: string,
  password: string,
): Promise<DesktopAuthorizedUser | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  try {
    return await invoke<DesktopAuthorizedUser | null>(
      "desktop_authorized_user_verify",
      { email, password },
    );
  } catch {
    return null;
  }
}

export async function getDesktopAuthorizedUserStatus(
  email: string,
): Promise<DesktopAuthorizedUserStatus> {
  const invoke = await getInvoke();
  if (!invoke) return { exists: false };
  try {
    return await invoke<DesktopAuthorizedUserStatus>(
      "desktop_authorized_user_status",
      { email },
    );
  } catch {
    return { exists: false };
  }
}

export async function cacheDesktopFuncionarios(
  funcionarios: DesktopFuncionarioLocalRow[],
): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke<void>("desktop_funcionarios_cache", { funcionarios });
}

export async function loadDesktopFuncionariosAtivos(): Promise<
  DesktopFuncionarioLocalRow[]
> {
  const invoke = await getInvoke();
  if (!invoke) return [];
  try {
    return await invoke<DesktopFuncionarioLocalRow[]>(
      "desktop_funcionarios_ativos",
    );
  } catch {
    return [];
  }
}

export async function saveDesktopFuncionarioPin(
  funcionarioId: string,
  nome: string,
  login: string,
  role: string,
  ativo: boolean,
  pin: string,
): Promise<void> {
  const invoke = await getInvoke();
  if (!invoke) return;
  await invoke<void>("desktop_funcionario_pin_save", {
    funcionarioId,
    nome,
    login,
    role,
    ativo,
    pin,
  });
}

export async function verifyDesktopFuncionarioPin(
  funcionarioId: string,
  pin: string,
): Promise<DesktopFuncionarioLocalRow | null> {
  const invoke = await getInvoke();
  if (!invoke) return null;
  return invoke<DesktopFuncionarioLocalRow | null>(
    "desktop_funcionario_pin_verify",
    {
      funcionarioId,
      pin,
    },
  );
}
