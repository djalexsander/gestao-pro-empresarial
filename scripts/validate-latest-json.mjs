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
 *   - `version` em formato semver estrito (X.Y.Z[-pre][+build])
 *   - `version` consistente entre latest.json, package.json,
 *     src-tauri/tauri.conf.json, src-tauri/Cargo.toml e src/lib/version.ts
 *   - `pub_date` em ISO-8601 com timezone, não no futuro, não > 1 ano atrás
 *   - `platforms["windows-x86_64"]` presente
 *   - `url` é http(s), termina em .exe/.msi, aponta para o repo correto
 *     e contém a tag/versão correta
 *   - `signature` não-vazia e parece uma assinatura Tauri/minisign válida
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const ROOT = process.cwd();
const DEFAULT_PATH = "src-tauri/target/release/bundle/nsis/latest.json";
const target = resolve(ROOT, process.argv[2] || DEFAULT_PATH);

const errors = [];
const warn = [];
const fail = (m) => errors.push(m);
const note = (m) => warn.push(m);

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(resolve(ROOT, path), "utf8"));
  } catch {
    return null;
  }
}

function readOptionalJsonAbsolute(path) {
  if (!path || !existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

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

// -------------------- semver --------------------
// Estrito: X.Y.Z, com pré-release e build metadata opcionais (SemVer 2.0.0)
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

function parseSemver(v) {
  const m = SEMVER_RE.exec(v);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] || "",
    build: m[5] || "",
    core: `${m[1]}.${m[2]}.${m[3]}`,
  };
}

const expectedTag = (() => {
  const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || "";
  return tag || (typeof data.version === "string" ? `v${data.version}` : "");
})();

const expectedRepo = (() => {
  const fromEnv = process.env.GITHUB_REPOSITORY;
  if (fromEnv && /^[^/]+\/[^/]+$/.test(fromEnv)) return fromEnv.toLowerCase();
  return "djalexsander/gestao-pro-empresarial";
})();

const tauriConfig = readJsonFile("src-tauri/tauri.conf.json");
const updaterConfig = tauriConfig?.plugins?.updater;

if (/^true$/i.test(process.env.REPOSITORY_PRIVATE || "")) {
  fail(
    "O repositório GitHub está privado. O Tauri Updater baixa latest.json/assets sem autenticação; em repositório privado o GitHub responde 404 e o app mostra `Could not fetch a valid release JSON from the remote`.",
  );
}

// -------------------- version --------------------
let parsed = null;
if (!data.version || typeof data.version !== "string") {
  fail("`version` ausente ou não-string.");
} else {
  parsed = parseSemver(data.version);
  if (!parsed) {
    fail(`\`version\` não é semver válido (SemVer 2.0.0): "${data.version}".`);
  } else if (parsed.prerelease) {
    note(
      `version contém pré-release ("${parsed.prerelease}") — clientes estáveis podem ignorar.`,
    );
  }
}

// -------------------- consistência entre fontes de versão --------------------
function readVersionFromFile(path, extractor) {
  try {
    const txt = readFileSync(resolve(ROOT, path), "utf8");
    return { path, version: extractor(txt) };
  } catch {
    return { path, version: null, missing: true };
  }
}

