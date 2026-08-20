import { describe, expect, it } from "vitest";
import { prettifyProdutoError } from "./produto-erros";

function pgError(message: string, code?: string) {
  return { message, code };
}

describe("prettifyProdutoError", () => {
  it("traduz violacao de SKU pelo indice novo (produtos_owner_sku_unique)", () => {
    const e = pgError(
      'duplicate key value violates unique constraint "produtos_owner_sku_unique"',
      "23505",
    );
    expect(prettifyProdutoError(e)).toBe("Este SKU já está cadastrado em outro produto.");
  });

  it("tambem traduz quando quem dispara e a constraint legada auto-gerada (produtos_owner_id_sku_key)", () => {
    const e = pgError(
      'duplicate key value violates unique constraint "produtos_owner_id_sku_key"',
      "23505",
    );
    expect(prettifyProdutoError(e)).toBe("Este SKU já está cadastrado em outro produto.");
  });

  it("traduz violacao de codigo de barras", () => {
    const e = pgError(
      'duplicate key value violates unique constraint "produtos_owner_codigo_barras_unique"',
      "23505",
    );
    expect(prettifyProdutoError(e)).toBe(
      "Este código de barras já está cadastrado em outro produto.",
    );
  });

  it("traduz violacao de QR Code", () => {
    const e = pgError(
      'duplicate key value violates unique constraint "produtos_owner_qr_code_unique"',
      "23505",
    );
    expect(prettifyProdutoError(e)).toBe("Este QR Code já está cadastrado em outro produto.");
  });

  it("traduz violacao de codigo interno", () => {
    const e = pgError(
      'duplicate key value violates unique constraint "produtos_owner_codigo_interno_unique"',
      "23505",
    );
    expect(prettifyProdutoError(e)).toBe(
      "Este código interno já está cadastrado em outro produto.",
    );
  });

  it("usa mensagem generica para violacao de unicidade sem coluna reconhecida (ex.: variacao)", () => {
    const e = pgError(
      'duplicate key value violates unique constraint "produto_variacoes_owner_client_uuid_uniq"',
      "23505",
    );
    expect(prettifyProdutoError(e)).toBe(
      "Este registro já existe. Verifique os códigos informados.",
    );
  });

  it("detecta unicidade mesmo sem o codigo 23505, so pelo texto da mensagem", () => {
    const e = pgError('duplicate key value violates unique constraint "produtos_owner_sku_unique"');
    expect(prettifyProdutoError(e)).toBe("Este SKU já está cadastrado em outro produto.");
  });

  it("nao mexe em erros que nao sao de unicidade", () => {
    const e = pgError("Não autenticado", "28000");
    expect(prettifyProdutoError(e)).toBe("Não autenticado");
  });

  it("lida com erro sem objeto estruturado (string simples)", () => {
    expect(prettifyProdutoError("algo deu errado")).toBe("algo deu errado");
  });
});
