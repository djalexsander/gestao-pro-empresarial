/**
 * Onda 0 — Fundamento de auditoria de relatórios.
 *
 * Padrão para TODO relatório do hub /relatorios:
 *  - Cada query devolve { rows, audit }.
 *  - `audit` documenta de onde os dados vieram, quais filtros foram aplicados,
 *    quantos registros foram lidos vs. usados, e o total calculado.
 *  - Registros cancelados/inativos/excluídos NÃO entram no total por padrão.
 *  - Quando a empresa está zerada, todo relatório precisa devolver
 *    rows=[] e audit com totalRegistros=0 / totalCalculado=0.
 *
 * Isto não muda o layout: o painel "Auditoria deste relatório" é collapsible
 * e fica fora da área de exportação visual.
 */

export type StatusIgnoradoMotivo =
  | "cancelado"
  | "estornado"
  | "excluido"
  | "inativo"
  | "rascunho"
  | "fora_do_filtro"
  | "sem_empresa"
  | "outro";

export interface RelatorioAuditoriaIgnorado {
  motivo: StatusIgnoradoMotivo;
  quantidade: number;
  detalhe?: string;
}

export interface RelatorioAuditoriaDivergencia {
  campo: string;
  esperado: number | string | null;
  obtido: number | string | null;
  detalhe?: string;
}

export interface RelatorioAuditoria {
  /** Nome lógico do relatório (ex: "relatorio.vendas"). */
  relatorio: string;
  /** Tabela / RPC / view de origem (ex: "vendas + venda_itens"). */
  fonte: string;
  /** owner_id (empresa atual) que filtrou a consulta. */
  ownerId: string | null;
  /** Filtros aplicados (intervalo, status, cliente, etc). */
  filtros: Record<string, unknown>;
  /** Quantidade bruta lida do banco. */
  totalRegistrosLidos: number;
  /** Quantidade efetivamente usada no relatório (após filtros de status). */
  totalRegistros: number;
  /** Soma do valor principal do relatório (R$). */
  totalCalculado: number;
  /** Registros descartados por status/cancelamento/inatividade. */
  ignorados: RelatorioAuditoriaIgnorado[];
  /** Divergências detectadas (ex: saldo de estoque ≠ soma das movimentações). */
  divergencias: RelatorioAuditoriaDivergencia[];
  /** Momento da geração (ISO). */
  geradoEm: string;
}

export interface AuditedResult<T> {
  rows: T[];
  audit: RelatorioAuditoria;
}

export interface WithAuditContext {
  relatorio: string;
  fonte: string;
  ownerId: string | null;
  filtros?: Record<string, unknown>;
}

/**
 * Constrói um AuditedResult a partir das linhas brutas e das linhas
 * efetivamente usadas. Calcula automaticamente quantos registros foram
 * ignorados e por qual motivo.
 *
 * @param rowsBrutas todas as linhas lidas do banco
 * @param classify   função que devolve o motivo de ignorar (ou null se aceita)
 * @param valorOf    função que devolve o valor principal somado da linha
 */
export function withAudit<T>(
  ctx: WithAuditContext,
  rowsBrutas: T[],
  classify: (row: T) => StatusIgnoradoMotivo | null,
  valorOf: (row: T) => number,
  divergencias: RelatorioAuditoriaDivergencia[] = [],
): AuditedResult<T> {
  const aceitas: T[] = [];
  const contadores = new Map<StatusIgnoradoMotivo, number>();

  for (const row of rowsBrutas) {
    const motivo = classify(row);
    if (motivo) {
      contadores.set(motivo, (contadores.get(motivo) ?? 0) + 1);
    } else {
      aceitas.push(row);
    }
  }

  const totalCalculado = aceitas.reduce(
    (acc, row) => acc + (Number.isFinite(valorOf(row)) ? valorOf(row) : 0),
    0,
  );

  const ignorados: RelatorioAuditoriaIgnorado[] = Array.from(
    contadores.entries(),
  )
    .map(([motivo, quantidade]) => ({ motivo, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade);

  return {
    rows: aceitas,
    audit: {
      relatorio: ctx.relatorio,
      fonte: ctx.fonte,
      ownerId: ctx.ownerId,
      filtros: ctx.filtros ?? {},
      totalRegistrosLidos: rowsBrutas.length,
      totalRegistros: aceitas.length,
      totalCalculado: Number(totalCalculado.toFixed(2)),
      ignorados,
      divergencias,
      geradoEm: new Date().toISOString(),
    },
  };
}

/** Auditoria neutra para relatórios sem dados (empresa zerada). */
export function emptyAudit(ctx: WithAuditContext): RelatorioAuditoria {
  return {
    relatorio: ctx.relatorio,
    fonte: ctx.fonte,
    ownerId: ctx.ownerId,
    filtros: ctx.filtros ?? {},
    totalRegistrosLidos: 0,
    totalRegistros: 0,
    totalCalculado: 0,
    ignorados: [],
    divergencias: [],
    geradoEm: new Date().toISOString(),
  };
}

/** Conjunto padrão de status que são SEMPRE descartados em relatórios. */
export const STATUS_DESCARTADOS = new Set([
  "cancelado",
  "cancelada",
  "canceled",
  "estornado",
  "estornada",
  "reversed",
  "excluido",
  "excluida",
  "deleted",
  "rascunho",
  "draft",
]);

export function classificarStatusPadrao(
  status: string | null | undefined,
): StatusIgnoradoMotivo | null {
  if (!status) return null;
  const s = status.toLowerCase().trim();
  if (s === "cancelado" || s === "cancelada" || s === "canceled") return "cancelado";
  if (s === "estornado" || s === "estornada" || s === "reversed") return "estornado";
  if (s === "excluido" || s === "excluida" || s === "deleted") return "excluido";
  if (s === "rascunho" || s === "draft") return "rascunho";
  if (s === "inativo" || s === "inativa") return "inativo";
  return null;
}

const DEV = typeof import.meta !== "undefined" && (import.meta as { env?: { DEV?: boolean } }).env?.DEV;

export function logAudit(audit: RelatorioAuditoria): void {
  if (!DEV) return;
  // eslint-disable-next-line no-console
  console.debug("[RELATORIO_AUDIT]", audit.relatorio, {
    fonte: audit.fonte,
    ownerId: audit.ownerId,
    filtros: audit.filtros,
    lidos: audit.totalRegistrosLidos,
    usados: audit.totalRegistros,
    total: audit.totalCalculado,
    ignorados: audit.ignorados,
    divergencias: audit.divergencias,
  });
}
