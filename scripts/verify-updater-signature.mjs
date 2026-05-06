#!/usr/bin/env node
/**
 * Valida que o arquivo .sig gerado no build foi assinado pela mesma chave
 * privada cuja chave pública está embutida em src-tauri/tauri.conf.json
 * (plugins.updater.pubkey).
 *
 * Formato minisign (usado pelo Tauri updater):
 *   pubkey  (base64 do conteúdo após "untrusted comment"): <2 bytes sig_alg> <8 bytes key_id> <32 bytes ed25519 pub>
 *   sig file linha 2 (base64):                              <2 bytes sig_alg> <8 bytes key_id> <64 bytes ed25519 sig>
 *
 * Para o updater funcionar, o key_id da pubkey precisa bater com o key_id da assinatura.
 * É exatamente isso que validamos aqui — o mesmo check que o updater faz antes de baixar.
 */
import fs from "node:fs";
import path from "node:path";

function decodeTauriBase64(value) {
  // Tauri armazena a chave/sig com base64 "duplo": o conteúdo do arquivo
  // minisign inteiro é re-encodado em base64 e colocado em tauri.conf.json
  // (e no .sig é só o conteúdo cru). Tentamos decodificar como minisign direto;
  // se vier com cabeçalho "untrusted comment", pegamos a 2ª linha.
  const raw = Buffer.from(value, "base64").toString("utf8");
  const text = raw.includes("untrusted comment") ? raw : value;
  const lines = text.split(/\r?\n/).filter(Boolean);
  // Linha do payload é a que NÃO começa com "untrusted comment" nem "trusted comment"
  const payload = lines.find(
    (l) => !l.startsWith("untrusted comment") && !l.startsWith("trusted comment"),
  );
  if (!payload) throw new Error("Não consegui localizar payload base64");
  return Buffer.from(payload, "base64");
}

function keyIdHex(buf) {
  // bytes 2..10 = key id (8 bytes, little-endian no minisign, mas comparamos como hex bruto)
  return buf.subarray(2, 10).toString("hex");
}

const conf = JSON.parse(
  fs.readFileSync("src-tauri/tauri.conf.json", "utf8"),
);
const pubkeyB64 = conf.plugins?.updater?.pubkey;
if (!pubkeyB64) {
  console.error("❌ plugins.updater.pubkey ausente em tauri.conf.json");
  process.exit(1);
}

const pubBuf = decodeTauriBase64(pubkeyB64);
const pubKeyId = keyIdHex(pubBuf);
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

const sigContent = fs.readFileSync(sigPath, "utf8");
const sigLines = sigContent.split(/\r?\n/).filter(Boolean);
const sigPayloadLine = sigLines.find(
  (l) => !l.startsWith("untrusted comment") && !l.startsWith("trusted comment"),
);
if (!sigPayloadLine) {
  console.error("❌ Não consegui ler payload da assinatura");
  process.exit(1);
}
const sigBuf = Buffer.from(sigPayloadLine, "base64");
const sigKeyId = keyIdHex(sigBuf);
console.log(`Assinatura gerada com  — key_id: ${sigKeyId}`);

if (pubKeyId !== sigKeyId) {
  console.error("");
  console.error("❌ Assinatura INVÁLIDA! O updater rejeitaria esta release.");
  console.error(`   pubkey  key_id: ${pubKeyId}`);
  console.error(`   sig     key_id: ${sigKeyId}`);
  console.error("   A chave privada usada no build NÃO corresponde à pubkey embutida no app.");
  process.exit(1);
}

console.log("");
console.log("✅ key_ids batem — a pubkey embutida no app reconhece esta assinatura.");
console.log("   O updater conseguirá verificar e instalar esta release.");
