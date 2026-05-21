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

// ---- Onda 3 — PR-O3-1: shape do mapContasReceber reproduzido localmente ----
// Mantém o mesmo contrato do `mapContasReceber` de cloud-relatorios.ts. O cache
// `financeiro_lancamentos_local` agora carrega cliente.id/nome_fantasia e
// venda.id/data_emissao (select expandido no Rust). Para entries antigos no
// cache (pré-expansão), caímos para os fields disponíveis para não quebrar.
function mapContasReceberLocal(l: Record<string, unknown>) {
  const cli = (l.cliente as Record<string, unknown> | null) ?? null;
  const ven = (l.venda as Record<string, unknown> | null) ?? null;
  const valor = Number(l.valor) || 0;
  const pago = Number(l.valor_pago) || 0;
  const clienteNome = cli
    ? ((cli.nome_fantasia as string) || (cli.nome as string) || null)
    : null;
  const vendaData =
    (ven?.data_emissao as string | undefined) ??
    (ven?.data_finalizacao as string | undefined) ??
    null;
  return {
    id: String(l.id),
    descricao: String(l.descricao ?? ""),
    valor,
    valor_pago: pago,
    data_emissao: (l.data_emissao as string) ?? null,
    data_vencimento: String(l.data_vencimento ?? ""),
    data_pagamento: (l.data_pagamento as string) ?? null,
    status: l.status as string,
    forma_pagamento: (l.forma_pagamento as string) ?? null,
    observacoes: (l.observacoes as string) ?? null,
    numero_documento: (l.numero_documento as string) ?? null,
    cliente_id: (l.cliente_id as string) ?? null,
    cliente_nome: clienteNome,
    cliente_documento: (cli?.documento as string) ?? null,
    cliente_telefone: (cli?.telefone as string) ?? null,
    cliente_celular: (cli?.celular as string) ?? null,
    cliente_email: (cli?.email as string) ?? null,
    venda_id: ((ven?.id as string) ?? (l.venda_id as string)) ?? null,
    venda_numero: (ven?.numero as string) ?? null,
    venda_data: vendaData,
    venda_total: ven ? Number(ven.total) || 0 : null,
    conciliado_em: (l.conciliado_em as string) ?? null,
  };
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
    fornecedorMetricas: () =>
      withCloudFallback(
        "compras",
        "fornecedorMetricas",
        async () => {
          const rows = await tryLocal<
            Array<{
              fornecedor_id: string;
              total_compras: number;
              valor_total: number;
              ultima_compra: string | null;
              compras_em_aberto: number;
            }>
          >("compras", "fornecedorMetricas", "/api/compras/fornecedor-metricas");
          if (!rows) return null;
          const map = new Map<
            string,
            import("../extra-types").FornecedorMetricaDomain
          >();
          for (const r of rows) {
            map.set(r.fornecedor_id, {
              fornecedor_id: r.fornecedor_id,
              total_compras: Number(r.total_compras ?? 0),
              valor_total: Number(r.valor_total ?? 0),
              ultima_compra: r.ultima_compra ?? null,
              compras_em_aberto: Number(r.compras_em_aberto ?? 0),
            });
          }
          return map;
        },
        () => cloudAdapter.compras.fornecedorMetricas(),
      ),
  },

  // -----------------------------------------------------------------
  // Etapa 22 — Vendas / PDV offline-first (camada 6 do plano global).
  // O PDV grava em `vendas_local` + `vendas_local_itens` + estoque local
  // + caixa local + outbox (vendas/cancelamentos) no Rust. Online a
  // outbox empurra para a RPC `finalizar_venda_pdv`. Offline, fica
  // pendente sem travar o caixa. Cloud é apenas fallback de catástrofe
  // (servidor local caiu de vez).
  // -----------------------------------------------------------------
  vendas: {
    ...cloudAdapter.vendas,
    list: (input) =>
      withCloudFallback(
        "vendas",
        "list",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["vendas"]["list"]>>>(
            "vendas",
            "list",
            "/api/vendas/historico",
            { limit: input?.limit != null ? String(input.limit) : undefined },
          ),
        () => cloudAdapter.vendas.list(input),
      ),
    metricasPeriodo: (input) =>
      withCloudFallback(
        "vendas",
        "metricasPeriodo",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["vendas"]["metricasPeriodo"]>>>(
            "vendas",
            "metricasPeriodo",
            "/api/vendas/metricas-periodo",
            { inicio: input.data_inicio, fim: input.data_fim },
          ),
        () => cloudAdapter.vendas.metricasPeriodo(input),
      ),
    finalizar: async (input) => {
      const online = typeof navigator === "undefined" ? true : navigator.onLine;
      const baseUrl = await resolveBaseUrl();
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[PDV_FINALIZAR] iniciado", {
          modo: baseUrl ? "local-server" : "cloud",
          online,
          itens: input.itens?.length ?? 0,
          total: input.total,
        });
      }
      if (baseUrl) {
        if (import.meta.env.DEV) console.log("[PDV_FINALIZAR_LOCAL] gravando SQLite");
        const local = await postLocalAuthDetail<{
          venda_id: string;
          idempotente: boolean;
          outbox_status: "pending" | "sending" | "sent" | "error";
          remote_id: string | null;
        }>("/api/vendas/registrar", {
          cliente_id: input.cliente_id,
          subtotal: input.subtotal,
          desconto: input.desconto,
          total: input.total,
          forma_pagamento: input.forma_pagamento,
          status_pagamento: input.status_pagamento,
          valor_recebido: input.valor_recebido,
          troco: input.troco,
          observacao: input.observacao,
          itens: input.itens as unknown[],
          pagamentos: (input.pagamentos ?? []) as unknown[],
          gerar_financeiro: input.gerar_financeiro ?? true,
          operador_id: input.operador_id ?? null,
          terminal_id: input.terminal_id ?? null,
          client_uuid: input.client_uuid ?? null,
        }, 15_000);
        if (local.ok) {
          reportDataSource({ source: "local-server", domain: "vendas", method: "finalizar", fallback: false });
          if (import.meta.env.DEV) {
            console.log("[PDV_FINALIZAR_LOCAL] estoque baixado / caixa vinculado", local.data);
            console.log("[PDV_FINALIZAR_OUTBOX]", { status: local.data.outbox_status });
            console.log("[PDV_FINALIZAR_OK] venda finalizada", {
              modo: "local-server",
              venda_id: local.data.venda_id,
            });
          }
          return local.data.remote_id ?? local.data.venda_id;
        }
        if (local.reason === "http_error") {
          if (import.meta.env.DEV) console.warn("[PDV_FINALIZAR_ERRO] servidor local rejeitou", local);
          throw new Error(local.error);
        }
        if (!online) {
          if (import.meta.env.DEV) console.warn("[PDV_FINALIZAR_ERRO] offline e servidor local indisponível");
          throw new Error("Sem conexão com o servidor local. Verifique se o servidor está em execução para finalizar a venda.");
        }
      } else if (!online) {
        if (import.meta.env.DEV) console.warn("[PDV_FINALIZAR_ERRO] offline sem servidor local");
        throw new Error("Sem conexão com a internet e sem servidor local. Não foi possível finalizar a venda.");
      }
      if (import.meta.env.DEV) console.log("[PDV_FINALIZAR] fallback cloud");
      const result = await cloudAdapter.vendas.finalizar(input);
      reportDataSource({ source: "cloud", domain: "vendas", method: "finalizar", fallback: true });
      if (import.meta.env.DEV) console.log("[PDV_FINALIZAR_OK] venda finalizada", { modo: "cloud", venda_id: result });
      return result;
    },
    cancelar: async (input) => {
      const r = await postLocalAuth<{
        venda_local_uuid: string;
        idempotente: boolean;
        qtd_itens_estornados: number;
        qtd_total_estornada: number;
        outbox_status: "pending" | "sending" | "sent" | "error";
      }>("/api/vendas/cancelar", {
        venda_local_uuid: input.venda_id,
        motivo: input.motivo ?? null,
        client_uuid: input.venda_id,
      });
      if (r) {
        reportDataSource({ source: "local-server", domain: "vendas", method: "cancelar", fallback: false });
        if (r.outbox_status === "sent") {
          try {
            return await cloudAdapter.vendas.cancelar(input);
          } catch {
            /* segue resumo mínimo local */
          }
        }
        return {
          venda_id: input.venda_id,
          numero: "",
          total: r.qtd_total_estornada,
          motivo: input.motivo ?? null,
          cancelado_em: new Date().toISOString(),
          qtd_itens_estornados: r.qtd_itens_estornados,
          qtd_total_estornada: r.qtd_total_estornada,
          itens_estornados: [],
          qtd_lancamentos_cancelados: 0,
          total_lancamentos_cancelados: 0,
          lancamentos_cancelados: [],
        };
      }
      const result = await cloudAdapter.vendas.cancelar(input);
      reportDataSource({ source: "cloud", domain: "vendas", method: "cancelar", fallback: true });
      return result;
    },
  },

  // -----------------------------------------------------------------
  // Etapa 22 — Caixa offline-first (abre/sangria/suprimento/fechamento)
  // contra `caixa_local` + outbox no Rust. Mesma estratégia das vendas.
  // -----------------------------------------------------------------
  caixa: {
    ...cloudAdapter.caixa,
    // ------------------------------------------------------------------
    // Etapa 2 — Estado do caixa local. Lê SQLite primeiro (caixa_local).
    // Se o servidor local estiver ativo, NUNCA consultamos cloud aqui —
    // isso garante que o PDV, ao reabrir, restaura o caixa offline mesmo
    // sem internet. Quando o servidor local responde "sem caixa aberto",
    // cai para cloud somente se houver conexão.
    // ------------------------------------------------------------------
    aberto: async (filtro) => {
      const baseUrl = await resolveBaseUrl();
      if (baseUrl) {
        const operadorId = filtro?.qualquer ? null : filtro?.operador_id ?? null;
        type LocalRow = {
          local_uuid: string;
          remote_id: string | null;
          client_uuid: string | null;
          status: string;
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
        };
        const row = await tryLocal<LocalRow | null>(
          "caixa",
          "aberto",
          "/api/caixa/aberto",
          {
            operador_id: operadorId ?? undefined,
            terminal_id: readSelectedTerminalId() ?? undefined,
          },
        );
        if (row && row.status === "aberto") {
          const isoAb = new Date(row.data_abertura_ms).toISOString();
          const isoFc = row.data_fechamento_ms
            ? new Date(row.data_fechamento_ms).toISOString()
            : null;
          // Mapeia para CaixaDomain. Totais por forma de pagamento ficam
          // em 0 aqui — a UI carrega os números reais via `caixa.resumo`
          // (que consulta vendas/movimentos do caixa). Esse é o mesmo
          // contrato do cloud adapter quando o caixa acabou de abrir.
          const mapped = {
            id: row.remote_id ?? row.local_uuid,
            owner_id: "",
            usuario_id: "",
            operador_id: row.operador_id,
            data_abertura: isoAb,
            data_fechamento: isoFc,
            valor_inicial: row.valor_inicial,
            total_vendas: 0,
            qtd_vendas: 0,
            total_dinheiro: 0,
            total_pix: 0,
            total_debito: 0,
            total_credito: 0,
            total_boleto: 0,
            total_ifood: 0,
            total_fiado: 0,
            total_outros: 0,
            total_sangrias: row.total_sangrias ?? 0,
            total_suprimentos: row.total_suprimentos ?? 0,
            valor_esperado: row.valor_esperado,
            valor_informado: row.valor_informado,
            diferenca: row.diferenca,
            status: "aberto" as const,
            observacao: row.observacao_abertura,
            observacao_fechamento: row.observacao_fechamento,
            created_at: isoAb,
            updated_at: isoAb,
          };
          return mapped as unknown as Awaited<ReturnType<typeof cloudAdapter.caixa.aberto>>;
        }
        // Sem caixa local aberto. Se estamos offline, devolve null —
        // a tela mostra "abrir caixa". Não tentamos cloud, evita
        // hang em redes lentas.
        const online = typeof navigator === "undefined" ? true : navigator.onLine;
        if (!online) return null;
      }
      // Sem servidor local OU online sem caixa local → consulta cloud.
      return cloudAdapter.caixa.aberto(filtro);
    },
    abrir: async (input) => {
      const t0 = performance.now();
      // Idempotência: gera um client_uuid estável por (operador, terminal)
      // e mantém em sessionStorage até a abertura ser confirmada. Assim,
      // se a UI re-tentar (clique duplo, retry após timeout de rede), o
      // servidor local reconhece o mesmo pedido e NUNCA duplica o caixa.
      const ssKey = `gp.caixa.abrir.cu:${input.operador_id ?? "admin"}:${input.terminal_id ?? "no-term"}`;
      const inputCU = (input as typeof input & { client_uuid?: string | null }).client_uuid ?? null;
      let clientUuid = inputCU;
      if (!clientUuid) {
        try {
          clientUuid = sessionStorage.getItem(ssKey);
        } catch { /* ignore */ }
      }
      if (!clientUuid) {
        clientUuid =
          typeof crypto !== "undefined" && "randomUUID" in crypto
            ? crypto.randomUUID()
            : `cu-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try { sessionStorage.setItem(ssKey, clientUuid); } catch { /* ignore */ }
      }

      console.info("[CAIXA_LOCAL] abertura iniciada", {
        valor_inicial: input.valor_inicial,
        operador_id: input.operador_id ?? null,
        terminal_id: input.terminal_id ?? null,
        client_uuid: clientUuid,
      });
      const baseUrl = await resolveBaseUrl();
      const localAvailable = !!baseUrl;
      console.info("[CAIXA_LOCAL] adapter resolvido", {
        modo: localAvailable ? "local" : "cloud-fallback",
        baseUrl,
      });
      // 5s é mais do que suficiente — a operação é puro SQLite local;
      // o push para o cloud já roda em background no Rust.
      const r = await postLocalAuth<{
        caixa_id: string;
        idempotente: boolean;
        outbox_status: "pending" | "sending" | "sent" | "error";
        remote_id: string | null;
      }>("/api/caixa/abrir", {
        valor_inicial: input.valor_inicial,
        observacao: input.observacao ?? null,
        operador_id: input.operador_id ?? null,
        terminal_id: input.terminal_id ?? null,
        client_uuid: clientUuid,
      }, 5000);
      const dt = Math.round(performance.now() - t0);
      if (r) {
        console.info("[CAIXA_LOCAL] persistido SQLite", {
          caixa_id: r.caixa_id,
          idempotente: r.idempotente,
          outbox_status: r.outbox_status,
          duracao_ms: dt,
        });
        reportDataSource({ source: "local-server", domain: "caixa", method: "abrir", fallback: false });
        // Limpa a chave de idempotência — próxima abertura é um novo evento.
        try { sessionStorage.removeItem(ssKey); } catch { /* ignore */ }
        return r.remote_id ?? r.caixa_id;
      }
      // Se o servidor local estava disponível mas a chamada falhou,
      // NÃO tentamos cloud — preserva o modo offline real e evita o
      // travamento "Abrindo..." enquanto a cloud também pendura.
      // O client_uuid permanece em sessionStorage para que um retry
      // manual seja idempotente (não cria caixa duplicado).
      if (localAvailable) {
        console.error("[CAIXA_LOCAL] servidor local respondeu erro/timeout", { duracao_ms: dt });
        throw new Error(
          "Não foi possível abrir o caixa no servidor local. Verifique os logs do servidor e tente novamente.",
        );
      }
      console.warn("[CAIXA_TIMEOUT] servidor local indisponível — tentando cloud");
      const result = await cloudAdapter.caixa.abrir(input);
      reportDataSource({ source: "cloud", domain: "caixa", method: "abrir", fallback: true });
      try { sessionStorage.removeItem(ssKey); } catch { /* ignore */ }
      return result;
    },
    registrarMovimento: async (input) => {
      console.info("[CAIXA_LOCAL] movimento local iniciado", { tipo: input.tipo });
      const r = await postLocalAuth<{
        movimento_id: string;
        idempotente: boolean;
        outbox_status: "pending" | "sending" | "sent" | "error";
        remote_id: string | null;
      }>("/api/caixa/movimento", {
        caixa_id: input.caixa_id,
        tipo: input.tipo,
        valor: input.valor,
        motivo: input.motivo ?? null,
        client_uuid: input.client_uuid ?? null,
      });
      if (r) {
        console.info("[CAIXA_LOCAL] persistido SQLite", { movimento_id: r.movimento_id });
        if (r.outbox_status === "pending" || r.outbox_status === "sending") {
          console.info("[CAIXA_OUTBOX] item criado", { movimento_id: r.movimento_id });
        }
        reportDataSource({ source: "local-server", domain: "caixa", method: "registrarMovimento", fallback: false });
        return r.remote_id ?? r.movimento_id;
      }
      console.warn("[CAIXA_TIMEOUT] fallback local acionado (movimento)");
      const result = await cloudAdapter.caixa.registrarMovimento(input);
      reportDataSource({ source: "cloud", domain: "caixa", method: "registrarMovimento", fallback: true });
      return result;
    },
    fechar: async (input) => {
      const online = typeof navigator === "undefined" ? true : navigator.onLine;
      const baseUrl = await resolveBaseUrl();
      if (import.meta.env.DEV) {
        console.info("[CAIXA_FECHAR] iniciado", {
          modo: baseUrl ? "local-server" : "cloud",
          online,
        });
      }
      if (baseUrl) {
        if (import.meta.env.DEV) console.info("[CAIXA_FECHAR_LOCAL] gravando SQLite");
        const r = await postLocalAuth<{
          fechamento_id: string;
          idempotente: boolean;
          valor_informado: number;
          outbox_status: "pending" | "sending" | "sent" | "error";
          remote_id: string | null;
        }>("/api/caixa/fechar", {
          caixa_id: input.caixa_id,
          valor_informado: input.valor_informado,
          observacao: input.observacao ?? null,
          client_uuid:
            (input as typeof input & { client_uuid?: string | null })
              .client_uuid ?? null,
        });
        if (r) {
          if (import.meta.env.DEV) {
            console.info("[CAIXA_FECHAR_LOCAL] auditoria criada", { fechamento_id: r.fechamento_id });
            if (r.outbox_status === "pending" || r.outbox_status === "sending") {
              console.info("[CAIXA_FECHAR_OUTBOX] criado");
            }
            console.info("[CAIXA_FECHAR_OK] fechado offline", { online });
          }
          reportDataSource({ source: "local-server", domain: "caixa", method: "fechar", fallback: false });
          // Só consulta cloud quando online e já sincronizado — nunca trava o fechamento offline.
          if (online && r.outbox_status === "sent" && r.remote_id) {
            try {
              return await cloudAdapter.caixa.fechar(input);
            } catch {
              /* cai no resumo mínimo abaixo */
            }
          }
          return {
            caixa_id: r.remote_id ?? input.caixa_id,
            valor_esperado: input.valor_informado,
            valor_informado: r.valor_informado,
            diferenca: 0,
            fechado_em: new Date().toISOString(),
          };
        }
        if (!online) {
          if (import.meta.env.DEV) console.warn("[CAIXA_FECHAR_ERRO] offline e servidor local indisponível");
          throw new Error("Sem conexão com o servidor local. Verifique se o servidor está em execução para fechar o caixa.");
        }
      } else if (!online) {
        if (import.meta.env.DEV) console.warn("[CAIXA_FECHAR_ERRO] offline sem servidor local");
        throw new Error("Sem conexão com a internet e sem servidor local. Não foi possível fechar o caixa.");
      }
      if (import.meta.env.DEV) console.info("[CAIXA_FECHAR] fallback cloud");
      const result = await cloudAdapter.caixa.fechar(input);
      reportDataSource({ source: "cloud", domain: "caixa", method: "fechar", fallback: true });
      return result;
    },
  },





  // -----------------------------------------------------------------
  // Sub-etapa 8.1 — Clientes a Receber / Fiado offline-first
  // (servidor local = esta máquina). Mesma estratégia do local-terminal.
  // -----------------------------------------------------------------
  financeiro: {
    ...cloudAdapter.financeiro,
    // Onda 2 — item 10: lê FKs do lançamento do cache local
    // (financeiro_lancamentos_local). Mantém o mesmo retorno do cloud
    // adapter; cai em cloud quando o id não está no cache local.
    lancamentoFks: async (lancamentoId) =>
      withCloudFallback(
        "financeiro",
        "lancamentoFks",
        () =>
          tryLocal<Awaited<ReturnType<typeof cloudAdapter.financeiro.lancamentoFks>>>(
            "financeiro",
            "lancamentoFks",
            "/api/financeiro/lancamento-fks",
            { lancamento_id: lancamentoId },
          ),
        () => cloudAdapter.financeiro.lancamentoFks(lancamentoId),
      ),
    // Onda 2 — item 6: agregação de fluxo por forma direto do SQLite
    // (venda_pagamentos_local + vendas_local). Cai em cloud se o servidor
    // local responder erro/null.
    fluxoPorForma: async ({ inicio, fim }) =>
      withCloudFallback(
        "financeiro",
        "fluxoPorForma",
        () =>
          tryLocal<Awaited<ReturnType<typeof cloudAdapter.financeiro.fluxoPorForma>>>(
            "financeiro",
            "fluxoPorForma",
            "/api/financeiro/fluxo-por-forma",
            { inicio, fim },
          ),
        () => cloudAdapter.financeiro.fluxoPorForma({ inicio, fim }),
      ),
    // Onda 2 — item 7: movimentos de caixa do período direto do SQLite
    // (caixa_movs_local JOIN caixa_local). Fallback cloud automático.
    movimentosCaixaPeriodo: async ({ inicio, fim }) =>
      withCloudFallback(
        "financeiro",
        "movimentosCaixaPeriodo",
        () =>
          tryLocal<Awaited<ReturnType<typeof cloudAdapter.financeiro.movimentosCaixaPeriodo>>>(
            "financeiro",
            "movimentosCaixaPeriodo",
            "/api/financeiro/movimentos-caixa",
            { inicio, fim },
          ),
        () => cloudAdapter.financeiro.movimentosCaixaPeriodo({ inicio, fim }),
      ),
    // Onda 2 — item 8: avulsos pagos lidos do cache local
    // (financeiro_lancamentos_local via JSON1). Fallback cloud automático.
    lancamentosAvulsosPagos: async ({ inicio, fim }) =>
      withCloudFallback(
        "financeiro",
        "lancamentosAvulsosPagos",
        () =>
          tryLocal<Awaited<ReturnType<typeof cloudAdapter.financeiro.lancamentosAvulsosPagos>>>(
            "financeiro",
            "lancamentosAvulsosPagos",
            "/api/financeiro/avulsos-pagos",
            { inicio, fim },
          ),
        () => cloudAdapter.financeiro.lancamentosAvulsosPagos({ inicio, fim }),
      ),
    // Onda 2 — item 2: posição financeira agregada do cache local.
    posicaoPeriodo: async (periodo) =>
      withCloudFallback(
        "financeiro",
        "posicaoPeriodo",
        () =>
          tryLocal<Awaited<ReturnType<typeof cloudAdapter.financeiro.posicaoPeriodo>>>(
            "financeiro",
            "posicaoPeriodo",
            "/api/financeiro/posicao-periodo",
            { inicio: periodo.inicio, fim: periodo.fim },
          ),
        () => cloudAdapter.financeiro.posicaoPeriodo(periodo),
      ),
    // Onda 2 — item 1: indicadoresMes agregado dos caches locais
    // (vendas + venda_itens + financeiro_lancamentos). Envia `hoje` no
    // fuso local para casar com a noção de "recebido hoje"/"vencidos" do cloud.
    indicadoresMes: async () =>
      withCloudFallback(
        "financeiro",
        "indicadoresMes",
        () =>
          tryLocal<Awaited<ReturnType<typeof cloudAdapter.financeiro.indicadoresMes>>>(
            "financeiro",
            "indicadoresMes",
            "/api/financeiro/indicadores-mes",
            { hoje: new Date().toISOString().slice(0, 10) },
          ),
        () => cloudAdapter.financeiro.indicadoresMes(),
      ),
    // Onda 2 — item 11: listIfoodPendentes lido direto do cache
    // `financeiro_lancamentos_local` (cliente.nome já embutido via PostgREST).
    listIfoodPendentes: async () =>
      withCloudFallback(
        "financeiro",
        "listIfoodPendentes",
        () =>
          tryLocal<Awaited<ReturnType<typeof cloudAdapter.financeiro.listIfoodPendentes>>>(
            "financeiro",
            "listIfoodPendentes",
            "/api/financeiro/ifood-pendentes",
            { limit: "500" },
          ),
        () => cloudAdapter.financeiro.listIfoodPendentes(),
      ),
    // Onda 2 — item 9 (PR-F0): pagamentosPorLancamento via cache
    // `pagamentos_local`. O handler tenta upstream primeiro (refresh
    // autoritativo) e cai para o cache local quando offline.
    pagamentosPorLancamento: async (lancamentoId: string) =>
      withCloudFallback(
        "financeiro",
        "pagamentosPorLancamento",
        () =>
          tryLocal<Awaited<ReturnType<typeof cloudAdapter.financeiro.pagamentosPorLancamento>>>(
            "financeiro",
            "pagamentosPorLancamento",
            "/api/financeiro/pagamentos",
            { lancamento_id: lancamentoId },
          ),
        () => cloudAdapter.financeiro.pagamentosPorLancamento(lancamentoId),
      ),
    // Onda 2 — item 3: performancePeriodo agregado dos caches locais
    // `vendas_remote_cache` + `venda_itens_remote_cache` (este último já
    // traz `produto.preco_custo` embutido via PostgREST).
    performancePeriodo: async (periodo) =>
      withCloudFallback(
        "financeiro",
        "performancePeriodo",
        () =>
          tryLocal<Awaited<ReturnType<typeof cloudAdapter.financeiro.performancePeriodo>>>(
            "financeiro",
            "performancePeriodo",
            "/api/financeiro/performance-periodo",
            { inicio: periodo.inicio, fim: periodo.fim },
          ),
        () => cloudAdapter.financeiro.performancePeriodo(periodo),
      ),
    // Onda 2 — item 4: receberOrigem agregado direto do cache local.
    // Passa `hoje` (data local do cliente) para alinhar a noção de
    // "vencidos hoje" com o fuso do usuário.
    receberOrigem: async (input) =>
      withCloudFallback(
        "financeiro",
        "receberOrigem",
        () =>
          tryLocal<Awaited<ReturnType<typeof cloudAdapter.financeiro.receberOrigem>>>(
            "financeiro",
            "receberOrigem",
            "/api/financeiro/receber-origem",
            {
              inicio: input.periodo.inicio,
              fim: input.periodo.fim,
              forma: input.forma ?? "todos",
              hoje: new Date().toISOString().slice(0, 10),
            },
          ),
        () => cloudAdapter.financeiro.receberOrigem(input),
      ),
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
  // Etapa 23 — Relatórios offline-first no modo SERVIDOR (polimento
  // pós-camada 6). Mesmo conjunto que o local-terminal já cobria, agora
  // disponível quando a MÁQUINA-SERVIDOR consulta seus próprios SQLite.
  // Cloud só como fallback.
  // ------------------------------------------------------------------
  relatorios: {
    ...cloudAdapter.relatorios,
    fluxoCaixa: ({ inicio, fim }) =>
      withCloudFallback(
        "relatorios", "fluxoCaixa",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "financeiro_lancamentos_completo", "listLancamentosCompleto",
            "/api/financeiro/lancamentos-completo",
          );
          if (!Array.isArray(raw)) return null;
          return raw
            .filter((l) => {
              const dv = l.data_vencimento as string | null;
              return dv != null && dv >= inicio && dv <= fim;
            })
            .sort((a, b) => String(b.data_vencimento).localeCompare(String(a.data_vencimento)))
            .slice(0, 1000)
            .map((l) => ({
              id: String(l.id),
              descricao: (l.descricao as string) ?? null,
              tipo: String(l.tipo ?? ""),
              valor: Number(l.valor) || 0,
              valor_pago: Number(l.valor_pago) || 0,
              emissao: (l.data_emissao as string) ?? "",
              vencimento: (l.data_vencimento as string) ?? "",
              pagamento: (l.data_pagamento as string) ?? null,
              status: String(l.status ?? ""),
              forma: (l.forma_pagamento as string) ?? null,
            }));
        },
        () => cloudAdapter.relatorios.fluxoCaixa({ inicio, fim }),
      ),
    compras: ({ inicio, fim }) =>
      withCloudFallback(
        "relatorios", "compras",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "compras", "list", "/api/compras", { limit: "500" },
          );
          if (!Array.isArray(raw)) return null;
          return raw
            .filter((c) => {
              const d = c.data_emissao as string;
              return d >= inicio && d <= fim;
            })
            .map((c) => ({
              id: String(c.id),
              numero: String(c.numero ?? ""),
              data: String(c.data_emissao ?? ""),
              fornecedor: (c.fornecedor as { razao_social?: string } | null)?.razao_social ?? "—",
              total: Number(c.total) || 0,
              status: String(c.status ?? ""),
            }));
        },
        () => cloudAdapter.relatorios.compras({ inicio, fim }),
      ),
    cardVendas: () =>
      withCloudFallback(
        "relatorios", "cardVendas",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "vendas_remote", "list", "/api/vendas/historico", { limit: "1000" },
          );
          if (!Array.isArray(raw)) return null;
          return raw.map((v) => ({
            numero: String(v.numero ?? ""),
            data: String(v.data_emissao ?? ""),
            cliente: (v.cliente as { nome?: string } | null)?.nome ?? "Consumidor",
            forma: (v.forma_pagamento as string) ?? "",
            total: Number(v.total) || 0,
            status: String(v.status ?? ""),
            pagamento: String(v.status_pagamento ?? ""),
          }));
        },
        () => cloudAdapter.relatorios.cardVendas(),
      ),
    cardCompras: () =>
      withCloudFallback(
        "relatorios", "cardCompras",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "compras", "list", "/api/compras", { limit: "1000" },
          );
          if (!Array.isArray(raw)) return null;
          return raw.map((c) => ({
            numero: String(c.numero ?? ""),
            data: String(c.data_emissao ?? ""),
            fornecedor: (c.fornecedor as { razao_social?: string } | null)?.razao_social ?? "—",
            total: Number(c.total) || 0,
            status: String(c.status ?? ""),
          }));
        },
        () => cloudAdapter.relatorios.cardCompras(),
      ),
    notasFiscais: ({ inicio, fim }) =>
      withCloudFallback(
        "relatorios", "notasFiscais",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "vendas_remote", "list", "/api/vendas/historico", { limit: "1000" },
          );
          if (!Array.isArray(raw)) return null;
          return raw
            .filter((v) => {
              if (v.numero_nf == null) return false;
              const d = v.data_emissao as string;
              return d >= inicio && d <= fim;
            })
            .map((v) => ({
              id: String(v.id),
              numero: String(v.numero ?? ""),
              nf: String(v.numero_nf ?? ""),
              serie: (v.serie_nf as string) ?? "",
              data: String(v.data_emissao ?? ""),
              total: Number(v.total) || 0,
              status: String(v.status ?? ""),
            }));
        },
        () => cloudAdapter.relatorios.notasFiscais({ inicio, fim }),
      ),
    cardNotasFiscais: () =>
      withCloudFallback(
        "relatorios", "cardNotasFiscais",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "vendas_remote", "list", "/api/vendas/historico", { limit: "1000" },
          );
          if (!Array.isArray(raw)) return null;
          return raw
            .filter((v) => v.numero_nf != null)
            .map((v) => ({
              venda: String(v.numero ?? ""),
              nf: String(v.numero_nf ?? ""),
              serie: (v.serie_nf as string) ?? "",
              data: String(v.data_emissao ?? ""),
              total: Number(v.total) || 0,
              status: String(v.status ?? ""),
            }));
        },
        () => cloudAdapter.relatorios.cardNotasFiscais(),
      ),
    cardCaixas: () =>
      withCloudFallback(
        "relatorios", "cardCaixas",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "caixas_remote", "list", "/api/relatorios/caixas", { limit: "1000" },
          );
          if (!Array.isArray(raw)) return null;
          return raw.map((c) => ({
            abertura: String(c.data_abertura ?? ""),
            fechamento: (c.data_fechamento as string) ?? null,
            inicial: Number(c.valor_inicial) || 0,
            vendas: Number(c.total_vendas) || 0,
            sangrias: Number(c.total_sangrias) || 0,
            suprimentos: Number(c.total_suprimentos) || 0,
            esperado: c.valor_esperado != null ? Number(c.valor_esperado) : null,
            informado: c.valor_informado != null ? Number(c.valor_informado) : null,
            diferenca: c.diferenca != null ? Number(c.diferenca) : null,
            status: String(c.status ?? ""),
          }));
        },
        () => cloudAdapter.relatorios.cardCaixas(),
      ),
    caixasSessoes: ({ iniIso, fimIso, operadorId, terminalId, status }) =>
      withCloudFallback(
        "relatorios", "caixasSessoes",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "caixas_remote", "list", "/api/relatorios/caixas", { limit: "1000" },
          );
          if (!Array.isArray(raw)) return null;
          const num = (v: unknown) => Number(v) || 0;
          return raw
            .filter((c) => {
              const da = String(c.data_abertura ?? "");
              if (da < iniIso || da > fimIso) return false;
              if (operadorId && operadorId !== "todos" && c.operador_id !== operadorId) return false;
              if (terminalId && terminalId !== "todos" && c.terminal_id !== terminalId) return false;
              if (status === "aberto" && c.status !== "aberto") return false;
              if (status === "fechado" && c.status !== "fechado") return false;
              return true;
            })
            .map((c) => ({
              id: String(c.id),
              operador_id: (c.operador_id as string) ?? null,
              terminal_id: (c.terminal_id as string) ?? null,
              data_abertura: String(c.data_abertura ?? ""),
              data_fechamento: (c.data_fechamento as string) ?? null,
              valor_inicial: num(c.valor_inicial),
              total_vendas: num(c.total_vendas),
              total_sangrias: num(c.total_sangrias),
              total_suprimentos: num(c.total_suprimentos),
              total_dinheiro: num(c.total_dinheiro),
              total_pix: num(c.total_pix),
              total_debito: num(c.total_debito),
              total_credito: num(c.total_credito),
              total_boleto: num(c.total_boleto),
              total_ifood: num(c.total_ifood),
              total_fiado: num(c.total_fiado),
              total_outros: num(c.total_outros),
              valor_esperado: c.valor_esperado != null ? num(c.valor_esperado) : null,
              valor_informado: c.valor_informado != null ? num(c.valor_informado) : null,
              diferenca: c.diferenca != null ? num(c.diferenca) : null,
              status: c.status as "aberto" | "fechado",
              observacao: (c.observacao as string) ?? null,
              observacao_fechamento: (c.observacao_fechamento as string) ?? null,
              qtd_vendas: num(c.qtd_vendas),
            }));
        },
        () => cloudAdapter.relatorios.caixasSessoes({ iniIso, fimIso, operadorId, terminalId, status }),
      ),
    caixaMovimentos: (caixaId) =>
      withCloudFallback(
        "relatorios", "caixaMovimentos",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "caixa_movimentos_remote", "list", "/api/relatorios/caixa-movimentos", { caixa_id: caixaId },
          );
          if (!Array.isArray(raw)) return null;
          return raw.map((m) => ({
            id: String(m.id),
            caixa_id: String(m.caixa_id ?? ""),
            tipo: String(m.tipo ?? ""),
            valor: Number(m.valor) || 0,
            motivo: (m.motivo as string) ?? null,
            created_at: String(m.created_at ?? ""),
          }));
        },
        () => cloudAdapter.relatorios.caixaMovimentos(caixaId),
      ),
    funcionariosAtivos: () =>
      withCloudFallback(
        "relatorios", "funcionariosAtivos",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "funcionarios_remote", "list", "/api/relatorios/funcionarios-ativos",
          );
          if (!Array.isArray(raw)) return null;
          return raw.map((f) => ({ id: String(f.id), nome: String(f.nome ?? "") }));
        },
        () => cloudAdapter.relatorios.funcionariosAtivos(),
      ),
    terminaisAtivos: () =>
      withCloudFallback(
        "relatorios", "terminaisAtivos",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "terminais_remote", "list", "/api/relatorios/terminais-ativos",
          );
          if (!Array.isArray(raw)) return null;
          return raw.map((t) => ({ id: String(t.id), nome: String(t.nome ?? "") }));
        },
        () => cloudAdapter.relatorios.terminaisAtivos(),
      ),
    pagamentosEmpresa: () =>
      withCloudFallback(
        "relatorios", "pagamentosEmpresa",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "pagamentos_empresa_remote", "list", "/api/relatorios/pagamentos-empresa", { limit: "200" },
          );
          if (!Array.isArray(raw)) return null;
          return raw as unknown as Awaited<ReturnType<typeof cloudAdapter.relatorios.pagamentosEmpresa>>;
        },
        () => cloudAdapter.relatorios.pagamentosEmpresa(),
      ),
    produtosVendidosPeriodo: ({ inicio, fim }) =>
      withCloudFallback(
        "relatorios", "produtosVendidosPeriodo",
        async () => {
          if (import.meta.env.DEV) {
            console.log("[PRODUTOS_VENDIDOS] local-server query", { inicio, fim });
          }
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "venda_itens_remote", "list", "/api/relatorios/venda-itens", { inicio, fim },
          );
          if (!Array.isArray(raw)) return null;
          const mapped = raw
            .map((it) => {
              const v = (it.__venda as Record<string, unknown>) ?? {};
              const produto = (it.produto as Record<string, unknown> | null) ?? null;
              const cliente = (v.cliente as { nome?: string } | null) ?? null;
              return {
                itemId: String(it.id),
                vendaId: String(v.id ?? it.venda_id ?? ""),
                vendaNumero: String(v.numero ?? ""),
                dataEmissao: String(v.data_emissao ?? ""),
                vendaStatus: String(v.status ?? ""),
                vendaStatusPagamento: String(v.status_pagamento ?? ""),
                formaPagamento: (v.forma_pagamento as string) ?? "",
                clienteId: (v.cliente_id as string) ?? null,
                clienteNome: cliente?.nome ?? null,
                operadorId: (v.operador_id as string) ?? null,
                caixaId: (v.caixa_id as string) ?? null,
                produtoId: (it.produto_id as string) ?? null,
                produtoNome: (produto?.nome as string) ?? (it.descricao as string) ?? "—",
                produtoSku: (produto?.sku as string) ?? "",
                categoriaId: (produto?.categoria_id as string) ?? null,
                precoCusto: Number(produto?.preco_custo) || 0,
                quantidade: Number(it.quantidade) || 0,
                precoUnitario: Number(it.preco_unitario) || 0,
                total: Number(it.total) || 0,
              };
            })
            .filter((r) => {
              // Filtro por período (defensivo) — se backend local ignorar inicio/fim.
              if (r.dataEmissao && (r.dataEmissao < inicio || r.dataEmissao > fim)) return false;
              // Status aceitos: tudo menos cancelada/rascunho.
              if (r.vendaStatus === "cancelada" || r.vendaStatus === "rascunho") return false;
              return true;
            });
          if (import.meta.env.DEV) {
            console.log("[PRODUTOS_VENDIDOS] local-server result", {
              itens: mapped.length,
              origem: "local",
            });
          }
          return mapped;
        },
        () => cloudAdapter.relatorios.produtosVendidosPeriodo({ inicio, fim }),
      ),
    cardFluxoCaixa: () =>
      withCloudFallback(
        "relatorios", "cardFluxoCaixa",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "financeiro_lancamentos_completo", "listLancamentosCompleto",
            "/api/financeiro/lancamentos-completo",
          );
          if (!Array.isArray(raw)) return null;
          return [...raw]
            .sort((a, b) => String(b.data_vencimento ?? "").localeCompare(String(a.data_vencimento ?? "")))
            .slice(0, 1000)
            .map((l) => ({
              id: String(l.id),
              descricao: (l.descricao as string) ?? null,
              tipo: String(l.tipo ?? ""),
              valor: Number(l.valor) || 0,
              valor_pago: Number(l.valor_pago) || 0,
              emissao: (l.data_emissao as string) ?? "",
              vencimento: (l.data_vencimento as string) ?? "",
              pagamento: (l.data_pagamento as string) ?? null,
              status: String(l.status ?? ""),
              forma: (l.forma_pagamento as string) ?? null,
            }));
        },
        () => cloudAdapter.relatorios.cardFluxoCaixa(),
      ),
    cardFinanceiro: () =>
      withCloudFallback(
        "relatorios", "cardFinanceiro",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "financeiro_lancamentos_completo", "listLancamentosCompleto",
            "/api/financeiro/lancamentos-completo",
          );
          if (!Array.isArray(raw)) return null;
          return raw
            .filter((l) => l.status !== "cancelado")
            .map((l) => {
              const cli = l.cliente as { id?: string; nome?: string } | null;
              const forn = l.fornecedor as { razao_social?: string; nome_fantasia?: string } | null;
              return {
                id: String(l.id),
                descricao: String(l.descricao ?? ""),
                tipo: l.tipo as "receita" | "despesa",
                valor: Number(l.valor) || 0,
                valor_pago: Number(l.valor_pago) || 0,
                data_emissao: String(l.data_emissao ?? ""),
                data_vencimento: String(l.data_vencimento ?? ""),
                data_pagamento: (l.data_pagamento as string) ?? null,
                status: l.status as "pago" | "pendente" | "atrasado" | "cancelado",
                forma_pagamento: (l.forma_pagamento as string) ?? null,
                categoria_id: (l.categoria_id as string) ?? null,
                categoria_nome: (l.categoria as { nome?: string } | null)?.nome ?? null,
                cliente_id: (l.cliente_id as string) ?? cli?.id ?? null,
                cliente_nome: cli?.nome ?? null,
                fornecedor_id: null,
                fornecedor_nome: forn?.nome_fantasia ?? forn?.razao_social ?? null,
              };
            });
        },
        () => cloudAdapter.relatorios.cardFinanceiro(),
      ),
    lancamentosFinanceiroPeriodo: ({ inicio, fim }) =>
      withCloudFallback(
        "relatorios", "lancamentosFinanceiroPeriodo",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "financeiro_lancamentos_completo", "listLancamentosCompleto",
            "/api/financeiro/lancamentos-completo",
          );
          if (!Array.isArray(raw)) return null;
          return raw
            .filter((l) => {
              if (l.status === "cancelado") return false;
              const dv = l.data_vencimento as string | null;
              return dv != null && dv >= inicio && dv <= fim;
            })
            .map((l) => {
              const cli = l.cliente as { id?: string; nome?: string } | null;
              const forn = l.fornecedor as { razao_social?: string; nome_fantasia?: string } | null;
              return {
                id: String(l.id),
                descricao: String(l.descricao ?? ""),
                tipo: l.tipo as "receita" | "despesa",
                valor: Number(l.valor) || 0,
                valor_pago: Number(l.valor_pago) || 0,
                data_emissao: String(l.data_emissao ?? ""),
                data_vencimento: String(l.data_vencimento ?? ""),
                data_pagamento: (l.data_pagamento as string) ?? null,
                status: l.status as "pago" | "pendente" | "atrasado" | "cancelado",
                forma_pagamento: (l.forma_pagamento as string) ?? null,
                categoria_id: (l.categoria_id as string) ?? null,
                categoria_nome: (l.categoria as { nome?: string } | null)?.nome ?? null,
                cliente_id: (l.cliente_id as string) ?? cli?.id ?? null,
                cliente_nome: cli?.nome ?? null,
                fornecedor_id: null,
                fornecedor_nome: forn?.nome_fantasia ?? forn?.razao_social ?? null,
              };
            });
        },
        () => cloudAdapter.relatorios.lancamentosFinanceiroPeriodo({ inicio, fim }),
      ),
    // ---- Onda 3 — PR-O3-1: contas a receber 100% locais via cache completo ----
    cardContasReceber: () =>
      withCloudFallback(
        "relatorios", "cardContasReceber",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "financeiro_lancamentos_completo", "listLancamentosCompleto",
            "/api/financeiro/lancamentos-completo",
          );
          if (!Array.isArray(raw)) return null;
          return raw
            .filter((l) => l.tipo === "receber" && l.status !== "cancelado")
            .sort((a, b) => String(b.data_vencimento ?? "").localeCompare(String(a.data_vencimento ?? "")))
            .slice(0, 2000)
            .map(mapContasReceberLocal);
        },
        () => cloudAdapter.relatorios.cardContasReceber(),
      ),
    lancamentosContasReceber: ({ inicio, fim, campoData, clienteId }) =>
      withCloudFallback(
        "relatorios", "lancamentosContasReceber",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "financeiro_lancamentos_completo", "listLancamentosCompleto",
            "/api/financeiro/lancamentos-completo",
          );
          if (!Array.isArray(raw)) return null;
          const campo: "data_vencimento" | "data_emissao" | "data_pagamento" =
            campoData === "emissao" ? "data_emissao"
            : campoData === "pagamento" ? "data_pagamento"
            : "data_vencimento";
          const filtroCliente = clienteId && clienteId !== "todos" ? String(clienteId) : null;
          return raw
            .filter((l) => {
              if (l.tipo !== "receber") return false;
              const d = l[campo] as string | null | undefined;
              if (campo === "data_pagamento" && (d == null || d === "")) return false;
              if (d == null) return false;
              if (d < inicio || d > fim) return false;
              if (filtroCliente && String(l.cliente_id ?? "") !== filtroCliente) return false;
              return true;
            })
            .sort((a, b) => String(b[campo] ?? "").localeCompare(String(a[campo] ?? "")))
            .slice(0, 2000)
            .map(mapContasReceberLocal);
        },
        () => cloudAdapter.relatorios.lancamentosContasReceber({ inicio, fim, campoData, clienteId }),
      ),
    saldoAcumuladoFinanceiro: () =>
      withCloudFallback(
        "relatorios", "saldoAcumuladoFinanceiro",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "financeiro_lancamentos_completo", "listLancamentosCompleto",
            "/api/financeiro/lancamentos-completo",
          );
          if (!Array.isArray(raw)) return null;
          let recebido = 0;
          let pago = 0;
          for (const l of raw) {
            if (l.status !== "pago") continue;
            const v = Number(l.valor_pago) || 0;
            if (l.tipo === "receita") recebido += v;
            else if (l.tipo === "despesa") pago += v;
          }
          return { recebido, pago };
        },
        () => cloudAdapter.relatorios.saldoAcumuladoFinanceiro(),
      ),
    clientesOpcoes: () =>
      withCloudFallback(
        "relatorios", "clientesOpcoes",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "clientes", "list", "/api/clientes", { status: "" },
          );
          if (!Array.isArray(raw)) return null;
          return raw
            .map((c) => ({
              id: String(c.id),
              nome: String(c.nome ?? ""),
              nome_fantasia: (c.nome_fantasia as string) ?? null,
              documento: (c.documento as string) ?? null,
            }))
            .sort((a, b) => a.nome.localeCompare(b.nome));
        },
        () => cloudAdapter.relatorios.clientesOpcoes(),
      ),
    clientesPorIds: (ids) =>
      withCloudFallback(
        "relatorios", "clientesPorIds",
        async () => {
          if (!ids.length) return [];
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "clientes", "list", "/api/clientes", { status: "" },
          );
          if (!Array.isArray(raw)) return null;
          const set = new Set(ids);
          return raw
            .filter((c) => set.has(String(c.id)))
            .map((c) => ({ id: String(c.id), nome: String(c.nome ?? "") }));
        },
        () => cloudAdapter.relatorios.clientesPorIds(ids),
      ),
    estoqueBase: () =>
      withCloudFallback(
        "relatorios", "estoqueBase",
        async () => {
          const [prodRaw, movRaw] = await Promise.all([
            tryLocal<Array<Record<string, unknown>>>(
              "produtos", "list", "/api/produtos/list", { status: "ativo" },
            ),
            tryLocal<Array<{ produto_id: string; tipo: string; quantidade: number | string }>>(
              "estoque", "saldosLinhas", "/api/estoque/saldos",
            ),
          ]);
          if (!Array.isArray(prodRaw) || !Array.isArray(movRaw)) return null;
          const produtos = prodRaw
            .map((p) => ({
              id: String(p.id),
              sku: (p.sku as string) ?? null,
              nome: String(p.nome ?? ""),
              unidade: (p.unidade as string) ?? null,
              preco_custo: Number(p.preco_custo) || 0,
              preco_venda: Number(p.preco_venda) || 0,
              estoque_minimo: Number(p.estoque_minimo) || 0,
            }))
            .sort((a, b) => a.nome.localeCompare(b.nome));
          const movimentos = movRaw.map((m) => ({
            produto_id: m.produto_id,
            tipo: m.tipo,
            quantidade: Number(m.quantidade) || 0,
          }));
          return { produtos, movimentos };
        },
        () => cloudAdapter.relatorios.estoqueBase(),
      ),
    dreTotais: ({ inicio, fim }) =>
      withCloudFallback(
        "relatorios", "dreTotais",
        async () => {
          const [vendasRaw, lancRaw] = await Promise.all([
            tryLocal<Array<Record<string, unknown>>>(
              "vendas_remote", "list", "/api/vendas/historico", { limit: "1000" },
            ),
            tryLocal<Array<Record<string, unknown>>>(
              "financeiro_lancamentos_completo", "listLancamentosCompleto",
              "/api/financeiro/lancamentos-completo",
            ),
          ]);
          if (!Array.isArray(vendasRaw) || !Array.isArray(lancRaw)) return null;
          const receita_vendas = vendasRaw
            .filter((v) => {
              if (v.status === "cancelada") return false;
              const d = v.data_emissao as string;
              return d >= inicio && d <= fim;
            })
            .reduce((a, v) => a + (Number(v.total) || 0), 0);
          const lancsPagos = lancRaw.filter((l) => {
            if (l.status !== "pago") return false;
            const dp = l.data_pagamento as string | null;
            return dp != null && dp >= inicio && dp <= fim;
          });
          const outras_receitas = lancsPagos
            .filter((l) => l.tipo === "receita")
            .reduce((a, l) => a + (Number(l.valor_pago) || 0), 0);
          const despesas = lancsPagos
            .filter((l) => l.tipo === "despesa")
            .reduce((a, l) => a + (Number(l.valor_pago) || 0), 0);
          return { receita_vendas, outras_receitas, despesas };
        },
        () => cloudAdapter.relatorios.dreTotais({ inicio, fim }),
      ),
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
          // 1) Fast path: agregação SQL única no Rust
          //    (`GET /api/dashboard/carregar`). 503 quando os caches
          //    primários estão frios — aí tentamos a composição abaixo.
          const aggregated = await tryLocal<
            Awaited<ReturnType<DataAdapter["dashboard"]["carregar"]>>
          >("dashboard", "carregar", "/api/dashboard/carregar");
          if (aggregated) return aggregated;

          // 2) Fallback intermediário: composição cliente a partir dos
          //    endpoints locais já existentes. Útil quando o endpoint
          //    agregado falhar ou um dos caches estiver vazio mas os
          //    outros tiverem dados.
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
            console.debug("[LOCAL_DASHBOARD] server carregar (composto)", {
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

type PostLocalDetail<T> =
  | { ok: true; data: T }
  | { ok: false; reason: "unreachable" | "http_error"; status: number | null; error: string };

async function postLocalAuthDetail<T>(
  path: string,
  body: unknown,
  timeoutMs = HTTP_TIMEOUT_MS,
): Promise<PostLocalDetail<T>> {
  const baseUrl = await resolveBaseUrl();
  if (!baseUrl) {
    return { ok: false, reason: "unreachable", status: null, error: "Servidor local indisponível" };
  }
  let token: string | null = null;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    const sessionPromise = supabase.auth.getSession();
    const sessionTimeout = new Promise<{ data: { session: null } }>((resolve) =>
      setTimeout(() => resolve({ data: { session: null } }), 1000),
    );
    const { data } = await Promise.race([sessionPromise, sessionTimeout]);
    token = data.session?.access_token ?? null;
  } catch { /* sem token → segue só com body */ }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
      let msg = `Servidor local respondeu ${res.status}`;
      try {
        const j = (await res.json()) as { error?: string; message?: string };
        msg = j?.error ?? j?.message ?? msg;
      } catch {
        try { const t = await res.text(); if (t) msg = t; } catch { /* ignore */ }
      }
      return { ok: false, reason: "http_error", status: res.status, error: msg };
    }
    const data = (await res.json()) as T;
    return { ok: true, data };
  } catch (err) {
    clearTimeout(timer);
    cachedBaseUrl = null;
    return {
      ok: false,
      reason: "unreachable",
      status: null,
      error: err instanceof Error ? err.message : "Falha ao contatar servidor local",
    };
  }
}



async function postLocalAuth<T>(path: string, body: unknown, timeoutMs = HTTP_TIMEOUT_MS): Promise<T | null> {
  const baseUrl = await resolveBaseUrl();
  if (!baseUrl) return null;
  let token: string | null = null;
  try {
    const { supabase } = await import("@/integrations/supabase/client");
    // getSession() pode pendurar quando offline tentando refresh do token.
    // Damos no máximo 1s — se demorar, seguimos sem Authorization.
    const sessionPromise = supabase.auth.getSession();
    const timeoutPromise = new Promise<{ data: { session: null } }>((resolve) =>
      setTimeout(() => resolve({ data: { session: null } }), 1000),
    );
    const { data } = await Promise.race([sessionPromise, timeoutPromise]);
    token = data.session?.access_token ?? null;
  } catch { /* sem token → segue só com body */ }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
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