const sources = [
  readVersionFromFile("package.json", (t) => {
    try {
      return JSON.parse(t).version || null;
    } catch {
      return null;
    }
  }),
  readVersionFromFile("src-tauri/tauri.conf.json", (t) => {
    try {
      return JSON.parse(t).version || null;
    } catch {
      return null;
    }
  }),
  readVersionFromFile("src-tauri/Cargo.toml", (t) => {
    // Pega a primeira ocorrência de `version = "X.Y.Z"` (deve ser do [package])
    const m = /^\s*version\s*=\s*"([^"]+)"/m.exec(t);
    return m ? m[1] : null;
  }),
  readVersionFromFile("src/lib/version.ts", (t) => {
    const m = /version\s*[:=]\s*["'`]([^"'`]+)["'`]/i.exec(t);
    return m ? m[1] : null;
  }),
];

if (data.version) {
  for (const s of sources) {
    if (s.missing) continue; // tudo bem se o arquivo não existe (ex.: version.ts opcional)
    if (!s.version) {
      note(`Não foi possível extrair version de ${s.path}.`);
      continue;
    }
    const p = parseSemver(s.version);
    if (!p) {
      fail(`${s.path} tem version não-semver: "${s.version}".`);
      continue;
    }
    if (s.version !== data.version) {
      // Permite diferença apenas em build metadata; pré-release deve bater.
      if (parsed && p.core === parsed.core && p.prerelease === parsed.prerelease) {
        note(
          `${s.path} (${s.version}) difere de latest.json (${data.version}) apenas em build metadata.`,
        );
      } else {
        fail(
          `Versão divergente: ${s.path}=${s.version} ≠ latest.json=${data.version}.`,
        );
      }
    }
  }
}

// -------------------- pub_date --------------------
const ISO_RE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;

if (!data.pub_date || typeof data.pub_date !== "string") {
  fail("`pub_date` ausente.");
} else {
  if (!ISO_RE.test(data.pub_date)) {
    fail(
      `\`pub_date\` não é ISO-8601 com timezone: "${data.pub_date}" (esperado ex.: 2026-05-05T12:34:56Z).`,
    );
  }
  const d = new Date(data.pub_date);
  if (isNaN(d.getTime())) {
    fail(`\`pub_date\` não parseável: "${data.pub_date}".`);
  } else {
    const now = Date.now();
    const diff = d.getTime() - now;
    // Tolerância de 10 min para clock skew
    if (diff > 10 * 60 * 1000) {
      fail(
        `\`pub_date\` está no futuro (${data.pub_date}) — verifique o relógio do runner.`,
      );
    }
    const ONE_YEAR = 365 * 24 * 60 * 60 * 1000;
    if (now - d.getTime() > ONE_YEAR) {
      note(
        `\`pub_date\` tem mais de 1 ano (${data.pub_date}) — release antiga?`,
      );
    }
  }
}

// -------------------- platforms --------------------
/**
 * Mapa de plataformas conhecidas do Tauri Updater v2 e as extensões válidas
 * de instalador para cada uma. Plataformas fora dessa lista geram aviso
 * (não falham) — o Tauri permite chaves customizadas.
 */
const PLATFORM_INSTALLERS = {
  "windows-x86_64": [".exe", ".msi"],
  "windows-aarch64": [".exe", ".msi"],
  "windows-i686": [".exe", ".msi"],
  "darwin-x86_64": [".app.tar.gz", ".dmg"],
  "darwin-aarch64": [".app.tar.gz", ".dmg"],
  "darwin-universal": [".app.tar.gz", ".dmg"],
  "linux-x86_64": [".AppImage", ".AppImage.tar.gz", ".deb", ".rpm"],
  "linux-aarch64": [".AppImage", ".AppImage.tar.gz", ".deb", ".rpm"],
  "linux-armv7": [".AppImage", ".AppImage.tar.gz", ".deb", ".rpm"],
};

const REQUIRE_LOCAL_ASSETS = /^true$/i.test(process.env.REQUIRE_LOCAL_ASSETS || "");
const CHECK_REMOTE_URLS = /^true$/i.test(process.env.CHECK_REMOTE_URLS || "");
const bundleRoot = resolve(ROOT, "src-tauri/target/release/bundle");

function listBundleFiles(dir = bundleRoot, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) listBundleFiles(path, out);
    else out.push({ path, name, size: stat.size });
  }
  return out;
}

const bundleFiles = listBundleFiles();

function findBundleFile(name) {
  return bundleFiles.find((f) => f.name === name) || null;
}

