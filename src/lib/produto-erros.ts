/**
 * Traduz erros de violacao de unicidade do cadastro de produtos (SKU,
 * codigo de barras, QR Code, codigo interno) em mensagens amigaveis para
 * o usuario final, em vez de deixar vazar o erro tecnico do Postgres.
 *
 * Detecta pelo codigo SQLSTATE (23505 = unique_violation) combinado com o
 * nome da coluna mencionada na mensagem, em vez de depender do nome exato
 * de uma unica constraint/indice — a tabela `produtos` tem, para `sku`,
 * duas constraints unicas sobrepostas (a original `UNIQUE(owner_id, sku)`
 * da criacao da tabela e o indice parcial `produtos_owner_sku_unique`
 * adicionado depois); o Postgres pode reportar qualquer uma das duas.
 */
export function prettifyProdutoError(err: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyErr = err as any;
  const msg: string = anyErr?.message ?? String(err);
  const code: string | undefined = anyErr?.code;
  const m = msg.toLowerCase();

  const violacaoUnicidade =
    code === "23505" || m.includes("duplicate key") || m.includes("violates unique constraint");

  if (!violacaoUnicidade) return msg;

  if (m.includes("codigo_barras"))
    return "Este código de barras já está cadastrado em outro produto.";
  if (m.includes("qr_code")) return "Este QR Code já está cadastrado em outro produto.";
  if (m.includes("codigo_interno"))
    return "Este código interno já está cadastrado em outro produto.";
  if (m.includes("sku")) return "Este SKU já está cadastrado em outro produto.";

  return "Este registro já existe. Verifique os códigos informados.";
}
