/**
 * ============================================================================
 * local-server adapter — Servidor Local (esta MÁQUINA é o backend)
 * ============================================================================
 *
 * Etapa 2 (offline-first): em vez de delegar leituras direto ao cloudAdapter,
 * o adapter agora consome o backend HTTP local (Tauri/Axum em
 * `127.0.0.1:<port>`) para os domínios que já têm endpoint+SQLite no Rust:
 *
 *   - produtos.list             → GET /api/produtos/list
 *   - clientes.listLite         → GET /api/clientes/lite
 *   - fornecedores.list         → GET /api/fornecedores
 *   - estoque.saldosLinhas      → GET /api/estoque/saldos
 *   - estoque.movimentacoes     → GET /api/estoque/movimentacoes
 *   - funcionarios.list         → GET /api/relatorios/funcionarios-ativos
 *
 * Ordem de prioridade (NUNCA cloud primeiro):
 *
 *   1. SQLite local (servido pelo backend, header `x-gp-source: local-table*`)
 *   2. Servidor local foi à nuvem agora (header `x-gp-source: upstream`)
 *   3. cloudAdapter como fallback opcional — só quando o servidor local
 *      falha (down, sem upstream configurado, timeout, status != 200)
 *
 * Importante:
 *   - Nenhuma escrita é alterada nesta etapa (continua via cloudAdapter).
 *   - cloudAdapter NÃO é removido; é apenas o último recurso.
 *   - Se a chamada local falhar e a UI estiver offline, o fallback cloud
 *    também irá falhar — o `withTimeoutFallback` da camada superior
 *    continua protegendo a UI de travar.
 *   - Logs DEV: `[LOCAL_DB]`, `[LOCAL_SERVER]`, `[CLOUD_FALLBACK]`.
 */

import type { DataAdapter } from "../adapter";
import { cloudAdapter } from "./cloud";
import { reportDataSource } from "../source-telemetry";
import { getLocalServerStatus } from "@/integrations/desktop/tauriBridge";

const HTTP_TIMEOUT_MS = 4000;

// Cache da porta local — `getLocalServerStatus()` é uma chamada Tauri leve
// mas não precisamos invocá-la em toda leitura. Re-resolvemos quando o cache
// fica velho (5s) ou quando uma tentativa falha.
let cachedBaseUrl: { url: string; at: number } | null = null;
const BASE_URL_TTL_MS = 5_000;

async function resolveBaseUrl(): Promise<string | null> {
  const now = Date.now();
  if (cachedBaseUrl && now - cachedBaseUrl.at < BASE_URL_TTL_MS) {
    return cachedBaseUrl.url;
  }
  try {
    const st = await getLocalServerStatus();
    if (!st.running || !st.port) {
      cachedBaseUrl = null;
      return null;
    }
    const url = `http://127.0.0.1:${st.port}`;
    cachedBaseUrl = { url, at: now };
    return url;
  } catch {
    cachedBaseUrl = null;
    return null;
  }
}

function logSource(domain: string, method: string, source: string) {
  if (!import.meta.env.DEV) return;
  // Mapeia o `x-gp-source` do servidor para os prefixos de log do plano:
  //   - local-db / local-table*       → [LOCAL_DB] / [LOCAL_PRODUTOS] / [LOCAL_ESTOQUE]
  //   - upstream                      → [LOCAL_SERVER]
  //   - cloud (fallback)              → [CLOUD_FALLBACK] / [CLOUD_FALLBACK_ESTOQUE]
  const isEstoque = domain === "estoque";
  const isProduto = domain === "produtos";
  let tag = "[LOCAL_DB]";
  if (source === "cloud-fallback") {
    tag = isEstoque ? "[CLOUD_FALLBACK_ESTOQUE]" : "[CLOUD_FALLBACK]";
  } else if (source === "upstream") {
    tag = "[LOCAL_SERVER]";
  } else if (isEstoque) {
    tag = "[LOCAL_ESTOQUE]";
  } else if (isProduto) {
    tag = method.startsWith("buscarPor") ? "[LOCAL_BUSCA]" : "[LOCAL_PRODUTOS]";
  }
  // eslint-disable-next-line no-console
  console.debug(`${tag} ${domain}.${method} (origem=${source})`);
}

