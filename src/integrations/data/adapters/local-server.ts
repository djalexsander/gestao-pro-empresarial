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
import { buildDashboardFromRaw } from "./offline-dashboard";

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
  if (local !== null && local !== undefined) {
    if (import.meta.env.DEV && (domain === "relatorios" || domain === "dashboard")) {
      const tag = domain === "dashboard" ? "[LOCAL_DASHBOARD]" : "[LOCAL_REPORTS]";
      // eslint-disable-next-line no-console
      console.debug(`${tag} ${domain}.${method} (origem=local-server)`);
    }
    return local;
  }
  const result = await cloudFetcher();
  logSource(domain, method, "cloud-fallback");
  reportDataSource({ source: "cloud", domain, method, fallback: true });
  if (import.meta.env.DEV && (domain === "relatorios" || domain === "dashboard")) {
    const tag = domain === "dashboard" ? "[LOCAL_DASHBOARD]" : "[LOCAL_REPORTS]";
    // eslint-disable-next-line no-console
    console.debug(`${tag} ${domain}.${method} (origem=cloud-fallback)`);
  }
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
    // -------- WRITES offline-first (Fase 1 v24) --------
    criar: async (input) => {
      const body = toUnderscoredBody(input as unknown as Record<string, unknown>);
      const r = await postLocalAuth<ProdutoMutLocal>("/api/produtos/criar", body);
      if (r) {
        reportDataSource({ source: "local-server", domain: "produtos", method: "criar", fallback: false });
        if (import.meta.env.DEV) console.debug(`[PRODUTOS_LOCAL_CREATE] id=${r.produto_id} idempotente=${r.idempotente} outbox=${r.outbox_status}`);
        return { produto_id: r.produto_id, idempotente: r.idempotente };
      }
      const result = await cloudAdapter.produtos.criar(input);
      reportDataSource({ source: "cloud", domain: "produtos", method: "criar", fallback: true });
      return result;
    },
    editar: async (input) => {
      const { produto_id, ...rest } = input as unknown as Record<string, unknown> & { produto_id: string };
      const body = { produto_id, ...toUnderscoredBody(rest) };
      const r = await postLocalAuth<ProdutoMutLocal>("/api/produtos/editar", body);
      if (r) {
        reportDataSource({ source: "local-server", domain: "produtos", method: "editar", fallback: false });
        if (import.meta.env.DEV) console.debug(`[PRODUTOS_OUTBOX] editar id=${r.produto_id} outbox=${r.outbox_status}`);
        return { produto_id: r.produto_id };
      }
      const result = await cloudAdapter.produtos.editar(input);
      reportDataSource({ source: "cloud", domain: "produtos", method: "editar", fallback: true });
      return result;
    },
    alterarStatus: async (input) => {
      const r = await postLocalAuth<ProdutoMutLocal>("/api/produtos/alterar-status", {
        produto_id: input.produto_id, status: input.status,
      });
      if (r) {
        reportDataSource({ source: "local-server", domain: "produtos", method: "alterarStatus", fallback: false });
        if (import.meta.env.DEV) console.debug(`[PRODUTOS_OUTBOX] alterar_status id=${r.produto_id} status=${input.status} outbox=${r.outbox_status}`);
        return { produto_id: r.produto_id, status: input.status };
      }
      const result = await cloudAdapter.produtos.alterarStatus(input);
      reportDataSource({ source: "cloud", domain: "produtos", method: "alterarStatus", fallback: true });
      return result;
    },
    excluir: async (produtoId) => {
      const r = await postLocalAuth<ProdutoMutLocal>("/api/produtos/excluir", { produto_id: produtoId });
      if (r) {
        reportDataSource({ source: "local-server", domain: "produtos", method: "excluir", fallback: false });
        if (import.meta.env.DEV) console.debug(`[PRODUTOS_OUTBOX] excluir id=${r.produto_id} outbox=${r.outbox_status}`);
        return { produto_id: r.produto_id, excluido: true };
      }
      const result = await cloudAdapter.produtos.excluir(produtoId);
      reportDataSource({ source: "cloud", domain: "produtos", method: "excluir", fallback: true });
      return result;
    },
    criarCategoria: async (input) => {
      const body = {
        _nome: input.nome,
        _parent_id: input.parent_id ?? null,
        _descricao: input.descricao ?? null,
        _categoria_id_in: input.categoria_id ?? null,
        _client_uuid: input.client_uuid ?? null,
      };
      const r = await postLocalAuth<CategoriaMutLocal>("/api/categorias-produto/criar", body);
      if (r) {
        reportDataSource({ source: "local-server", domain: "categoriasProduto", method: "criar", fallback: false });
        if (import.meta.env.DEV) console.debug(`[CAT_PROD_LOCAL_CREATE] id=${r.categoria_id} idempotente=${r.idempotente} outbox=${r.outbox_status}`);
        return { categoria_id: r.categoria_id, idempotente: r.idempotente };
      }
      const result = await cloudAdapter.produtos.criarCategoria(input);
      reportDataSource({ source: "cloud", domain: "categoriasProduto", method: "criar", fallback: true });
      return result;
    },
  },

  categoriasProduto: {
    ...cloudAdapter.categoriasProduto,
    editar: async (input) => {
      const r = await postLocalAuth<CategoriaMutLocal>("/api/categorias-produto/editar", {
        categoria_id: input.categoria_id,
        nome: input.nome,
        parent_id: input.parent_id ?? null,
        descricao: input.descricao ?? null,
      });
      if (r) {
        reportDataSource({ source: "local-server", domain: "categoriasProduto", method: "editar", fallback: false });
        if (import.meta.env.DEV) console.debug(`[CAT_PROD_OUTBOX] editar id=${r.categoria_id} outbox=${r.outbox_status}`);
        return { categoria_id: r.categoria_id };
      }
      const result = await cloudAdapter.categoriasProduto.editar(input);
      reportDataSource({ source: "cloud", domain: "categoriasProduto", method: "editar", fallback: true });
      return result;
    },
    alterarStatus: async (input) => {
      const r = await postLocalAuth<CategoriaMutLocal>("/api/categorias-produto/alterar-status", {
        categoria_id: input.categoria_id, ativo: input.ativo,
      });
      if (r) {
        reportDataSource({ source: "local-server", domain: "categoriasProduto", method: "alterarStatus", fallback: false });
        if (import.meta.env.DEV) console.debug(`[CAT_PROD_OUTBOX] alterar_status id=${r.categoria_id} ativo=${input.ativo} outbox=${r.outbox_status}`);
        return { categoria_id: r.categoria_id, ativo: input.ativo, idempotente: r.idempotente };
      }
      const result = await cloudAdapter.categoriasProduto.alterarStatus(input);
      reportDataSource({ source: "cloud", domain: "categoriasProduto", method: "alterarStatus", fallback: true });
      return result;
    },
    excluir: async (categoriaId) => {
      const r = await postLocalAuth<CategoriaMutLocal>("/api/categorias-produto/excluir", { categoria_id: categoriaId });
      if (r) {
        reportDataSource({ source: "local-server", domain: "categoriasProduto", method: "excluir", fallback: false });
        if (import.meta.env.DEV) console.debug(`[CAT_PROD_OUTBOX] excluir id=${r.categoria_id} outbox=${r.outbox_status}`);
        return { categoria_id: r.categoria_id, excluido: true };
      }
      const result = await cloudAdapter.categoriasProduto.excluir(categoriaId);
      reportDataSource({ source: "cloud", domain: "categoriasProduto", method: "excluir", fallback: true });
      return result;
    },
  },

  clientes: {
    ...cloudAdapter.clientes,
    criar: async (input) => {
      const r = await postLocalAuth<{ cliente_id: string; idempotente: boolean }>(
        "/api/clientes/criar",
        { ...input, client_uuid: input.client_uuid ?? null },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "clientes", method: "criar", fallback: false });
        return { cliente_id: r.cliente_id, idempotente: r.idempotente };
      }
      const result = await cloudAdapter.clientes.criar(input);
      reportDataSource({ source: "cloud", domain: "clientes", method: "criar", fallback: true });
      return result;
    },
    editar: async (input) => {
      const r = await postLocalAuth<{ cliente_id: string }>(
        "/api/clientes/editar",
        input as unknown as Record<string, unknown>,
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "clientes", method: "editar", fallback: false });
        return { cliente_id: r.cliente_id };
      }
      const result = await cloudAdapter.clientes.editar(input);
      reportDataSource({ source: "cloud", domain: "clientes", method: "editar", fallback: true });
      return result;
    },
    alterarStatus: async (input) => {
      const r = await postLocalAuth<{ cliente_id: string }>(
        "/api/clientes/alterar-status",
        { cliente_id: input.cliente_id, status: input.status },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "clientes", method: "alterarStatus", fallback: false });
        return { cliente_id: r.cliente_id, status: input.status };
      }
      const result = await cloudAdapter.clientes.alterarStatus(input);
      reportDataSource({ source: "cloud", domain: "clientes", method: "alterarStatus", fallback: true });
      return result;
    },
    excluir: async (clienteId) => {
      const r = await postLocalAuth<{ cliente_id: string }>(
        "/api/clientes/excluir",
        { cliente_id: clienteId },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "clientes", method: "excluir", fallback: false });
        return { cliente_id: r.cliente_id, excluido: true };
      }
      const result = await cloudAdapter.clientes.excluir(clienteId);
      reportDataSource({ source: "cloud", domain: "clientes", method: "excluir", fallback: true });
      return result;
    },
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
    criar: async (input) => {
      const r = await postLocalAuth<{ fornecedor_id: string; idempotente: boolean }>(
        "/api/fornecedores/criar",
        { ...input, client_uuid: input.client_uuid ?? null },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "fornecedores", method: "criar", fallback: false });
        return { fornecedor_id: r.fornecedor_id, idempotente: r.idempotente };
      }
      const result = await cloudAdapter.fornecedores.criar(input);
      reportDataSource({ source: "cloud", domain: "fornecedores", method: "criar", fallback: true });
      return result;
    },
    editar: async (input) => {
      const r = await postLocalAuth<{ fornecedor_id: string }>(
        "/api/fornecedores/editar",
        input as unknown as Record<string, unknown>,
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "fornecedores", method: "editar", fallback: false });
        return { fornecedor_id: r.fornecedor_id };
      }
      const result = await cloudAdapter.fornecedores.editar(input);
      reportDataSource({ source: "cloud", domain: "fornecedores", method: "editar", fallback: true });
      return result;
    },
    alterarStatus: async (input) => {
      const r = await postLocalAuth<{ fornecedor_id: string }>(
        "/api/fornecedores/alterar-status",
        { fornecedor_id: input.fornecedor_id, status: input.status },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "fornecedores", method: "alterarStatus", fallback: false });
        return { fornecedor_id: r.fornecedor_id, status: input.status };
      }
      const result = await cloudAdapter.fornecedores.alterarStatus(input);
      reportDataSource({ source: "cloud", domain: "fornecedores", method: "alterarStatus", fallback: true });
      return result;
    },
    excluir: async (fornecedorId) => {
      const r = await postLocalAuth<{ fornecedor_id: string }>(
        "/api/fornecedores/excluir",
        { fornecedor_id: fornecedorId },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "fornecedores", method: "excluir", fallback: false });
        return { fornecedor_id: r.fornecedor_id, excluido: true };
      }
      const result = await cloudAdapter.fornecedores.excluir(fornecedorId);
      reportDataSource({ source: "cloud", domain: "fornecedores", method: "excluir", fallback: true });
      return result;
    },
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
    criar: async (input) => {
      const baseUrl = await resolveBaseUrl();
      if (baseUrl) {
        try {
          const { supabase } = await import("@/integrations/supabase/client");
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token ?? null;
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8_000);
          const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
          if (token) headers.Authorization = `Bearer ${token}`;
          const res = await fetch(`${baseUrl}/api/funcionarios/criar`, {
            method: "POST", headers, signal: ctrl.signal, cache: "no-store",
            body: JSON.stringify({
              funcionario_id: input.funcionario_id ?? null,
              nome: input.nome, login: input.login, pin: input.pin, role: input.role,
              client_uuid: input.client_uuid ?? null,
            }),
          });
          clearTimeout(timer);
          if (res.ok) {
            const r = (await res.json()) as { funcionario_id: string; idempotente: boolean };
            if (import.meta.env.DEV) console.debug(`[FUNCIONARIOS_LOCAL_CREATE] origem=local-server id=${r.funcionario_id}`);
            return { funcionario_id: r.funcionario_id, idempotente: r.idempotente };
          }
        } catch { /* fallback cloud */ }
      }
      return cloudAdapter.funcionarios.criar(input);
    },
    editar: async (input) => {
      const r = await postLocalAuth<{ funcionario_id: string }>(
        "/api/funcionarios/editar",
        {
          funcionario_id: input.funcionario_id,
          nome: input.nome,
          login: input.login,
          role: input.role,
        },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "funcionarios", method: "editar", fallback: false });
        return { funcionario_id: r.funcionario_id };
      }
      const result = await cloudAdapter.funcionarios.editar(input);
      reportDataSource({ source: "cloud", domain: "funcionarios", method: "editar", fallback: true });
      return result;
    },
    alterarStatus: async (input) => {
      const r = await postLocalAuth<{ funcionario_id: string }>(
        "/api/funcionarios/alterar-status",
        { funcionario_id: input.funcionario_id, ativo: input.ativo },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "funcionarios", method: "alterarStatus", fallback: false });
        return { funcionario_id: r.funcionario_id, ativo: input.ativo, idempotente: false };
      }
      const result = await cloudAdapter.funcionarios.alterarStatus(input);
      reportDataSource({ source: "cloud", domain: "funcionarios", method: "alterarStatus", fallback: true });
      return result;
    },
    excluir: async (funcionarioId) => {
      const r = await postLocalAuth<{ funcionario_id: string }>(
        "/api/funcionarios/excluir",
        { funcionario_id: funcionarioId },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "funcionarios", method: "excluir", fallback: false });
        return { funcionario_id: r.funcionario_id, excluido: true };
      }
      const result = await cloudAdapter.funcionarios.excluir(funcionarioId);
      reportDataSource({ source: "cloud", domain: "funcionarios", method: "excluir", fallback: true });
      return result;
    },
    resetarPin: async (input) => {
      const r = await postLocalAuth<{ funcionario_id: string }>(
        "/api/funcionarios/resetar-pin",
        { funcionario_id: input.funcionario_id, pin: input.pin },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "funcionarios", method: "resetarPin", fallback: false });
        return;
      }
      await cloudAdapter.funcionarios.resetarPin(input);
      reportDataSource({ source: "cloud", domain: "funcionarios", method: "resetarPin", fallback: true });
    },
    list: (input) =>

      withCloudFallback(
        "funcionarios",
        "list",
        async () => {
          const somenteAtivos = input?.somente_ativos === true;
          // Para a aba admin (somente_ativos != true) pedimos TODOS ao
          // servidor local (inclui inativos). Para PDV (apenas ativos)
          // mantemos o endpoint padrão.
          const query = somenteAtivos
            ? undefined
            : { incluir_inativos: "1" };
          const raw = await tryLocal<unknown>(
            "funcionarios",
            "list",
            "/api/relatorios/funcionarios-ativos",
            query,
          );
          if (!Array.isArray(raw)) {
            if (import.meta.env.DEV) {
              // eslint-disable-next-line no-console
              console.debug("[FUNCIONARIOS_LOCAL] sem cache local → cloud");
            }
            return null;
          }
          // Normaliza payload bruto vindo do PostgREST para o formato
          // FuncionarioDomain consumido pela UI.
          const rows = raw
            .map((r) => {
              const row = r as Record<string, unknown>;
              const id = typeof row.id === "string" ? row.id : null;
              if (!id) return null;
              return {
                id,
                nome: String(row.nome ?? ""),
                login: String(row.login ?? ""),
                role:
                  row.role === "gerente"
                    ? ("gerente" as const)
                    : ("caixa" as const),
                ativo: row.ativo !== false,
                ultimo_acesso:
                  typeof row.ultimo_acesso === "string"
                    ? row.ultimo_acesso
                    : null,
                created_at:
                  typeof row.created_at === "string"
                    ? row.created_at
                    : typeof row.updated_at === "string"
                      ? (row.updated_at as string)
                      : new Date(0).toISOString(),
              };
            })
            .filter(
              (x): x is import("../types").FuncionarioDomain => x !== null,
            );
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug(
              `[FUNCIONARIOS_LIST] origem=local-server total=${rows.length} somente_ativos=${somenteAtivos}`,
            );
          }
          // Se o cache veio vazio, evita "Nenhum funcionário cadastrado"
          // enganoso e cai para cloud (pode ser cache ainda não sincronizado).
          if (rows.length === 0) return null;
          return somenteAtivos ? rows.filter((f) => f.ativo) : rows;
        },
        async () => {
          const rows = await cloudAdapter.funcionarios.list(input);
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug(
              `[FUNCIONARIOS_LIST] origem=cloud total=${rows.length}`,
            );
          }
          return rows;
        },
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
    registrarMovimento: async (input) => {
      const r = await postLocalAuth<{
        movimento_id: string;
        idempotente: boolean;
        saldo_anterior: number;
        saldo_posterior: number;
      }>("/api/estoque/movimentacoes/registrar", {
        produto_id: input.produto_id,
        variacao_id: input.variacao_id ?? null,
        tipo: input.tipo,
        quantidade: input.quantidade,
        custo_unitario: input.custo_unitario ?? null,
        observacoes: input.observacoes ?? null,
        origem: input.origem ?? null,
        client_uuid: input.client_uuid ?? null,
      });
      if (r) {
        reportDataSource({ source: "local-server", domain: "estoque", method: "registrarMovimento", fallback: false });
        return {
          movimento_id: r.movimento_id,
          idempotente: r.idempotente,
          saldo_anterior: r.saldo_anterior,
          saldo_posterior: r.saldo_posterior,
        };
      }
      const result = await cloudAdapter.estoque.registrarMovimento(input);
      reportDataSource({ source: "cloud", domain: "estoque", method: "registrarMovimento", fallback: true });
      return result;
    },
  },

  // -----------------------------------------------------------------
  // Etapa 21 — Compras offline-first (camada 5 do plano global).
  // Grava cabeçalho + itens em `compras_local`, atualiza estoque local
  // ao receber e gera `contas_pagar_local` (via Rust). Cloud só como
  // fallback quando o servidor local não respondeu.
  // -----------------------------------------------------------------
  compras: {
    ...cloudAdapter.compras,
    list: (input) =>
      withCloudFallback(
        "compras",
        "list",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["compras"]["list"]>>>(
            "compras",
            "list",
            "/api/compras",
            { limit: input?.limit != null ? String(input.limit) : undefined },
          ),
        () => cloudAdapter.compras.list(input),
      ),
    criar: async (input) => {
      const r = await postLocalAuth<{
        compra_id: string;
        compra_local_uuid: string;
        idempotente: boolean;
      }>("/api/compras/criar", {
        _numero: input.numero,
        _fornecedor_id: input.fornecedor_id,
        _data_emissao: input.data_emissao,
        _data_prevista: input.data_prevista ?? null,
        _data_vencimento: input.data_vencimento ?? null,
        _numero_nf: input.numero_nf ?? null,
        _serie_nf: input.serie_nf ?? null,
        _desconto: input.desconto ?? 0,
        _frete: input.frete ?? 0,
        _outros: input.outros ?? 0,
        _observacoes: input.observacoes ?? null,
        _itens: input.itens,
      });
      if (r) {
        reportDataSource({ source: "local-server", domain: "compras", method: "criar", fallback: false });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { id: r.compra_id, local_uuid: r.compra_local_uuid } as any;
      }
      const result = await cloudAdapter.compras.criar(input);
      reportDataSource({ source: "cloud", domain: "compras", method: "criar", fallback: true });
      return result;
    },
    atualizarStatus: async (input) => {
      const r = await postLocalAuth<{ compra_id: string }>(
        "/api/compras/alterar-status",
        { compra_id: input.id, status: input.status },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "compras", method: "atualizarStatus", fallback: false });
        return;
      }
      await cloudAdapter.compras.atualizarStatus(input);
      reportDataSource({ source: "cloud", domain: "compras", method: "atualizarStatus", fallback: true });
    },
    atualizarMetadados: async (input) => {
      const payload: Record<string, unknown> = { compra_id: input.id };
      if ("data_vencimento" in input) payload._data_vencimento = input.data_vencimento ?? null;
      if ("data_prevista" in input) payload._data_prevista = input.data_prevista ?? null;
      if ("fornecedor_id" in input) payload._fornecedor_id = input.fornecedor_id ?? null;
      if ("numero_nf" in input) payload._numero_nf = input.numero_nf ?? null;
      if ("serie_nf" in input) payload._serie_nf = input.serie_nf ?? null;
      if ("observacoes" in input) payload._observacoes = input.observacoes ?? null;
      const r = await postLocalAuth<{ compra_id: string }>(
        "/api/compras/editar-metadados",
        payload,
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "compras", method: "atualizarMetadados", fallback: false });
        return;
      }
      await cloudAdapter.compras.atualizarMetadados(input);
      reportDataSource({ source: "cloud", domain: "compras", method: "atualizarMetadados", fallback: true });
    },
    receber: async (input) => {
      const r = await postLocalAuth<{ compra_id: string }>(
        "/api/compras/receber",
        {
          compra_id: input.id,
          data_recebimento: input.data_recebimento,
          gerar_financeiro: input.gerar_financeiro,
          data_vencimento: input.data_vencimento ?? undefined,
        },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "compras", method: "receber", fallback: false });
        return { compra_id: r.compra_id, local: true };
      }
      const result = await cloudAdapter.compras.receber(input);
      reportDataSource({ source: "cloud", domain: "compras", method: "receber", fallback: true });
      return result;
    },
    receberItens: async (input) => {
      const r = await postLocalAuth<{ compra_id: string }>(
        "/api/compras/receber-itens",
        {
          compra_id: input.compra_id,
          itens: input.itens.map((i) => ({ item_id: i.item_id, quantidade: i.quantidade })),
          data_recebimento: input.data_recebimento,
          gerar_financeiro: input.gerar_financeiro,
          data_vencimento: input.data_vencimento ?? undefined,
        },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "compras", method: "receberItens", fallback: false });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return { compra_id: r.compra_id, local: true } as any;
      }
      const result = await cloudAdapter.compras.receberItens(input);
      reportDataSource({ source: "cloud", domain: "compras", method: "receberItens", fallback: true });
      return result;
    },
    excluir: async (compraId) => {
      const r = await postLocalAuth<{ compra_id: string }>(
        "/api/compras/excluir",
        { compra_id: compraId },
      );
      if (r) {
        reportDataSource({ source: "local-server", domain: "compras", method: "excluir", fallback: false });
        return;
      }
      await cloudAdapter.compras.excluir(compraId);
      reportDataSource({ source: "cloud", domain: "compras", method: "excluir", fallback: true });
    },
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
        // Etapa 9 — fallthrough para títulos a pagar.
        const rp = await postLocalJson<{
          local_uuid: string;
          idempotente: boolean;
          pagar_local_uuid: string;
          status: string;
        }>("/api/financeiro/pagar/baixar", {
          pagar_id: input.lancamento_id,
          valor: input.valor,
          forma_pagamento: input.forma_pagamento ?? null,
          data_pagamento_ms: Number.isFinite(dataMs) ? dataMs : Date.now(),
          observacao: input.observacao ?? null,
          client_uuid: input.client_uuid ?? null,
        });
        if (rp) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[LOCAL_PAYABLE_UI] baixa servidor local ok", rp);
          }
          reportDataSource({ source: "local-server", domain: "financeiro", method: "registrarPagamento", fallback: false });
          return {
            pagamento_id: rp.local_uuid,
            lancamento_id: rp.pagar_local_uuid,
            idempotente: rp.idempotente,
          };
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
        // Etapa 9 — fallthrough para títulos a pagar.
        const rp = await postLocalJson<{
          pagar_local_uuid: string;
          idempotente: boolean;
          status: string;
        }>("/api/financeiro/pagar/cancelar", {
          pagar_id: input.lancamento_id,
          motivo: input.motivo ?? null,
        });
        if (rp) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[LOCAL_PAYABLE_UI] cancelamento servidor local ok", rp);
          }
          reportDataSource({ source: "local-server", domain: "financeiro", method: "cancelarLancamento", fallback: false });
          return { lancamento_id: rp.pagar_local_uuid, idempotente: rp.idempotente };
        }
      }
      const out = await cloudAdapter.financeiro.cancelarLancamento(input);
      reportDataSource({ source: "cloud", domain: "financeiro", method: "cancelarLancamento", fallback: true });
      return out;
    },
  },

  // ------------------------------------------------------------------
  // ETAPA 13 — Dashboard offline-first no modo SERVIDOR.
  // Mesma lógica do local-terminal, mas falando com 127.0.0.1 via
  // `resolveBaseUrl`. Se algum endpoint local falhar, cai para a nuvem
  // sem montar um KPI parcial.
  // ------------------------------------------------------------------
  dashboard: {
    ...cloudAdapter.dashboard,
    carregar: () =>
      withCloudFallback(
        "dashboard",
        "carregar",
        async () => {
          const baseUrl = await resolveBaseUrl();
          if (!baseUrl) return null;
          const [vendas, compras, lancamentos, produtos, saldos] = await Promise.all([
            tryLocal<Array<Record<string, unknown>>>(
              "vendas_remote", "list", "/api/vendas/historico", { limit: "500" },
            ),
            tryLocal<Array<Record<string, unknown>>>(
              "compras", "list", "/api/compras", { limit: "500" },
            ),
            tryLocal<Array<Record<string, unknown>>>(
              "financeiro_lancamentos_completo",
              "listLancamentosCompleto",
              "/api/financeiro/lancamentos-completo",
            ),
            tryLocal<Array<Record<string, unknown>>>(
              "produtos", "list", "/api/produtos/list", { status: "ativo" },
            ),
            tryLocal<Array<{ produto_id: string; tipo: string; quantidade: number | string }>>(
              "estoque", "saldosLinhas", "/api/estoque/saldos",
            ),
          ]);
          const dash = buildDashboardFromRaw({
            vendas, compras, lancamentos, produtos, saldos,
          });
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[LOCAL_DASHBOARD] server carregar", {
              ok: dash != null,
              vendasMes: dash?.vendasMes,
              contasReceber: dash?.contasReceber,
              contasPagar: dash?.contasPagar,
              estoqueBaixo: dash?.estoqueBaixo,
            });
          }
          return dash;
        },
        () => cloudAdapter.dashboard.carregar(),
      ),
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

// ----------------------------------------------------------------------------
// Helpers para writes locais autenticados (Fase 1 v24 — produtos/categorias)
// ----------------------------------------------------------------------------

interface ProdutoMutLocal {
  produto_id: string;
  idempotente: boolean;
  outbox_status: "pending" | "sent";
  remote_id: string | null;
}

interface CategoriaMutLocal {
  categoria_id: string;
  idempotente: boolean;
  outbox_status: "pending" | "sent";
  remote_id: string | null;
}

/** Mapeia `{ campo: valor }` para `{ _campo: valor }` ignorando `undefined`. */
function toUnderscoredBody(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (v === undefined) continue;
    out[k.startsWith("_") ? k : `_${k}`] = v;
  }
  return out;
}

async function postLocalAuth<T>(path: string, body: unknown): Promise<T | null> {
  const baseUrl = await resolveBaseUrl();
  if (!baseUrl) return null;
  let token: string | null = null;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const { data } = await supabase.auth.getSession();
    token = data.session?.access_token ?? null;
  } catch { /* sem token → segue só com body */ }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? {}),
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
