#!/usr/bin/env node
/**
 * scripts/generate-latest-json.mjs
 *
 * Gera automaticamente o `latest.json` consumido pelo Tauri Updater v2
 * a partir dos artefatos assinados produzidos por `tauri build`.
 *
 * Uso:
 *   node scripts/generate-latest-json.mjs
 *
 * Lê:
 *   - package.json -> version
 *   - src-tauri/target/release/bundle/nsis/*.exe   (instalador NSIS)
 *   - src-tauri/target/release/bundle/nsis/*.exe.sig (assinatura minisign)
 *
 * Escreve:
 *   - src-tauri/target/release/bundle/nsis/latest.json
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";

const ROOT = process.cwd();
const REPO_OWNER = process.env.GITHUB_REPOSITORY_OWNER || "djalexsander";
const REPO_NAME =
  process.env.GITHUB_REPOSITORY?.split("/")[1] || "gestao-pro-empresarial";

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

// 1. Versão
const pkgPath = resolve(ROOT, "package.json");
if (!existsSync(pkgPath)) fail("package.json não encontrado.");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = pkg.version;
if (!version) fail("Campo `version` ausente em package.json.");
const releaseTag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || `v${version}`;
const repoDownloadUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${encodeURIComponent(
  releaseTag,
)}`;

// 2. Pasta NSIS
const nsisDir = resolve(ROOT, "src-tauri/target/release/bundle/nsis");
if (!existsSync(nsisDir))
  fail(
    `Pasta NSIS não encontrada: ${nsisDir}\n` +
      `Rode \`npm run tauri:build\` antes de gerar o latest.json.`,
  );

// 3. Localizar .exe e .exe.sig
const files = readdirSync(nsisDir);
const exeFile = files.find(
  (f) => f.toLowerCase().endsWith(".exe") && !f.endsWith(".sig"),
);
if (!exeFile) fail(`Nenhum instalador .exe encontrado em ${nsisDir}.`);

const sigFile =
  files.find((f) => f === `${exeFile}.sig`) ||
  files.find((f) => f.toLowerCase().endsWith(".exe.sig"));
if (!sigFile)
  fail(`Arquivo de assinatura .exe.sig não encontrado para ${exeFile}.`);

const sigPath = join(nsisDir, sigFile);
const signature = readFileSync(sigPath, "utf8").trim();
if (!signature) fail(`Assinatura vazia em ${sigPath}.`);

// 4. Montar URL pública tagada (mais estável que /releases/latest/download)
const url = `${repoDownloadUrl}/${encodeURIComponent(exeFile)}`;

// 5. Montar latest.json
const latest = {
  version,
  notes: "Atualização automática do Gestão Pro.",
  pub_date: new Date().toISOString(),
  platforms: {
    "windows-x86_64": {
      signature,
      url,
    },
  },
};

const outPath = join(nsisDir, "latest.json");
writeFileSync(outPath, JSON.stringify(latest, null, 2) + "\n");

// 6. Log
console.log("✓ latest.json gerado com sucesso\n");
console.log(`  versão        : ${version}`);
console.log(`  tag release   : ${releaseTag}`);
console.log(`  instalador    : ${exeFile}`);
console.log(`  assinatura    : ${sigFile}`);
console.log(`  latest.json   : ${outPath}`);
console.log(`  url publicada : ${url}\n`);