/**
 * Tenta consumir um endpoint do servidor local (mesma máquina). Retorna
 * `null` quando o servidor não está rodando ou a chamada falha — o caller
 * decide se aplica fallback cloud.
 */
async function tryLocal<T>(
  domain: string,
  method: string,
  path: string,
  query?: Record<string, string | undefined>,
): Promise<T | null> {
  const baseUrl = await resolveBaseUrl();
  if (!baseUrl) return null;

  const url = new URL(`${baseUrl}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      // Servidor respondeu mas com erro → invalida cache de baseUrl.
      cachedBaseUrl = null;
      return null;
    }
    const json = (await res.json()) as unknown;
    // Servidor pode envelopar em `{ data }` ou devolver o array direto.
    const payload = (json && typeof json === "object" && "data" in (json as Record<string, unknown>)
      ? (json as Record<string, unknown>).data
      : json) as T;
    const sourceHdr = res.headers.get("x-gp-source") ?? "local-db";
    logSource(domain, method, sourceHdr);
    reportDataSource({
      source: "local-server",
      domain,
      method,
      fallback: false,
    });
    return payload;
  } catch {
    clearTimeout(timer);
    // Timeout / network error → próxima leitura re-resolve a porta.
    cachedBaseUrl = null;
    return null;
  }
}

async function withCloudFallback<T>(
  domain: string,
  method: string,
  localFetcher: () => Promise<T | null>,
  cloudFetcher: () => Promise<T>,
): Promise<T> {
  const local = await localFetcher();
  if (local !== null && local !== undefined) return local;
  // Servidor local indisponível ou falhou → último recurso é a nuvem.
  // NÃO trava a UI: se a nuvem também estiver fora, propaga o erro pra
  // camada superior (que já tem withTimeoutFallback).
  const result = await cloudFetcher();
  logSource(domain, method, "cloud-fallback");
  reportDataSource({ source: "cloud", domain, method, fallback: true });
  return result;
}

/**
 * Variante para endpoints de busca pontual (`buscarPorCodigo`/`buscarPorPlu`).
 * O servidor local responde:
 *   - 200 + `{ result: T | null }` → resposta autoritativa offline (mesmo se
 *     `result === null`, NÃO caímos para cloud — produto não existe).
 *   - 503                          → tabela ainda vazia; deixamos cair para
 *     cloud quando online.
 *   - erro de rede / timeout       → idem (cloud fallback).
 */
async function tryLocalSearch<T>(
  domain: string,
  method: string,
  path: string,
  query: Record<string, string | undefined>,
): Promise<{ kind: "ok"; result: T | null } | { kind: "unavailable" }> {
  const baseUrl = await resolveBaseUrl();
  if (!baseUrl) return { kind: "unavailable" };
  const url = new URL(`${baseUrl}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== "") url.searchParams.set(k, v);
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (res.status === 503) return { kind: "unavailable" };
    if (!res.ok) {
      cachedBaseUrl = null;
      return { kind: "unavailable" };
    }
    const json = (await res.json()) as { result: T | null };
    logSource(domain, method, res.headers.get("x-gp-source") ?? "local-table");
    reportDataSource({ source: "local-server", domain, method, fallback: false });
    return { kind: "ok", result: json.result ?? null };
  } catch {
    clearTimeout(timer);
    cachedBaseUrl = null;
    return { kind: "unavailable" };
  }
}

// ----------------------------------------------------------------------------
// Adapter
// ----------------------------------------------------------------------------

