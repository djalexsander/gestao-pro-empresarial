import { logDiagnostic } from "@/lib/desktopErrorLogger";

export type UpdaterPhase =
  | "checking"
  | "downloading"
  | "validating-installing"
  | "relaunching";

export type UpdaterProgress = {
  phase: UpdaterPhase;
  downloadedBytes: number;
  totalBytes: number | null;
};

type DownloadEvent =
  | { event: "Started"; data: { contentLength?: number } }
  | { event: "Progress"; data: { chunkLength: number } }
  | { event: "Finished"; data?: Record<string, never> };

export type DesktopUpdate = {
  version: string;
  date?: string;
  body?: string;
  rawJson?: Record<string, unknown>;
  downloadAndInstall: (onEvent?: (event: DownloadEvent) => void) => Promise<void>;
};

export type UpdaterDependencies = {
  check: () => Promise<DesktopUpdate | null>;
  getVersion: () => Promise<string>;
  relaunch: () => Promise<void>;
  log: typeof logDiagnostic;
};

export type DesktopUpdateCheck = {
  currentVersion: string;
  update: DesktopUpdate | null;
  artifactUrl: string | null;
};

let installInFlight: Promise<void> | null = null;

function redactText(value: string): string {
  return value
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[redacted]")
    .replace(/([?&](?:token|access_token|api[_-]?key|key|signature|sig|jwt|secret|password|credential)=)[^&#\s]+/gi, "$1[redacted]")
    .replace(/((?:token|api[_-]?key|secret|password)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]");
}

export function formatUpdaterError(error: unknown): string {
  return redactText(error instanceof Error ? error.message : String(error));
}

function safeArtifactUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/token|key|signature|sig|jwt|secret|password|credential/i.test(key)) {
        url.searchParams.set(key, "[redacted]");
      }
    }
    return url.toString();
  } catch {
    return redactText(value);
  }
}

function safeError(error: unknown): Error {
  if (!(error instanceof Error)) return new Error(redactText(String(error)));
  const sanitized = new Error(redactText(error.message));
  sanitized.name = error.name || "Error";
  sanitized.stack = error.stack ? redactText(error.stack) : undefined;
  return sanitized;
}

function artifactUrl(update: DesktopUpdate | null): string | null {
  if (!update?.rawJson) return null;
  const platforms = update.rawJson.platforms;
  if (!platforms || typeof platforms !== "object") return null;
  for (const value of Object.values(platforms)) {
    if (value && typeof value === "object" && "url" in value && typeof value.url === "string") {
      return safeArtifactUrl(value.url);
    }
  }
  return null;
}

function errorDetails(error: unknown, depth = 0): Record<string, unknown> {
  if (depth > 4) return { value: "[max-depth]" };
  if (error instanceof Error) {
    const withCause = error as Error & { cause?: unknown };
    return {
      name: error.name,
      message: redactText(error.message),
      stack: error.stack ? redactText(error.stack) : null,
      cause: withCause.cause == null ? null : errorDetails(withCause.cause, depth + 1),
    };
  }
  if (error && typeof error === "object") {
    return { value: redactText(String(error)), note: "non-Error object omitted to avoid sensitive data" };
  }
  return { value: redactText(String(error)) };
}

async function defaultDependencies(): Promise<UpdaterDependencies> {
  const [{ check }, { getVersion }, { relaunch }] = await Promise.all([
    import("@tauri-apps/plugin-updater"),
    import("@tauri-apps/api/app"),
    import("@tauri-apps/plugin-process"),
  ]);
  return { check: check as () => Promise<DesktopUpdate | null>, getVersion, relaunch, log: logDiagnostic };
}

async function writeLog(
  deps: UpdaterDependencies,
  type: string,
  additional?: Record<string, unknown>,
  error?: unknown,
) {
  await deps.log({ type, error, additional });
}

export async function checkDesktopUpdate(
  injected?: UpdaterDependencies,
): Promise<DesktopUpdateCheck> {
  const deps = injected ?? (await defaultDependencies());
  await writeLog(deps, "updater-check-start");
  try {
    const [currentVersion, update] = await Promise.all([deps.getVersion(), deps.check()]);
    const url = artifactUrl(update);
    await writeLog(deps, "updater-check-result", {
      currentVersion,
      availableVersion: update?.version ?? null,
      artifactUrl: url,
      updateAvailable: Boolean(update),
    });
    return { currentVersion, update, artifactUrl: url };
  } catch (error) {
    await writeLog(deps, "updater-check-error", { errorDetails: errorDetails(error) }, safeError(error));
    throw error;
  }
}

async function runDownloadInstallAndRelaunch(
  options: {
    update?: DesktopUpdate;
    onProgress?: (progress: UpdaterProgress) => void;
  } = {},
  injected?: UpdaterDependencies,
): Promise<void> {
  const deps = injected ?? (await defaultDependencies());
  try {
    const checked = options.update
      ? { currentVersion: await deps.getVersion(), update: options.update, artifactUrl: artifactUrl(options.update) }
      : await checkDesktopUpdate(deps);
    if (!checked.update) throw new Error("Nenhuma atualização disponível.");

    await writeLog(deps, "updater-install-request", {
      currentVersion: checked.currentVersion,
      availableVersion: checked.update.version,
      artifactUrl: checked.artifactUrl,
    });

    let downloadedBytes = 0;
    let totalBytes: number | null = null;
    await checked.update.downloadAndInstall((event) => {
      if (event.event === "Started") {
        totalBytes = event.data.contentLength ?? null;
        options.onProgress?.({ phase: "downloading", downloadedBytes, totalBytes });
        void writeLog(deps, "updater-download-start", { downloadedBytes, totalBytes });
      } else if (event.event === "Progress") {
        downloadedBytes += event.data.chunkLength;
        options.onProgress?.({ phase: "downloading", downloadedBytes, totalBytes });
        void writeLog(deps, "updater-download-progress", {
          chunkBytes: event.data.chunkLength,
          downloadedBytes,
          totalBytes,
        });
      } else if (event.event === "Finished") {
        options.onProgress?.({ phase: "validating-installing", downloadedBytes, totalBytes });
        void writeLog(deps, "updater-download-finished", { downloadedBytes, totalBytes });
        void writeLog(deps, "updater-install-start", {
          phase: "signature-validation-and-native-installation",
          availableVersion: checked.update?.version,
          artifactUrl: checked.artifactUrl,
        });
      }
    });

    // No Windows/NSIS o processo normalmente encerra dentro de downloadAndInstall.
    // Só chegamos aqui quando a API realmente devolveu o controle ao JavaScript.
    await writeLog(deps, "updater-install-returned-to-javascript", {
      availableVersion: checked.update.version,
    });
    options.onProgress?.({ phase: "relaunching", downloadedBytes, totalBytes });
    await deps.relaunch();
  } catch (error) {
    await writeLog(deps, "updater-install-error", { errorDetails: errorDetails(error) }, safeError(error));
    throw error;
  }
}

export function downloadInstallAndRelaunch(
  options: {
    update?: DesktopUpdate;
    onProgress?: (progress: UpdaterProgress) => void;
  } = {},
  injected?: UpdaterDependencies,
): Promise<void> {
  if (installInFlight) return installInFlight;
  const execution = runDownloadInstallAndRelaunch(options, injected);
  installInFlight = execution;
  void execution.finally(() => {
    if (installInFlight === execution) installInFlight = null;
  }).catch(() => undefined);
  return execution;
}
