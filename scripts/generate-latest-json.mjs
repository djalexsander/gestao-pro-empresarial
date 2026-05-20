#!/usr/bin/env node
/**
 * scripts/generate-latest-json.mjs
 *
 * Gera o `latest.json` consumido pelo Tauri Updater v2 a partir dos artefatos
 * assinados em `src-tauri/target/release/bundle/nsis`.
 *
 * Falha rápida (exit 1) com mensagem clara se algum requisito faltar — nunca
 * fica em loop esperando arquivo aparecer.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const T0 = Date.now();
const ROOT = process.cwd();
const REPO_OWNER = process.env.GITHUB_REPOSITORY_OWNER || "djalexsander";
const REPO_NAME =
  process.env.GITHUB_REPOSITORY?.split("/")[1] || "gestao-pro-empresarial";

const log = (msg) => console.log(`[generate-latest-json] ${msg}`);
const step = (msg) => console.log(`\n[generate-latest-json] ── ${msg}`);

function fail(msg) {
  console.error(`\n[generate-latest-json] ✖ ${msg}`);
  console.error(`[generate-latest-json] abortando após ${Date.now() - T0}ms\n`);
  process.exit(1);
}

step("início");
log(`cwd            : ${ROOT}`);
log(`repo (owner/name): ${REPO_OWNER}/${REPO_NAME}`);
log(`RELEASE_TAG    : ${process.env.RELEASE_TAG || "(vazio)"}`);
log(`GITHUB_REF_NAME: ${process.env.GITHUB_REF_NAME || "(vazio)"}`);

// 1. Versão -------------------------------------------------------------------
step("lendo package.json");
const pkgPath = resolve(ROOT, "package.json");
if (!existsSync(pkgPath)) fail("package.json não encontrado.");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = pkg.version;
if (!version) fail("Campo `version` ausente em package.json.");
log(`versão package.json: ${version}`);

const releaseTag =
  process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || `v${version}`;
log(`tag de release resolvida: ${releaseTag}`);

const repoDownloadUrl = `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/download/${encodeURIComponent(
  releaseTag,
)}`;
const UNSAFE_ASSET_RE = /[^A-Za-z0-9._-]/;

// 2. Pasta NSIS ---------------------------------------------------------------
step("inspecionando pasta de artefatos");
const nsisDir = resolve(ROOT, "src-tauri/target/release/bundle/nsis");
log(`diretório alvo : ${nsisDir}`);
if (!existsSync(nsisDir)) {
  fail(
    `Pasta NSIS não encontrada: ${nsisDir}\n` +
      `Rode \`npm run tauri:build\` antes de gerar o latest.json.`,
  );
}

const allEntries = readdirSync(nsisDir);
log(`encontrados ${allEntries.length} item(ns):`);
for (const name of allEntries) {
  try {
    const s = statSync(join(nsisDir, name));
    log(`  - ${name} (${s.isDirectory() ? "dir" : `${s.size}B`})`);
  } catch {
    log(`  - ${name} (stat falhou)`);
  }
}

// 3. Localizar .exe e .exe.sig ------------------------------------------------
step("selecionando instalador .exe");
const exeCandidates = allEntries.filter(
  (f) => f.toLowerCase().endsWith(".exe") && !f.toLowerCase().endsWith(".sig"),
);
log(`candidatos .exe: ${exeCandidates.length ? exeCandidates.join(", ") : "(nenhum)"}`);
if (exeCandidates.length === 0) {
  fail(`Nenhum instalador .exe encontrado em ${nsisDir}.`);
}
if (exeCandidates.length > 1) {
  log(`aviso: mais de um .exe encontrado, usando o primeiro: ${exeCandidates[0]}`);
}
const exeFile = exeCandidates[0];
log(`instalador selecionado: ${exeFile}`);

step("validando nomes seguros (sem espaços/acentos)");
const unsafeFiles = allEntries.filter(
  (f) => /\.(exe|msi)(\.sig)?$/i.test(f) && UNSAFE_ASSET_RE.test(f),
);
if (unsafeFiles.length) {
  fail(
    `Artefatos com nomes inseguros encontrados: ${unsafeFiles.join(", ")}. ` +
      `Rode \`npm run normalize:tauri-assets\` antes de gerar o latest.json.`,
  );
}
if (UNSAFE_ASSET_RE.test(exeFile)) {
  fail(
    `Instalador com nome inseguro: "${exeFile}". ` +
      `Rode \`npm run normalize:tauri-assets\` antes de gerar o latest.json.`,
  );
}
log("nomes ok");

step("localizando assinatura .exe.sig");
const expectedSigName = `${exeFile}.sig`;
const sigFile = allEntries.find((f) => f === expectedSigName);
if (!sigFile) {
  const alt = allEntries.filter((f) => f.toLowerCase().endsWith(".exe.sig"));
  fail(
    `Arquivo de assinatura esperado não encontrado: "${expectedSigName}".\n` +
      `  Outros .exe.sig presentes: ${alt.length ? alt.join(", ") : "(nenhum)"}.\n` +
      `  Verifique se o tauri build assinado terminou com sucesso e gerou o .sig ao lado do .exe.`,
  );
}
log(`assinatura encontrada: ${sigFile}`);

const sigPath = join(nsisDir, sigFile);
const signature = readFileSync(sigPath, "utf8").trim();
if (!signature) fail(`Assinatura vazia em ${sigPath}.`);
log(`assinatura lida (${signature.length} chars)`);

// 4. Montar URL pública tagada ------------------------------------------------
const url = `${repoDownloadUrl}/${encodeURIComponent(exeFile)}`;
log(`url pública    : ${url}`);

// 5. Montar latest.json -------------------------------------------------------
step("gravando latest.json");
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
log(`gravado em     : ${outPath}`);

// 6. Log final ----------------------------------------------------------------
step(`concluído em ${Date.now() - T0}ms`);
console.log("\n✓ latest.json gerado com sucesso\n");
console.log(`  versão        : ${version}`);
console.log(`  tag release   : ${releaseTag}`);
console.log(`  instalador    : ${exeFile}`);
console.log(`  assinatura    : ${sigFile}`);
console.log(`  latest.json   : ${outPath}`);
console.log(`  url publicada : ${url}\n`);