export const localServerAdapter: DataAdapter = {
  ...cloudAdapter,

  produtos: {
    ...cloudAdapter.produtos,
    list: (input) =>
      withCloudFallback(
        "produtos",
        "list",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["produtos"]["list"]>>>(
            "produtos",
            "list",
            "/api/produtos/list",
            {
              status: input?.status ?? undefined,
              categoria_id: input?.categoria_id ?? undefined,
              busca: input?.busca ?? undefined,
            },
          ),
        () => cloudAdapter.produtos.list(input),
      ),
    buscarPorCodigo: async (codigo) => {
      const r = await tryLocalSearch<
        Awaited<ReturnType<DataAdapter["produtos"]["buscarPorCodigo"]>>
      >("produtos", "buscarPorCodigo", "/api/produtos/buscar-codigo", { codigo });
      if (r.kind === "ok") return r.result;
      const result = await cloudAdapter.produtos.buscarPorCodigo(codigo);
      logSource("produtos", "buscarPorCodigo", "cloud-fallback");
      reportDataSource({
        source: "cloud",
        domain: "produtos",
        method: "buscarPorCodigo",
        fallback: true,
      });
      return result;
    },
    buscarPorPlu: async (plu) => {
      const r = await tryLocalSearch<
        Awaited<ReturnType<DataAdapter["produtos"]["buscarPorPlu"]>>
      >("produtos", "buscarPorPlu", "/api/produtos/buscar-plu", { plu });
      if (r.kind === "ok") return r.result;
      const result = await cloudAdapter.produtos.buscarPorPlu(plu);
      logSource("produtos", "buscarPorPlu", "cloud-fallback");
      reportDataSource({
        source: "cloud",
        domain: "produtos",
        method: "buscarPorPlu",
        fallback: true,
      });
      return result;
    },
  },

  clientes: {
    ...cloudAdapter.clientes,
    listLite: (input) =>
      withCloudFallback(
        "clientes",
        "listLite",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["clientes"]["listLite"]>>>(
            "clientes",
            "listLite",
            "/api/clientes/lite",
            {
              status:
                input && "status" in input
                  ? (input.status ?? undefined)
                  : "ativo",
            },
          ),
        () => cloudAdapter.clientes.listLite(input),
      ),
  },

  fornecedores: {
    ...cloudAdapter.fornecedores,
    list: (input) =>
      withCloudFallback(
        "fornecedores",
        "list",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["fornecedores"]["list"]>>>(
            "fornecedores",
            "list",
            "/api/fornecedores",
            {
              status: input?.status ?? undefined,
              busca: input?.busca ?? undefined,
            },
          ),
        () => cloudAdapter.fornecedores.list(input),
      ),
  },

  funcionarios: {
    ...cloudAdapter.funcionarios,
    list: (input) =>
      withCloudFallback(
        "funcionarios",
        "list",
        async () => {
          const rows = await tryLocal<
            Awaited<ReturnType<DataAdapter["funcionarios"]["list"]>>
          >(
            "funcionarios",
            "list",
            "/api/relatorios/funcionarios-ativos",
          );
          if (!rows) return null;
          // O endpoint local devolve apenas ativos. Se o caller pediu
          // todos (somente_ativos != true), fallback pra cloud para
          // garantir paridade de dados.
          if (input?.somente_ativos === false) return null;
          return rows;
        },
        () => cloudAdapter.funcionarios.list(input),
      ),
    /**
     * Sub-etapa 4.1: o servidor LOCAL é a fonte primária de validação de
     * PIN. Mesmo online, validamos pelo SQLite local — assim a regra é
     * idêntica ao modo offline e os terminais LAN compartilham o mesmo
     * verificador. Cloud só entra como fallback quando o servidor local
     * ainda não tem verificador para esse operador (`notReady`).
     */
    validarPin: async (input) => {
      const baseUrl = await resolveBaseUrl();
      if (baseUrl) {
        try {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8_000);
          const res = await fetch(`${baseUrl}/api/auth/validar-pin`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify({
              funcionario_id: input.funcionario_id,
              pin: input.pin,
            }),
            signal: ctrl.signal,
            cache: "no-store",
          });
          clearTimeout(timer);
          if (res.ok) {
            const data = (await res.json()) as {
              autorizado: boolean;
              funcionario: { id: string; nome: string; login: string; role: "gerente" | "caixa" } | null;
              motivo: string | null;
            };
            if (data.autorizado && data.funcionario) {
              // eslint-disable-next-line no-console
              console.debug("[OFFLINE_AUTH] PIN validado no servidor local");
              return data.funcionario;
            }
            // eslint-disable-next-line no-console
            console.warn("[OFFLINE_AUTH] PIN recusado no servidor local");
            throw new Error(data.motivo ?? "PIN inválido.");
          }
          if (res.status !== 404) {
            // eslint-disable-next-line no-console
            console.debug("[OFFLINE_AUTH] fallback cloud online — servidor local indisponível");
          }
          // 404 = operador ainda não preparado → cai pra cloud silenciosamente.
        } catch (err) {
          if (err instanceof Error && /PIN/i.test(err.message)) throw err;
          // network/abort → cloud fallback
          // eslint-disable-next-line no-console
          console.debug("[OFFLINE_AUTH] fallback cloud online — erro local:", (err as Error)?.message);
        }
      }
      return cloudAdapter.funcionarios.validarPin(input);
    },
  },

  estoque: {
    ...cloudAdapter.estoque,
    saldosLinhas: () =>
      withCloudFallback(
        "estoque",
        "saldosLinhas",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["estoque"]["saldosLinhas"]>>>(
            "estoque",
            "saldosLinhas",
            "/api/estoque/saldos",
          ),
        () => cloudAdapter.estoque.saldosLinhas(),
      ),
    movimentacoes: (input) =>
      withCloudFallback(
        "estoque",
        "movimentacoes",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["estoque"]["movimentacoes"]>>>(
            "estoque",
            "movimentacoes",
            "/api/estoque/movimentacoes",
            {
              produto_id: input?.produto_id ?? undefined,
              limit: input?.limit != null ? String(input.limit) : undefined,
            },
          ),
        () => cloudAdapter.estoque.movimentacoes(input),
      ),
  },

  // -----------------------------------------------------------------
  // Sub-etapa 8.1 — Clientes a Receber / Fiado offline-first
  // (servidor local = esta máquina). Mesma estratégia do local-terminal.
  // -----------------------------------------------------------------
  financeiro: {
    ...cloudAdapter.financeiro,
    listFiado: async () => {
      const baseUrl = await resolveBaseUrl();
      if (baseUrl) {
        const rows = await tryLocal<ContaReceberLocalServerRow[]>(
          "financeiro",
          "listFiado",
          "/api/financeiro/receber",
          { status: "todos", limit: "1000" },
        );
        if (Array.isArray(rows) && rows.length > 0) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[LOCAL_RECEIVABLE_UI] listFiado servidor local", { rows: rows.length });
          }
          return rows.map(mapContaReceberToFiadoDomainServer);
        }
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug("[LOCAL_RECEIVABLE_UI] listFiado vazio local — fallback cloud");
        }
      }
      const result = await cloudAdapter.financeiro.listFiado();
      reportDataSource({ source: "cloud", domain: "financeiro", method: "listFiado", fallback: true });
      return result;
    },

    registrarPagamento: async (input) => {
      const baseUrl = await resolveBaseUrl();
      if (baseUrl) {
        const dataMs = input.data_pagamento
          ? Date.parse(`${input.data_pagamento}T12:00:00`)
          : Date.now();
        const r = await postLocalJson<{
          local_uuid: string;
          idempotente: boolean;
          receber_local_uuid: string;
          status: string;
        }>("/api/financeiro/receber/baixar", {
          receber_id: input.lancamento_id,
          valor: input.valor,
          forma_pagamento: input.forma_pagamento ?? null,
          data_pagamento_ms: Number.isFinite(dataMs) ? dataMs : Date.now(),
          observacao: input.observacao ?? null,
          client_uuid: input.client_uuid ?? null,
        });
        if (r) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[LOCAL_RECEIVABLE_UI] baixa servidor local ok", r);
          }
          reportDataSource({ source: "local-server", domain: "financeiro", method: "registrarPagamento", fallback: false });
          return {
            pagamento_id: r.local_uuid,
            lancamento_id: r.receber_local_uuid,
            idempotente: r.idempotente,
          };
        }
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug("[LOCAL_RECEIVABLE_UI] baixa local falhou — fallback cloud");
        }
      }
      const out = await cloudAdapter.financeiro.registrarPagamento(input);
      reportDataSource({ source: "cloud", domain: "financeiro", method: "registrarPagamento", fallback: true });
      return out;
    },

    cancelarLancamento: async (input) => {
      const baseUrl = await resolveBaseUrl();
      if (baseUrl) {
        const r = await postLocalJson<{
          receber_local_uuid: string;
          idempotente: boolean;
          status: string;
        }>("/api/financeiro/receber/cancelar", {
          receber_id: input.lancamento_id,
          motivo: input.motivo ?? null,
        });
        if (r) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[LOCAL_RECEIVABLE_UI] cancelamento servidor local ok", r);
          }
          reportDataSource({ source: "local-server", domain: "financeiro", method: "cancelarLancamento", fallback: false });
          return { lancamento_id: r.receber_local_uuid, idempotente: r.idempotente };
        }
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug("[LOCAL_RECEIVABLE_UI] cancelamento local falhou — fallback cloud");
        }
      }
      const out = await cloudAdapter.financeiro.cancelarLancamento(input);
      reportDataSource({ source: "cloud", domain: "financeiro", method: "cancelarLancamento", fallback: true });
      return out;
    },
  },
};

