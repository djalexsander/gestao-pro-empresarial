#!/usr/bin/env node
/**
 * scripts/validate-latest-json.mjs
 *
 * Valida o `latest.json` produzido por `generate-latest-json.mjs` antes de
 * publicar na GitHub Release. Falha (exit 1) se algum campo obrigatório do
 * Tauri Updater v2 estiver ausente ou malformado.
 *
 * Uso:
 *   node scripts/validate-latest-json.mjs [caminho/para/latest.json]
 *   (default: src-tauri/target/release/bundle/nsis/latest.json)
 *
 * Verifica:
 *   - Arquivo existe e é JSON válido
 *   - `version` em formato semver (X.Y.Z[-pre])
 *   - `version` bate com package.json
 *   - `pub_date` em ISO-8601
 *   - `platforms["windows-x86_64"]` presente
 *   - `url` é http(s) e termina em .exe (instalador NSIS)
 *   - `url` aponta para o repo correto
 *   - `signature` não-vazia e parece uma assinatura válida do Tauri
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const DEFAULT_PATH = "src-tauri/target/release/bundle/nsis/latest.json";
const target = resolve(ROOT, process.argv[2] || DEFAULT_PATH);

const errors = [];
const warn = [];
const fail = (m) => errors.push(m);

if (!existsSync(target)) {
  console.error(`✖ latest.json não encontrado em ${target}`);
  process.exit(1);
}

let data;
try {
  data = JSON.parse(readFileSync(target, "utf8"));
} catch (e) {
  console.error(`✖ JSON inválido em ${target}: ${e.message}`);
  process.exit(1);
}

// --- version ---
const semver = /^\d+\.\d+\.\d+(?:-[\w.]+)?$/;
if (!data.version || typeof data.version !== "string") {
  fail("`version` ausente ou não-string.");
} else if (!semver.test(data.version)) {
  fail(`\`version\` não é semver válido: "${data.version}".`);
}

// version vs package.json
try {
  const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
  if (data.version && pkg.version && data.version !== pkg.version) {
    fail(
      `\`version\` (${data.version}) diverge de package.json (${pkg.version}).`,
    );
  }
} catch {
  warn.push("Não foi possível ler package.json para comparar version.");
}

// --- pub_date ---
if (!data.pub_date || typeof data.pub_date !== "string") {
  fail("`pub_date` ausente.");
} else {
  const d = new Date(data.pub_date);
  if (isNaN(d.getTime())) fail(`\`pub_date\` inválida: "${data.pub_date}".`);
}

// --- platforms ---
if (!data.platforms || typeof data.platforms !== "object") {
  fail("`platforms` ausente.");
} else {
  const win = data.platforms["windows-x86_64"];
  if (!win) {
    fail('`platforms["windows-x86_64"]` ausente.');
  } else {
    // url
    if (!win.url || typeof win.url !== "string") {
      fail("`platforms.windows-x86_64.url` ausente.");
    } else {
      try {
        const u = new URL(win.url);
        if (!/^https?:$/.test(u.protocol)) fail(`url não é http(s): ${win.url}`);
        if (!/\.(exe|msi)$/i.test(decodeURIComponent(u.pathname))) {
          fail(`url não termina em .exe/.msi: ${win.url}`);
        }
        if (!u.hostname.includes("github.com")) {
          warn.push(`url não aponta para github.com: ${u.hostname}`);
        }
        if (!u.pathname.includes("/djalexsander/gestao-pro-empresarial/")) {
          fail(`url não aponta para o repo correto: ${win.url}`);
        }
      } catch (e) {
        fail(`url malformada: ${win.url} (${e.message})`);
      }
    }

    // signature
    if (!win.signature || typeof win.signature !== "string") {
      fail("`platforms.windows-x86_64.signature` ausente.");
    } else {
      const sig = win.signature.trim();
      if (sig.length < 100) {
        fail(`signature suspeitosamente curta (${sig.length} chars).`);
      }
      const hasMinisignHeader = /untrusted comment:/i.test(sig);
      const looksLikeRawTauriSignature = /^[A-Za-z0-9+/=\r\n]+$/.test(sig);
      if (!hasMinisignHeader && !looksLikeRawTauriSignature) {
        fail(
          "signature não parece ser uma assinatura Tauri/minisign válida.",
        );
      }
    }
  }
}

// --- saída ---
if (warn.length) {
  console.warn("\n⚠ Avisos:");
  for (const w of warn) console.warn("  - " + w);
}

if (errors.length) {
  console.error("\n✖ latest.json INVÁLIDO:");
  for (const e of errors) console.error("  - " + e);
  console.error("");
  process.exit(1);
}

console.log("✓ latest.json válido");
console.log(`  version : ${data.version}`);
console.log(`  pub_date: ${data.pub_date}`);
console.log(`  url     : ${data.platforms["windows-x86_64"].url}`);
console.log(
  `  sig     : ${data.platforms["windows-x86_64"].signature.slice(0, 60)}…`,
);
