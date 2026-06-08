import type { TerminalConexaoConfig } from "./types";
import {
  fetchWithTimeout,
  getBaseUrl,
  getLocalJson,
  postLocalJson,
} from "./localHttpClient";

const TIMEOUT_MS = 3000;

export interface OutboxStats {
  pending: number;
  sending: number;
  sent: number;
  error: number;
  last_sent_at_ms: number | null;
  last_error: string | null;
  /** Itens `pending` cujo backoff já venceu — elegíveis ao próximo tick. */
  due_now: number;
  /** Próximo `next_attempt_at_ms` agendado entre os pending (ms epoch). */
  next_attempt_at_ms: number | null;
  /** Última vez que o scheduler de background rodou. */
  last_auto_flush_ms: number | null;
  /** Última vez que o scheduler enviou algo (sent>0). */
  last_auto_flush_sent_ms: number | null;
  /** Telemetria da última rodada automática. */
  last_auto_attempted: number | null;
  last_auto_sent: number | null;
  last_auto_failed: number | null;
  /** Última vez que o operador clicou "Sincronizar agora". */
  last_manual_flush_ms: number | null;
}

export interface OutboxItem {
  local_uuid: string;
  client_uuid: string | null;
  payload: string;
  status: "pending" | "sending" | "sent" | "error";
  attempts: number;
  last_error: string | null;
  remote_id: string | null;
  created_at_ms: number;
  updated_at_ms: number;
  sent_at_ms: number | null;
}

export interface RegistrarMovLocalRequest {
  produto_id: string;
  variacao_id?: string | null;
  tipo: string;
  quantidade: number;
  custo_unitario?: number | null;
  observacoes?: string | null;
  origem?: string | null;
  client_uuid?: string | null;
}

export interface RegistrarMovLocalResponse {
  movimento_id: string;
  idempotente: boolean;
  saldo_anterior: number;
  saldo_posterior: number;
  outbox_status: "pending" | "sent";
  remote_id: string | null;
}

export interface OutboxFlushResult {
  attempted: number;
  sent: number;
  failed: number;
  errors: string[];
}

export async function fetchOutboxStats(
  cfg?: TerminalConexaoConfig,
): Promise<OutboxStats | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/db/outbox/estoque/stats`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxStats;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function fetchOutboxList(
  cfg: TerminalConexaoConfig | undefined,
  opts?: { status?: OutboxItem["status"]; limit?: number },
): Promise<OutboxItem[]> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return [];
  const url = new URL(`${baseUrl}/db/outbox/estoque`);
  if (opts?.status) url.searchParams.set("status", opts.status);
  if (opts?.limit) url.searchParams.set("limit", String(opts.limit));
  try {
    const res = await fetchWithTimeout(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: OutboxItem[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

export async function flushOutbox(
  cfg: TerminalConexaoConfig | undefined,
  authToken?: string | null,
): Promise<OutboxFlushResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/db/outbox/flush`, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxFlushResult;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function retryOutboxErrors(
  cfg: TerminalConexaoConfig | undefined,
): Promise<number> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return 0;
  try {
    const res = await fetchWithTimeout(`${baseUrl}/db/outbox/retry-errors`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { requeued?: number };
    return json.requeued ?? 0;
  } catch {
    return 0;
  }
}

export async function registrarMovimentoLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: RegistrarMovLocalRequest,
  authToken?: string | null,
): Promise<RegistrarMovLocalResponse | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/api/estoque/movimentacoes/registrar`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as RegistrarMovLocalResponse;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export interface RegistrarVendaLocalRequest {
  cliente_id: string | null;
  subtotal: number;
  desconto: number;
  total: number;
  forma_pagamento: string;
  status_pagamento: string;
  valor_recebido: number | null;
  troco: number | null;
  observacao: string | null;
  itens: unknown[];
  pagamentos?: unknown[];
  gerar_financeiro?: boolean;
  operador_id?: string | null;
  terminal_id?: string | null;
  client_uuid?: string | null;
  /**
   * Data de vencimento (YYYY-MM-DD) — OBRIGATÓRIA quando a venda contiver
   * pagamento `fiado`. Preservada do PDV até a RPC `finalizar_venda_pdv`
   * (campo `_data_vencimento`) para que Contas a Receber nasça com a data
   * correta também em vendas registradas offline.
   */
  data_vencimento?: string | null;
}

export interface RegistrarVendaLocalResponse {
  venda_id: string;
  idempotente: boolean;
  qtd_itens: number;
  total: number;
  outbox_status: "pending" | "sent";
  remote_id: string | null;
}

export async function registrarVendaLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: RegistrarVendaLocalRequest,
  authToken?: string | null,
): Promise<RegistrarVendaLocalResponse | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/api/vendas/registrar`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as RegistrarVendaLocalResponse;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function fetchOutboxVendasStats(
  cfg?: TerminalConexaoConfig,
): Promise<OutboxStats | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}/db/outbox/vendas/stats`, {
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxStats;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function fetchOutboxVendasList(
  cfg: TerminalConexaoConfig | undefined,
  opts?: { status?: OutboxItem["status"]; limit?: number },
): Promise<OutboxItem[]> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return [];
  const url = new URL(`${baseUrl}/db/outbox/vendas`);
  if (opts?.status) url.searchParams.set("status", opts.status);
  if (opts?.limit) url.searchParams.set("limit", String(opts.limit));
  try {
    const res = await fetchWithTimeout(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: OutboxItem[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

export async function flushOutboxVendas(
  cfg: TerminalConexaoConfig | undefined,
  authToken?: string | null,
): Promise<OutboxFlushResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/db/outbox/vendas/flush`, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxFlushResult;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function retryOutboxVendasErrors(
  cfg: TerminalConexaoConfig | undefined,
): Promise<number> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return 0;
  try {
    const res = await fetchWithTimeout(`${baseUrl}/db/outbox/vendas/retry-errors`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { requeued?: number };
    return json.requeued ?? 0;
  } catch {
    return 0;
  }
}

