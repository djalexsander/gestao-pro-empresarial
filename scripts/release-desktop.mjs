#!/usr/bin/env node
/**
 * scripts/release-desktop.mjs
 *
 * Sobe a versão do app desktop em todos os arquivos relevantes,
 * mantendo `package.json`, `src-tauri/Cargo.toml` e
 * `src-tauri/tauri.conf.json` em sincronia.
 *
 * Uso:
 *   node scripts/release-desktop.mjs <nova-versao>
 *   node scripts/release-desktop.mjs 1.1.0
 *
 * Esta etapa cuida APENAS do bump de versão. O build/empacotamento
 * é feito via `npm run tauri:build` (ou pipeline equivalente). A
 * geração de `latest.json` (manifesto do updater) é descrita em
 * `.lovable/desktop-release.md`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = process.cwd();
const args = process.argv.slice(2);
const next = args[0];

if (!next || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(next)) {
  console.error(
    "Uso: node scripts/release-desktop.mjs <semver>  (ex: 1.1.0 | 1.2.0-beta.1)",
  );
  process.exit(1);
}

function bumpJson(path, transform) {
  const full = resolve(ROOT, path);
  const raw = readFileSync(full, "utf8");
  const obj = JSON.parse(raw);
  const before = obj.version;
  transform(obj);
  writeFileSync(full, JSON.stringify(obj, null, 2) + "\n");
  console.log(`✓ ${path}: ${before} → ${obj.version}`);
}

function bumpCargoToml(path) {
  const full = resolve(ROOT, path);
  let raw = readFileSync(full, "utf8");
  const re = /^version\s*=\s*"[^"]+"/m;
  const before = raw.match(re)?.[0];
  raw = raw.replace(re, `version = "${next}"`);
  writeFileSync(full, raw);
  console.log(`✓ ${path}: ${before} → version = "${next}"`);
}

bumpJson("package.json", (o) => (o.version = next));
bumpJson("src-tauri/tauri.conf.json", (o) => (o.version = next));
bumpCargoToml("src-tauri/Cargo.toml");

console.log("\nPróximos passos:");
console.log("  1. git commit -am \"chore(desktop): release v" + next + "\"");
console.log("  2. git tag v" + next);
console.log("  3. npm run tauri:build");
console.log("  4. publicar artefatos + latest.json (ver .lovable/desktop-release.md)");
