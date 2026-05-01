#!/usr/bin/env node
/**
 * ============================================================================
 * prepare-tauri-dist.mjs
 * ============================================================================
 *
 * Pós-processamento do build desktop. Roda DEPOIS de `vite build --config
 * vite.config.desktop.ts` e ANTES do Tauri empacotar.
 *
 * Por que existe:
 * ---------------
 * O TanStack Start em modo SPA com prerender da rota raiz ("/") emite o
 * shell HTML em `dist-desktop/client/.html` (arquivo literalmente chamado
 * ".html", sem o "index" no nome) porque o path da rota é "/" e o
 * prerenderer concatena `route + ".html"`. O Tauri (e qualquer WebView
 * carregando via file://) precisa de `index.html` na raiz.
 *
 * O que este script faz:
 * ----------------------
 *  1. Limpa `src-tauri/tauri-dist/`.
 *  2. Copia recursivamente `dist-desktop/client/` para `src-tauri/tauri-dist/`.
 *  3. Renomeia `.html` → `index.html` se necessário.
 *  4. Valida que `index.html` existe e contém o root mount esperado.
 *  5. Falha com erro claro se algo estiver fora do lugar.
 *
 * Resultado: `src-tauri/tauri-dist/index.html` + assets, pronto para o Tauri
 * consumir via `frontendDist: "../src-tauri/tauri-dist"` ... na verdade, como
 * o tauri.conf.json está dentro de `src-tauri/`, basta `"tauri-dist"`.
 */

import { existsSync, rmSync, cpSync, renameSync, readFileSync, statSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "dist-desktop/client");
const DEST = resolve(ROOT, "src-tauri/tauri-dist");

function log(msg) {
  console.log(`[prepare-tauri-dist] ${msg}`);
}

function fail(msg) {
  console.error(`\n❌ [prepare-tauri-dist] ${msg}\n`);
  process.exit(1);
}

// 1. Verifica que o build SPA rodou
if (!existsSync(SRC) || !statSync(SRC).isDirectory()) {
  fail(
    `Pasta de origem não existe: ${SRC}\n` +
    `Rode primeiro: npm run build:desktop`,
  );
}

// 2. Limpa destino
if (existsSync(DEST)) {
  log(`Limpando destino antigo: ${DEST}`);
  rmSync(DEST, { recursive: true, force: true });
}

// 3. Copia
log(`Copiando ${SRC} -> ${DEST}`);
cpSync(SRC, DEST, { recursive: true });

// 4. Resolve nome do HTML principal
const dotHtml = resolve(DEST, ".html");
const indexHtml = resolve(DEST, "index.html");

if (!existsSync(indexHtml)) {
  if (existsSync(dotHtml)) {
    log(`Renomeando ".html" -> "index.html"`);
    renameSync(dotHtml, indexHtml);
  } else {
    fail(
      `Não encontrei nem "index.html" nem ".html" em ${DEST}.\n` +
      `Verifique a configuração de prerender em vite.config.desktop.ts.`,
    );
  }
}

// 5. Valida conteúdo mínimo do index.html
let html = readFileSync(indexHtml, "utf8");
if (!html.includes("<html") || !html.includes("</html>")) {
  fail(
    `index.html parece inválido (faltam tags <html>...</html>).\n` +
    `Caminho: ${indexHtml}`,
  );
}

// 6. Reescreve paths absolutos ("/foo", "/./assets/...") para relativos ("./foo")
//    porque o WebView do Tauri carrega via file:// e "/" resolve para a raiz
//    do filesystem do SO, quebrando todos os assets.
//    Estratégia conservadora: só atributos href/src/content que começam
//    com "/" e NÃO são URL absoluta (http://, https://, //, data:, mailto:).
import { writeFileSync } from "node:fs";

const before = html;
html = html.replace(
  /\b(href|src)=("|')\/(?!\/)([^"']*)\2/g,
  (_m, attr, q, rest) => `${attr}=${q}./${rest.replace(/^\.\//, "")}${q}`,
);
// Também corrige "/./assets/..." que o prerender às vezes emite.
html = html.replace(/(href|src)=("|')\.\/\.\//g, "$1=$2./");

if (html !== before) {
  writeFileSync(indexHtml, html, "utf8");
  log(`Reescritos paths absolutos -> relativos em index.html`);
}

log(`✅ OK — Tauri pode consumir: ${DEST}`);
log(`   index.html: ${indexHtml} (${html.length} bytes)`);