// ----------------------------------------------------------------------------
// Helpers de mapeamento + POST local (Sub-etapa 8.1)
// ----------------------------------------------------------------------------

interface ContaReceberLocalServerRow {
  local_uuid: string;
  venda_local_uuid: string;
  cliente_id: string | null;
  cliente_nome: string | null;
  cliente_cpf: string | null;
  cliente_telefone: string | null;
  forma_pagamento: string | null;
  valor: number;
  valor_pago: number;
  valor_restante: number;
  vencimento_ms: number | null;
  status: string;
  status_base: string;
  sync_status: string;
  created_at_ms: number;
  updated_at_ms: number;
}

function msToIsoDateServer(ms: number | null | undefined): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function statusContaToFiadoServer(status: string): string {
  switch (status) {
    case "pago":
      return "recebido";
    case "parcial":
      return "parcial";
    case "cancelado":
      return "cancelado";
    default:
      return "pendente";
  }
}

function mapContaReceberToFiadoDomainServer(
  r: ContaReceberLocalServerRow,
): import("../adapter").FiadoLancamentoDomain {
  const dataEmissao = msToIsoDateServer(r.created_at_ms);
  const dataVenc =
    msToIsoDateServer(r.vencimento_ms ?? r.created_at_ms) ?? dataEmissao ?? "";
  const dataPag =
    r.valor_pago > 0 || r.status === "pago"
      ? msToIsoDateServer(r.updated_at_ms)
      : null;
  const obs =
    r.sync_status && r.sync_status !== "synced" ? `[sync:${r.sync_status}]` : null;
  return {
    id: r.local_uuid,
    descricao: `Venda fiado ${r.venda_local_uuid.slice(0, 8)}`,
    valor: r.valor,
    valor_pago: r.valor_pago,
    data_vencimento: dataVenc,
    data_emissao: dataEmissao,
    data_pagamento: dataPag,
    status: statusContaToFiadoServer(r.status),
    observacoes: obs,
    cliente_id: r.cliente_id,
    venda_id: r.venda_local_uuid,
    forma_pagamento: r.forma_pagamento,
    cliente: r.cliente_id
      ? {
          id: r.cliente_id,
          nome: r.cliente_nome ?? "Cliente",
          documento: r.cliente_cpf,
          telefone: r.cliente_telefone,
          celular: r.cliente_telefone,
          email: null,
        }
      : null,
    venda: {
      id: r.venda_local_uuid,
      numero: r.venda_local_uuid.slice(0, 8),
      data_finalizacao: dataEmissao,
      total: r.valor,
    },
  };
}

async function postLocalJson<T>(path: string, body: unknown): Promise<T | null> {
  const baseUrl = await resolveBaseUrl();
  if (!baseUrl) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      cachedBaseUrl = null;
      return null;
    }
    return (await res.json()) as T;
  } catch {
    clearTimeout(timer);
    cachedBaseUrl = null;
    return null;
  }
}

// Mantido para compat com imports antigos / testes.
export const LOCAL_READ_DOMAINS = [
  "produtos",
  "clientes",
  "fornecedores",
  "funcionarios",
  "estoque",
] as const;
