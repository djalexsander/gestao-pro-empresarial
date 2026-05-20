#!/usr/bin/env node
/**
 * build-desktop.mjs
 *
 * Orquestra o build desktop e GARANTE que o processo encerre.
 *
 * Etapas:
 *  1. Roda `vite build --config vite.config.desktop.ts` como child process.
 *  2. Faz streaming do stdout/stderr.
 *  3. Quando detecta o fim do prerender ("[prerender] - /" / "Prerendered N pages"),
 *     espera um grace period curto e força encerramento do child se ele não sair sozinho
 *     (algumas versões do plugin tanstack/start deixam handles pendurados em ambientes CI).
 *  4. Após o vite encerrar, roda `node scripts/prepare-tauri-dist.mjs` (que já tem
 *     watchdog próprio e chama process.exit).
 *  5. Loga claramente e chama process.exit(0).
 *
 * NUNCA fica preso: existe um watchdog global de 12 minutos.
 */

import { spawn } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");

const T0 = Date.now();
const GLOBAL_TIMEOUT_MS = 12 * 60 * 1000; // 12 min
const POST_PRERENDER_GRACE_MS = 8_000; // 8s após detectar fim do prerender
const PREPARE_TIMEOUT_MS = 90_000; // 90s para prepare-tauri-dist

function ts() {
  return `${((Date.now() - T0) / 1000).toFixed(2)}s`;
}
function log(msg) {
  console.log(`[desktop-build ${ts()}] ${msg}`);
}
function err(msg) {
  console.error(`[desktop-build ${ts()}] ${msg}`);
}

const globalWatchdog = setTimeout(() => {
  err(`WATCHDOG GLOBAL: build excedeu ${GLOBAL_TIMEOUT_MS}ms. Abortando.`);
  process.exit(2);
}, GLOBAL_TIMEOUT_MS);
globalWatchdog.unref?.();

function runStep(cmd, args, { onStdout, timeoutMs } = {}) {
  return new Promise((resolvePromise) => {
    log(`spawn: ${cmd} ${args.join(" ")}`);
    const child = spawn(cmd, args, {
      cwd: ROOT,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, CI: process.env.CI ?? "true" },
    });

    let exited = false;
    let forceKillTimer = null;
    let forcedKill = false;

    const finish = (code, reason) => {
      if (exited) return;
      exited = true;
      if (forceKillTimer) clearTimeout(forceKillTimer);
      log(`step "${cmd} ${args.join(" ")}" finalizou (${reason}) code=${code} forcedKill=${forcedKill}`);
      resolvePromise({ code: code ?? 0, forcedKill, reason });
    };

    const forceKill = (reason) => {
      if (exited) return;
      forcedKill = true;
      err(`forçando encerramento do child (${reason})`);
      try {
        if (process.platform === "win32") {
          spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
            shell: true,
            stdio: "ignore",
          });
        } else {
          child.kill("SIGKILL");
        }
      } catch (e) {
        err(`erro ao matar child: ${e?.message || e}`);
      }
      setTimeout(() => finish(0, reason), 1500);
    };

    child.stdout.on("data", (buf) => {
      const text = buf.toString();
      process.stdout.write(text);
      onStdout?.(text, () => {
        if (forceKillTimer) return;
        log(
          `marcador de conclusão detectado. Aguardando ${POST_PRERENDER_GRACE_MS}ms para encerramento natural...`,
        );
        forceKillTimer = setTimeout(() => {
          forceKill("grace expirado após prerender");
        }, POST_PRERENDER_GRACE_MS);
      });
    });
    child.stderr.on("data", (buf) => process.stderr.write(buf));

    child.on("error", (e) => {
      err(`erro no spawn: ${e?.message || e}`);
      finish(1, "spawn error");
    });
    child.on("exit", (code, signal) => {
      finish(code ?? 0, `exit signal=${signal}`);
    });

    if (timeoutMs) {
      const t = setTimeout(() => forceKill("timeout do step"), timeoutMs);
      t.unref?.();
    }
  });
}

(async () => {
  try {
    log("iniciando build desktop");

    // --- Step 1: vite build ---
    let prerenderDone = false;
    const viteResult = await runStep(
      "npx",
      ["vite", "build", "--config", "vite.config.desktop.ts"],
      {
        timeoutMs: 10 * 60 * 1000,
        onStdout: (text, markDone) => {
          if (prerenderDone) return;
          if (
            /Prerendered\s+\d+\s+pages/i.test(text) ||
            /\[prerender\][^\n]*-\s*\//.test(text)
          ) {
            prerenderDone = true;
            log("[desktop-build] prerender finished");
            markDone();
          }
        },
      },
    );

    // Sucesso real: exit 0 espontâneo
    // Sucesso tolerado: prerender concluiu E processo foi morto manualmente
    const viteOk =
      viteResult.code === 0 ||
      (prerenderDone && viteResult.forcedKill);

    if (!viteOk) {
      err(`vite build falhou (code=${viteResult.code}, prerenderDone=${prerenderDone}, forcedKill=${viteResult.forcedKill})`);
      clearTimeout(globalWatchdog);
      process.exit(viteResult.code || 1);
    }

    if (prerenderDone && viteResult.forcedKill) {
      log("[desktop-build] prerender already completed");
      log("[desktop-build] ignoring forced child termination");
    }
    log("[desktop-build] continuing build pipeline");
    log("vite build OK");

    // --- Step 2: prepare-tauri-dist ---
    const prepResult = await runStep(
      process.execPath,
      ["scripts/prepare-tauri-dist.mjs"],
      { timeoutMs: PREPARE_TIMEOUT_MS },
    );
    if (prepResult.code !== 0) {
      err(`prepare-tauri-dist falhou (code=${prepResult.code})`);
      clearTimeout(globalWatchdog);
      process.exit(prepResult.code || 1);
    }

    log("[desktop-build] all steps OK");
    log("[desktop-build] exiting with code 0");
    clearTimeout(globalWatchdog);
    process.exit(0);
  } catch (e) {
    err(`exceção: ${e?.stack || e}`);
    clearTimeout(globalWatchdog);
    process.exit(1);
  }
})();

