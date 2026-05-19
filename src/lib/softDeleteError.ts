/**
 * Converte erros técnicos de exclusão/inativação em mensagens amigáveis,
 * sem expor "TypeError: Failed to fetch" ao usuário.
 *
 * Uso típico em mutations de soft delete (produtos, fornecedores, clientes,
 * funcionários, etc.).
 */
export function friendlyDeleteError(err: unknown, entidade = "registro"): Error {
  if (typeof window !== "undefined" && import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.error("[DELETE_ERROR_HANDLED]", { entidade, err });
  }
  const msg = err instanceof Error ? err.message : String(err);
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String((err as { name?: string }).name ?? "")
      : "";
  const isNet =
    name === "TypeError" ||
    /failed to fetch|networkerror|load failed|fetch failed|network request failed/i.test(msg);
  if (isNet) {
    return new Error(
      `Não foi possível remover o ${entidade} agora. Verifique sua conexão e tente novamente.`,
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

/**
 * Marca o log padronizado de soft delete em DEV.
 */
export function logSoftDelete(
  entidade: string,
  id: string,
  extra: Record<string, unknown> = {},
): void {
  if (typeof window === "undefined" || !import.meta.env.DEV) return;
  // eslint-disable-next-line no-console
  console.debug("[SOFT_DELETE]", { entidade, id, ...extra });
}
