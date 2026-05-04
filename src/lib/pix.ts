// Gerador mínimo de Pix BR Code (EMV) — Pix copia e cola estático.
// Referência: Manual do BR Code (BCB) — formato TLV (id|len|value).

function tlv(id: string, value: string): string {
  const len = value.length.toString().padStart(2, "0");
  return `${id}${len}${value}`;
}

function crc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function sanitize(s: string, max: number): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9 .\-]/g, "")
    .slice(0, max)
    .toUpperCase();
}

export interface PixPayloadInput {
  chave: string;
  nome: string;
  cidade: string;
  valor?: number;
  txid?: string;
  descricao?: string;
}

export function gerarPixCopiaCola(input: PixPayloadInput): string {
  const { chave, nome, cidade, valor, txid, descricao } = input;

  // Merchant Account Information (id 26)
  const mai =
    tlv("00", "br.gov.bcb.pix") +
    tlv("01", chave) +
    (descricao ? tlv("02", descricao.slice(0, 72)) : "");

  const txidSafe = (txid || "***").replace(/[^A-Za-z0-9]/g, "").slice(0, 25) || "***";

  const payload =
    tlv("00", "01") + // Payload Format Indicator
    tlv("26", mai) +
    tlv("52", "0000") + // MCC
    tlv("53", "986") + // Currency BRL
    (valor && valor > 0 ? tlv("54", valor.toFixed(2)) : "") +
    tlv("58", "BR") +
    tlv("59", sanitize(nome, 25) || "RECEBEDOR") +
    tlv("60", sanitize(cidade, 15) || "BRASIL") +
    tlv("62", tlv("05", txidSafe));

  const toCrc = payload + "6304";
  return toCrc + crc16(toCrc);
}
