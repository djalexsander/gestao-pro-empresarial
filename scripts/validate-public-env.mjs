#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "vite";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REQUIRED = ["VITE_SUPABASE_URL", "VITE_SUPABASE_PUBLISHABLE_KEY"];
const EXPECTED_PROJECT_REF = "atabszfwpnpurnbgfnqi";
const bundleArg = process.argv.indexOf("--bundle");

function fail(message) {
  console.error(`[validate-public-env] ERRO: ${message}`);
  process.exit(1);
}

if (bundleArg >= 0) {
  const relativeBundlePath = process.argv[bundleArg + 1];
  if (!relativeBundlePath) fail("informe o diretório após --bundle");
  const bundlePath = resolve(ROOT, relativeBundlePath);
  if (!existsSync(bundlePath) || !statSync(bundlePath).isDirectory()) fail(`bundle não encontrado: ${bundlePath}`);

  const extensions = new Set([".html", ".js", ".mjs", ".css", ".json"]);
  const pending = [bundlePath];
  let found = false;
  while (pending.length > 0 && !found) {
    const current = pending.pop();
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (extensions.has(extname(entry.name).toLowerCase()) && readFileSync(path, "utf8").includes(EXPECTED_PROJECT_REF)) {
        found = true;
        break;
      }
    }
  }
  if (!found) fail(`project ref público do Supabase não foi incorporado ao bundle ${relativeBundlePath}`);
  console.log(`[validate-public-env] OK: project ref público encontrado em ${relativeBundlePath}.`);
  process.exit(0);
}

const env = { ...loadEnv("production", ROOT, ""), ...process.env };
const missing = REQUIRED.filter((name) => !env[name]?.trim());
if (missing.length > 0) fail(`variáveis públicas ausentes: ${missing.join(", ")}`);

let projectRef;
try {
  projectRef = new URL(env.VITE_SUPABASE_URL).hostname.split(".")[0];
} catch {
  fail("VITE_SUPABASE_URL não é uma URL válida");
}
if (projectRef !== EXPECTED_PROJECT_REF) fail(`VITE_SUPABASE_URL não aponta para o projeto esperado (${EXPECTED_PROJECT_REF})`);
console.log("[validate-public-env] OK: variáveis públicas do Supabase configuradas.");