function safeDecodePath(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function checkRemoteDownload(url, label, { expectJson = false } = {}) {
  if (!CHECK_REMOTE_URLS) return;
  try {
    const res = await fetch(url, {
      method: expectJson ? "GET" : "HEAD",
      redirect: "follow",
      headers: { "User-Agent": "GestaoPro-Updater-Diagnostics" },
    });
    if (!res.ok) {
      fail(`${label} não está acessível publicamente (${res.status} ${res.statusText}): ${url}`);
      return;
    }
    if (expectJson) {
      const remote = await res.json().catch(() => null);
      if (!remote || typeof remote !== "object") {
        fail(`${label} respondeu, mas não é JSON válido: ${url}`);
      } else if (data.version && remote.version !== data.version) {
        fail(`${label} remoto tem version=${remote.version} ≠ latest.json local=${data.version}.`);
      }
    }
  } catch (e) {
    fail(`${label} falhou ao acessar publicamente: ${url} (${e.message})`);
  }
}

function endsWithAny(pathname, exts) {
  const lower = pathname.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext.toLowerCase()));
}

const validatedPlatforms = [];

if (!data.platforms || typeof data.platforms !== "object") {
  fail("`platforms` ausente.");
} else {
  const keys = Object.keys(data.platforms);
  if (keys.length === 0) {
    fail("`platforms` está vazio — nenhum alvo declarado.");
  }

  for (const key of keys) {
    const entry = data.platforms[key];
    const prefix = `platforms["${key}"]`;

    if (!entry || typeof entry !== "object") {
      fail(`${prefix} não é um objeto.`);
      continue;
    }

    const allowedExts = PLATFORM_INSTALLERS[key];
    if (!allowedExts) {
      note(
        `${prefix}: chave de plataforma desconhecida (não é padrão do Tauri Updater v2).`,
      );
    }

    // url
    let urlOk = false;
    let assetName = "";
    let localAsset = null;
    if (!entry.url || typeof entry.url !== "string") {
      fail(`${prefix}.url ausente.`);
    } else {
      try {
        const u = new URL(entry.url);
        if (!/^https?:$/.test(u.protocol)) {
          fail(`${prefix}.url não é http(s): ${entry.url}`);
        }
        const decoded = safeDecodePath(u.pathname);
        assetName = basename(decoded);
        if (allowedExts && !endsWithAny(decoded, allowedExts)) {
          fail(
            `${prefix}.url não termina em ${allowedExts.join("/")} (instalador esperado para ${key}): ${entry.url}`,
          );
        } else if (
          !allowedExts &&
          !/\.(exe|msi|dmg|deb|rpm|AppImage|tar\.gz|zip)$/i.test(decoded)
        ) {
          note(
            `${prefix}.url não tem extensão de instalador reconhecida: ${entry.url}`,
          );
        }
        if (!u.hostname.includes("github.com")) {
          note(`${prefix}.url não aponta para github.com: ${u.hostname}`);
        }
        const isGitHubUrl = u.hostname === "github.com" || u.hostname.endsWith(".github.com");
        if (
          isGitHubUrl &&
          !decoded.toLowerCase().includes(`/${expectedRepo}/`)
        ) {
          fail(`${prefix}.url não aponta para o repo correto (${expectedRepo}): ${entry.url}`);
        }
        if (isGitHubUrl && expectedTag) {
          const tagPath = `/${expectedRepo}/releases/download/${expectedTag}/`.toLowerCase();
          const latestPath = `/${expectedRepo}/releases/latest/download/`.toLowerCase();
          const decodedLower = decoded.toLowerCase();
          if (decodedLower.includes(latestPath)) {
            fail(
              `${prefix}.url usa /releases/latest/download para o instalador. Use URL tagada /releases/download/${expectedTag}/${assetName} para evitar 404 por release/latest divergente.`,
            );
          } else if (!decodedLower.includes(tagPath)) {
            fail(`${prefix}.url não aponta para a tag esperada "${expectedTag}": ${entry.url}`);
          }
        }
        if (!assetName) {
          fail(`${prefix}.url não contém nome de arquivo no caminho: ${entry.url}`);
        } else {
          localAsset = findBundleFile(assetName);
          if (!localAsset) {
            const message = `${prefix}.url referencia "${assetName}", mas esse arquivo não foi encontrado em src-tauri/target/release/bundle.`;
            if (REQUIRE_LOCAL_ASSETS) fail(message);
            else note(message);
          } else if (localAsset.size <= 0) {
            fail(`${prefix}.url referencia "${assetName}", mas o arquivo local está vazio.`);
          }
        }
        if (data.version) {
          // Aceita variações comuns de nome do arquivo:
          //   app-1.1.5.exe, app_1.1.5_x64-setup.exe, App.v1.1.5.msi,
          //   app-1.1.5+build.123.exe, foo.1.1.5-beta.2.dmg, etc.
          // Também tolera ?query e #hash (u.pathname já os exclui),
          // separadores _ - + . e prefixo v/V.
          const versionInUrl = (() => {
            const haystack = decoded.replace(/[_\-+]/g, ".").toLowerCase();
            const v = data.version.toLowerCase();
            const vNorm = v.replace(/[_\-+]/g, ".");
            const core = parsed ? parsed.core : v;
            const variants = [vNorm, core];
            for (const candidate of variants) {
              const re = new RegExp(
                `(^|[./v])${candidate.replace(/\./g, "\\.")}([./]|$)`,
                "i",
              );
              if (re.test(haystack)) return candidate;
            }
            return null;
          })();

          if (!versionInUrl) {
            fail(
              `${prefix}.url não contém a versão "${data.version}" — possível asset de release antiga: ${entry.url}`,
            );
          } else if (
            parsed &&
            versionInUrl === parsed.core &&
            parsed.prerelease
          ) {
            note(
              `${prefix}.url contém apenas o core "${parsed.core}" sem o pré-release "${parsed.prerelease}".`,
            );
          }
        }
        await checkRemoteDownload(entry.url, `${prefix}.url`);
        urlOk = true;
      } catch (e) {
        fail(`${prefix}.url malformada: ${entry.url} (${e.message})`);
      }
    }

    // signature
    if (!entry.signature || typeof entry.signature !== "string") {
      fail(`${prefix}.signature ausente.`);
    } else {
      const sig = entry.signature.trim();
      if (sig.length < 100) {
        fail(`${prefix}.signature suspeitosamente curta (${sig.length} chars).`);
      }
      const hasMinisignHeader = /untrusted comment:/i.test(sig);
      const looksLikeRawTauriSignature = /^[A-Za-z0-9+/=\r\n]+$/.test(sig);
      if (!hasMinisignHeader && !looksLikeRawTauriSignature) {
        fail(
          `${prefix}.signature não parece ser uma assinatura Tauri/minisign válida.`,
        );
      }
      if (localAsset) {
        const sigAsset = findBundleFile(`${localAsset.name}.sig`);
        if (!sigAsset) {
          const message = `${prefix}.signature: arquivo local ${localAsset.name}.sig não encontrado ao lado dos bundles.`;
          if (REQUIRE_LOCAL_ASSETS) fail(message);
          else note(message);
        } else {
          const diskSig = readFileSync(sigAsset.path, "utf8").trim();
          if (!diskSig) {
            fail(`${prefix}.signature: arquivo ${sigAsset.name} está vazio.`);
          } else if (diskSig !== sig) {
            fail(`${prefix}.signature diverge do conteúdo de ${sigAsset.name}.`);
          }
        }
      }
    }

    if (urlOk) validatedPlatforms.push({ key, url: entry.url });
  }
}

// -------------------- saída --------------------
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
console.log(`  version  : ${data.version}`);
console.log(`  pub_date : ${data.pub_date}`);
console.log(`  plataformas (${validatedPlatforms.length}):`);
for (const p of validatedPlatforms) {
  console.log(`    - ${p.key} → ${p.url}`);
}
console.log(
  `  fontes   : ${sources
    .filter((s) => !s.missing && s.version)
    .map((s) => `${s.path}=${s.version}`)
    .join(", ")}`,
);