export interface OutboxCaixaStats extends OutboxStats {
  pending_abrir: number;
  pending_movimento: number;
  pending_fechar: number;
}

export interface OutboxCaixaItem extends OutboxItem {
  action: "abrir" | "movimento" | "fechar";
  caixa_local_uuid: string;
}

export interface CaixaLocalAbertoRow {
  local_uuid: string;
  remote_id: string | null;
  client_uuid: string | null;
  status: "aberto" | "fechado";
  valor_inicial: number;
  valor_informado: number | null;
  valor_esperado: number | null;
  diferenca: number | null;
  observacao_abertura: string | null;
  observacao_fechamento: string | null;
  operador_id: string | null;
  terminal_id: string | null;
  data_abertura_ms: number;
  data_fechamento_ms: number | null;
  qtd_movimentos: number;
  total_suprimentos: number;
  total_sangrias: number;
}

export interface AbrirCaixaLocalRequest {
  valor_inicial: number;
  observacao?: string | null;
  operador_id?: string | null;
  terminal_id?: string | null;
  client_uuid?: string | null;
}

export interface AbrirCaixaLocalResponse {
  caixa_id: string;
  idempotente: boolean;
  valor_inicial: number;
  outbox_status: "pending" | "sending" | "sent" | "error";
  remote_id: string | null;
}

export interface MovCaixaLocalRequest {
  caixa_id: string;
  tipo: "sangria" | "suprimento";
  valor: number;
  motivo?: string | null;
  operador_id?: string | null;
  client_uuid?: string | null;
}

export interface MovCaixaLocalResponse {
  movimento_id: string;
  idempotente: boolean;
  caixa_local_uuid: string;
  tipo: string;
  valor: number;
  outbox_status: "pending" | "sending" | "sent" | "error";
  remote_id: string | null;
}

export interface FecharCaixaLocalRequest {
  caixa_id: string;
  valor_informado: number;
  observacao?: string | null;
  client_uuid?: string | null;
}

export interface FecharCaixaLocalResponse {
  fechamento_id: string;
  idempotente: boolean;
  valor_informado: number;
  outbox_status: "pending" | "sending" | "sent" | "error";
  remote_id: string | null;
}

export function abrirCaixaLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: AbrirCaixaLocalRequest,
  authToken?: string | null,
): Promise<AbrirCaixaLocalResponse | null> {
  return postLocalJson(cfg, "/api/caixa/abrir", payload, authToken);
}

export function registrarMovCaixaLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: MovCaixaLocalRequest,
  authToken?: string | null,
): Promise<MovCaixaLocalResponse | null> {
  return postLocalJson(cfg, "/api/caixa/movimento", payload, authToken);
}

export function fecharCaixaLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: FecharCaixaLocalRequest,
  authToken?: string | null,
): Promise<FecharCaixaLocalResponse | null> {
  return postLocalJson(cfg, "/api/caixa/fechar", payload, authToken, 30_000);
}

export async function fetchCaixaLocalAberto(
  cfg: TerminalConexaoConfig | undefined,
  operadorId?: string | null,
): Promise<CaixaLocalAbertoRow | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const url = new URL(`${baseUrl}/api/caixa/aberto`);
  if (operadorId) url.searchParams.set("operador_id", operadorId);
  try {
    const res = await fetchWithTimeout(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as CaixaLocalAbertoRow | null;
  } catch {
    return null;
  }
}

export interface CaixaResumoFormaRow {
  forma_pagamento: string;
  total: number;
  qtd_vendas: number;
}

export interface CaixaResumoLocal {
  caixa_local_uuid: string;
  remote_id: string | null;
  status: "aberto" | "fechado";
  data_abertura_ms: number;
  data_fechamento_ms: number | null;
  operador_id: string | null;
  terminal_id: string | null;
  valor_inicial: number;
  valor_informado: number | null;
  valor_esperado_dinheiro: number;
  diferenca: number | null;
  total_vendido: number;
  qtd_vendas: number;
  total_suprimentos: number;
  total_sangrias: number;
  por_forma: CaixaResumoFormaRow[];
}

