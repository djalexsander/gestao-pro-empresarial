#!/usr/bin/env node
/**
 * Valida que o .sig gerado no build foi assinado pela mesma chave privada
 * cuja chave pública está embutida em src-tauri/tauri.conf.json
 * (plugins.updater.pubkey).
 *
 * IMPORTANTE: tanto o pubkey em tauri.conf.json quanto o conteúdo do arquivo
 * .exe.sig do Tauri são "base64 duplo": o conteúdo é um arquivo minisign
 * inteiro (com linhas "untrusted comment: ..." + payload base64 + ...)
 * que foi re-encodado em base64. Precisamos:
 *
 *   1) base64-decodar o conteúdo externo  -> texto do arquivo minisign
 *   2) pegar a 1ª linha que NÃO é comentário (o payload)
 *   3) base64-decodar essa linha           -> bytes minisign
 *   4) bytes[2..10] = key_id (8 bytes)
 *
 * Para o updater funcionar, key_id da pubkey == key_id da assinatura.
 */
import fs from "node:fs";
import path from "node:path";

function extractMinisignKeyId(outerBase64) {
  // 1) decodifica a "casca" base64 -> texto do arquivo minisign
  const minisignText = Buffer.from(outerBase64.trim(), "base64").toString("utf8");
  // 2) pega a primeira linha não-comentário (o payload base64 interno)
  const payloadLine = minisignText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find(
      (l) =>
        l.length > 0 &&
        !l.startsWith("untrusted comment") &&
        !l.startsWith("trusted comment"),
    );
  if (!payloadLine) {
    throw new Error("Payload minisign não encontrado dentro do base64 externo");
  }
  // 3) decodifica o payload -> bytes minisign
  const buf = Buffer.from(payloadLine, "base64");
  if (buf.length < 10) {
    throw new Error(`Payload minisign curto demais (${buf.length} bytes)`);
  }
  // 4) bytes 2..10 = key_id
  return buf.subarray(2, 10).toString("hex");
}

const conf = JSON.parse(fs.readFileSync("src-tauri/tauri.conf.json", "utf8"));
const pubkeyB64 = conf.plugins?.updater?.pubkey;
if (!pubkeyB64) {
  console.error("❌ plugins.updater.pubkey ausente em tauri.conf.json");
  process.exit(1);
}

const pubKeyId = extractMinisignKeyId(pubkeyB64);
console.log(`Pubkey configurada no app — key_id: ${pubKeyId}`);

const nsisDir = "src-tauri/target/release/bundle/nsis";
const files = fs.readdirSync(nsisDir);
const sigFile = files.find((f) => f.endsWith(".exe.sig"));
const exeFile = sigFile ? sigFile.replace(/\.sig$/, "") : null;

if (!sigFile || !exeFile) {
  console.error("❌ .exe.sig não encontrado em", nsisDir);
  process.exit(1);
}

const sigPath = path.join(nsisDir, sigFile);
const exePath = path.join(nsisDir, exeFile);
console.log(`Instalador: ${exePath}`);
console.log(`Assinatura: ${sigPath}`);

const sigOuter = fs.readFileSync(sigPath, "utf8");
const sigKeyId = extractMinisignKeyId(sigOuter);
console.log(`Assinatura gerada com   — key_id: ${sigKeyId}`);

if (pubKeyId !== sigKeyId) {
  console.error("");
  console.error("❌ Assinatura INVÁLIDA! O updater rejeitaria esta release.");
  console.error(`   pubkey  key_id: ${pubKeyId}`);
  console.error(`   sig     key_id: ${sigKeyId}`);
  console.error(
    "   A chave privada usada no build NÃO corresponde à pubkey embutida no app.",
  );
  process.exit(1);
}

console.log("");
console.log("✅ key_ids batem — a pubkey embutida no app reconhece esta assinatura.");
console.log("   O updater conseguirá verificar e instalar esta release.");
