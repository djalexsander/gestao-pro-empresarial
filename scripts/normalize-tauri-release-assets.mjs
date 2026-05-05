#!/usr/bin/env node
/**
 * Renomeia os artefatos Windows do Tauri para nomes seguros em GitHub Releases.
 *
 * O productName do app pode conter acento/espaço para aparecer corretamente na UI,
 * mas assets com esses caracteres podem causar 404 no Tauri Updater ao baixar.
 */
import { existsSync, readdirSync, renameSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = process.cwd();
const SAFE_APP_NAME = "gestao-pro";
const UNSAFE_ASSET_RE = /[^A-Za-z0-9._-]/;

function fail(msg) {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

function readVersion() {
  const pkgPath = resolve(ROOT, "package.json");
  if (!existsSync(pkgPath)) fail("package.json não encontrado.");
  const version = JSON.parse(readFileSync(pkgPath, "utf8")).version;
  if (!version) fail("Campo `version` ausente em package.json.");
  return version;
}

function renameReplacing(from, to) {
  if (from === to) return false;
  if (existsSync(to)) rmSync(to, { force: true });
  renameSync(from, to);
  return true;
}

function normalizeOne({ dir, ext, desiredName }) {
  if (!existsSync(dir)) return null;

  const files = readdirSync(dir);
  const candidates = files.filter(
    (file) => file.toLowerCase().endsWith(ext) && !file.toLowerCase().endsWith(`${ext}.sig`),
  );
  if (candidates.length === 0) return null;
  if (candidates.length > 1 && !candidates.includes(desiredName)) {
    fail(`Mais de um instalador ${ext} encontrado em ${dir}: ${candidates.join(", ")}`);
  }

  const currentName = candidates.includes(desiredName) ? desiredName : candidates[0];
  const currentPath = join(dir, currentName);
  const desiredPath = join(dir, desiredName);
  const currentSigPath = join(dir, `${currentName}.sig`);
  const desiredSigPath = join(dir, `${desiredName}.sig`);

  if (!existsSync(currentSigPath)) {
    fail(`Assinatura não encontrada para ${currentName}: esperado ${currentName}.sig`);
  }

  const renamedInstaller = renameReplacing(currentPath, desiredPath);
  const renamedSignature = renameReplacing(currentSigPath, desiredSigPath);
  const safe = !UNSAFE_ASSET_RE.test(desiredName) && !UNSAFE_ASSET_RE.test(`${desiredName}.sig`);
  if (!safe) fail(`Nome normalizado ainda contém caracteres inseguros: ${desiredName}`);

  return {
    from: currentName,
    to: desiredName,
    changed: renamedInstaller || renamedSignature,
  };
}

const version = readVersion();
const bundleRoot = resolve(ROOT, "src-tauri/target/release/bundle");
const normalized = [
  normalizeOne({
    dir: join(bundleRoot, "nsis"),
    ext: ".exe",
    desiredName: `${SAFE_APP_NAME}_${version}_x64-setup.exe`,
  }),
  normalizeOne({
    dir: join(bundleRoot, "msi"),
    ext: ".msi",
    desiredName: `${SAFE_APP_NAME}_${version}_x64_en-US.msi`,
  }),
].filter(Boolean);

if (normalized.length === 0) {
  fail(`Nenhum artefato .exe/.msi encontrado em ${bundleRoot}. Rode o build Tauri primeiro.`);
}

console.log("✓ Artefatos Tauri normalizados para nomes seguros\n");
for (const item of normalized) {
  console.log(`  ${item.from} → ${item.to}${item.changed ? "" : " (já estava correto)"}`);
  console.log(`  ${item.from}.sig → ${item.to}.sig${item.changed ? "" : " (já estava correto)"}`);
}
console.log("");