export interface LancamentoLocalRow {
  local_uuid: string;
  caixa_local_uuid: string;
  tipo: "entrada" | "saida";
  categoria: string;
  forma_pagamento: string | null;
  valor: number;
  descricao: string | null;
  origem: string;
  created_at_ms: number;
  // v11
  status?: string;
  venda_local_uuid?: string | null;
  cliente_id?: string | null;
  fornecedor_id?: string | null;
  data_competencia_ms?: number | null;
  data_vencimento_ms?: number | null;
  data_pagamento_ms?: number | null;
  operador_id?: string | null;
  cancelado_em_ms?: number | null;
  cancelado_motivo?: string | null;
  // v12 — sync com upstream
  remote_id?: string | null;
  sync_status?: "local_only" | "pending" | "synced" | "error";
}

export function fetchCaixaResumoLocal(
  cfg: TerminalConexaoConfig | undefined,
  opts: { caixaId?: string | null; operadorId?: string | null } = {},
): Promise<CaixaResumoLocal | null> {
  return getLocalJson<CaixaResumoLocal | null>(cfg, "/api/caixa/resumo", {
    caixa_id: opts.caixaId ?? undefined,
    operador_id: opts.operadorId ?? undefined,
  }).then((v) => v ?? null);
}

export function fetchCaixaLancamentosLocal(
  cfg: TerminalConexaoConfig | undefined,
  opts: { caixaId?: string | null; operadorId?: string | null } = {},
): Promise<LancamentoLocalRow[]> {
  return getLocalJson<LancamentoLocalRow[]>(cfg, "/api/caixa/lancamentos", {
    caixa_id: opts.caixaId ?? undefined,
    operador_id: opts.operadorId ?? undefined,
  }).then((v) => v ?? []);
}

export async function regenerarLancamentosCaixaLocal(
  cfg: TerminalConexaoConfig | undefined,
  caixaId: string,
): Promise<boolean> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return false;
  const url = new URL(`${baseUrl}/api/caixa/regenerar-lancamentos`);
  url.searchParams.set("caixa_id", caixaId);
  try {
    const res = await fetchWithTimeout(url.toString(), {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function fetchOutboxCaixaStats(
  cfg?: TerminalConexaoConfig,
): Promise<OutboxCaixaStats | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  try {
    const res = await fetchWithTimeout(`${baseUrl}/db/outbox/caixa/stats`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as OutboxCaixaStats;
  } catch {
    return null;
  }
}

export async function fetchOutboxCaixaList(
  cfg: TerminalConexaoConfig | undefined,
  opts?: { status?: OutboxItem["status"]; limit?: number },
): Promise<OutboxCaixaItem[]> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return [];
  const url = new URL(`${baseUrl}/db/outbox/caixa`);
  if (opts?.status) url.searchParams.set("status", opts.status);
  if (opts?.limit) url.searchParams.set("limit", String(opts.limit));
  try {
    const res = await fetchWithTimeout(url.toString(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const json = (await res.json()) as { items?: OutboxCaixaItem[] };
    return json.items ?? [];
  } catch {
    return [];
  }
}

export async function flushOutboxCaixa(
  cfg: TerminalConexaoConfig | undefined,
  authToken?: string | null,
): Promise<OutboxFlushResult | null> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (authToken) headers.Authorization = `Bearer ${authToken}`;
    const res = await fetch(`${baseUrl}/db/outbox/caixa/flush`, {
      method: "POST",
      headers,
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as OutboxFlushResult;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export async function retryOutboxCaixaErrors(
  cfg: TerminalConexaoConfig | undefined,
): Promise<number> {
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) return 0;
  try {
    const res = await fetchWithTimeout(`${baseUrl}/db/outbox/caixa/retry-errors`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) return 0;
    const json = (await res.json()) as { requeued?: number };
    return json.requeued ?? 0;
  } catch {
    return 0;
  }
}

export interface CancelarVendaLocalRequest {
  venda_local_uuid: string;
  motivo?: string | null;
  operador_id?: string | null;
  client_uuid?: string | null;
}

export interface CancelarVendaLocalResponse {
  venda_local_uuid: string;
  cancelamento_local_uuid: string;
  idempotente: boolean;
  qtd_itens_estornados: number;
  qtd_total_estornada: number;
  caixa_local_uuid: string | null;
  outbox_status: "pending" | "sending" | "sent" | "error";
  remote_response: string | null;
}

export function cancelarVendaLocal(
  cfg: TerminalConexaoConfig | undefined,
  payload: CancelarVendaLocalRequest,
  authToken?: string | null,
): Promise<CancelarVendaLocalResponse | null> {
  return postLocalJson(cfg, "/api/vendas/cancelar", payload, authToken, 15_000);
}
