#!/usr/bin/env node
/**
 * prepare-tauri-dist.mjs
 *
 * Pós-processamento do build desktop. Determinístico, síncrono, sem watchers,
 * sem polling, sem loops infinitos. Falha com erro claro se algo der errado e
 * sempre chama process.exit no final.
 *
 * Etapas:
 *  1. Valida que dist-desktop/client existe.
 *  2. Limpa src-tauri/tauri-dist (garantindo que NÃO é o mesmo diretório que src).
 *  3. Copia client -> tauri-dist.
 *  4. Renomeia ".html" -> "index.html" se necessário.
 *  5. Valida index.html.
 *  6. Reescreve paths absolutos -> relativos.
 *  7. Sai com process.exit(0).
 *
 * Timeout global de segurança: 60s.
 */

import {
  existsSync,
  rmSync,
  cpSync,
  renameSync,
  readFileSync,
  writeFileSync,
  statSync,
} from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "dist-desktop/client");
const DEST = resolve(ROOT, "src-tauri/tauri-dist");

const T0 = Date.now();
const SAFETY_TIMEOUT_MS = 60_000;

function ts() {
  return `${((Date.now() - T0) / 1000).toFixed(2)}s`;
}
function log(msg) {
  console.log(`[prepare-tauri-dist ${ts()}] ${msg}`);
}
function fail(msg) {
  console.error(`\n[prepare-tauri-dist ${ts()}] ERRO: ${msg}\n`);
  process.exit(1);
}

// Watchdog: se passar de 60s, algo está errado — aborta.
const watchdog = setTimeout(() => {
  console.error(
    `\n[prepare-tauri-dist ${ts()}] WATCHDOG: script excedeu ${SAFETY_TIMEOUT_MS}ms. Abortando.\n`,
  );
  process.exit(2);
}, SAFETY_TIMEOUT_MS);
watchdog.unref?.();

try {
  log(`[step 1/7] iniciando — ROOT=${ROOT}`);
  log(`  SRC=${SRC}`);
  log(`  DEST=${DEST}`);

  // Sanity: SRC e DEST não podem coincidir nem um ser pai do outro.
  const relSrcToDest = relative(SRC, DEST);
  const relDestToSrc = relative(DEST, SRC);
  if (
    SRC === DEST ||
    relSrcToDest === "" ||
    (!relSrcToDest.startsWith("..") && relSrcToDest !== "") ||
    (!relDestToSrc.startsWith("..") && relDestToSrc !== "")
  ) {
    fail(`SRC e DEST se sobrepõem. SRC=${SRC} DEST=${DEST}`);
  }

  log(`[step 2/7] validando SRC existe`);
  if (!existsSync(SRC) || !statSync(SRC).isDirectory()) {
    fail(
      `Pasta de origem não existe: ${SRC}. Rode primeiro: npm run build:desktop (vite build).`,
    );
  }

  log(`[step 3/7] limpando DEST`);
  if (existsSync(DEST)) {
    rmSync(DEST, { recursive: true, force: true });
    log(`  DEST removido`);
  } else {
    log(`  DEST não existia, nada a remover`);
  }

  log(`[step 4/7] copiando SRC -> DEST (cpSync recursive)`);
  cpSync(SRC, DEST, { recursive: true, force: true, errorOnExist: false });
  log(`  cópia concluída`);

  log(`[step 5/7] resolvendo index.html`);
  const dotHtml = resolve(DEST, ".html");
  const indexHtml = resolve(DEST, "index.html");
  if (!existsSync(indexHtml)) {
    if (existsSync(dotHtml)) {
      renameSync(dotHtml, indexHtml);
      log(`  renomeado ".html" -> "index.html"`);
    } else {
      fail(
        `Nem "index.html" nem ".html" encontrados em ${DEST}. Verifique prerender em vite.config.desktop.ts.`,
      );
    }
  } else {
    log(`  index.html já existe`);
  }

  log(`[step 6/7] validando + reescrevendo paths absolutos -> relativos`);
  let html = readFileSync(indexHtml, "utf8");
  if (!html.includes("<html") || !html.includes("</html>")) {
    fail(`index.html inválido (faltam <html>...</html>). Caminho: ${indexHtml}`);
  }
  const before = html;
  html = html.replace(
    /\b(href|src)=("|')\/(?!\/)([^"']*)\2/g,
    (_m, attr, q, rest) => `${attr}=${q}./${rest.replace(/^\.\//, "")}${q}`,
  );
  html = html.replace(/(href|src)=("|')\.\/\.\//g, "$1=$2./");
  if (html !== before) {
    writeFileSync(indexHtml, html, "utf8");
    log(`  paths reescritos`);
  } else {
    log(`  nenhum path absoluto encontrado`);
  }

  log(`[step 7/7] OK — index.html: ${indexHtml} (${html.length} bytes)`);
  clearTimeout(watchdog);
  log(`finalizado em ${ts()}`);
  process.exit(0);
} catch (err) {
  clearTimeout(watchdog);
  console.error(`\n[prepare-tauri-dist ${ts()}] EXCEÇÃO: ${err?.stack || err}\n`);
  process.exit(1);
}
