#!/usr/bin/env node
/**
 * ============================================================================
 * prepare-web-dist.mjs
 * ============================================================================
 *
 * Pós-processamento do build web estático (Vercel). Roda DEPOIS de
 * `vite build --config vite.config.web.ts`.
 *
 * O TanStack Start em modo SPA com prerender de "/" emite o shell em
 * `dist-web/client/.html` (arquivo literalmente chamado ".html"). A Vercel
 * precisa de `index.html` na raiz do diretório de saída.
 *
 * O que faz (no próprio `dist-web/client`, sem tocar em outras saídas):
 *  1. Confirma que o build rodou.
 *  2. Renomeia `.html` -> `index.html` (se necessário).
 *  3. Valida o conteúdo mínimo do index.html.
 *  4. Garante que não há referência a caminhos relativos do desktop ("./").
 */

import { existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = resolve(ROOT, "dist-web/client");

function log(msg) {
  console.log(`[prepare-web-dist] ${msg}`);
}

function fail(msg) {
  console.error(`\n[prepare-web-dist] ERRO: ${msg}\n`);
  process.exit(1);
}

if (!existsSync(OUT) || !statSync(OUT).isDirectory()) {
  fail(`Pasta de saída não existe: ${OUT}\nRode primeiro: npm run build:web`);
}

const dotHtml = resolve(OUT, ".html");
const indexHtml = resolve(OUT, "index.html");

if (!existsSync(indexHtml)) {
  if (!existsSync(dotHtml)) {
    fail(
      `Não encontrei "index.html" nem ".html" em ${OUT}.\n` +
        `Verifique o prerender em vite.config.web.ts.`,
    );
  }
  log('Renomeando ".html" -> "index.html"');
  renameSync(dotHtml, indexHtml);
}

const html = readFileSync(indexHtml, "utf8");
if (!html.includes("<html") || !html.includes("</html>")) {
  fail(`index.html parece inválido (faltam <html>...</html>): ${indexHtml}`);
}
if (!/import\("\/assets\/[^"]+"\)|<script\b[^>]*type="module"[^>]*src="\/assets\//.test(html)) {
  fail(
    'index.html não referencia a entrada com caminho absoluto ("/assets/..."), via import() ou <script src>.\n' +
      "O build web usa base '/'; confira vite.config.web.ts.",
  );
}

log(`OK — pronto para a Vercel: ${OUT}`);
log(`   index.html: ${html.length} bytes`);
