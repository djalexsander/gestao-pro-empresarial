/**
 * ============================================================================
 * local-server adapter - Servidor Local (mesma maquina que roda o backend)
 * ============================================================================
 *
 * O computador servidor tambem pode operar como caixa. Portanto, leituras
 * operacionais do PDV nao podem cair no Supabase: elas devem consultar o
 * backend Rust local em 127.0.0.1, que entrega SQLite/local-table quando a
 * internet esta indisponivel.
 *
 * Escopo desta etapa:
 * - produtos/lista/busca por codigo/PLU
 * - clientes lite
 * - estoque saldos/movimentacoes
 *
 * Demais dominios continuam inalterados e delegados ao cloudAdapter.
 */

import { getDesktopConfig } from "@/integrations/desktop/configStore";
import { getBaseUrl } from "@/integrations/desktop/serverConnection";
import { supabase } from "@/integrations/supabase/client";
import type { DataAdapter } from "../adapter";
import type {
  ProdutoBuscaResult,
  ProdutoComCategoria,
  ProdutoComVariacoes,
  ProdutoPluResult,
} from "../types";
import { reportDataSource } from "../source-telemetry";
import { cloudAdapter } from "./cloud";
import { localTerminalAdapter } from "./local-terminal";

const LOCAL_READ_DOMAINS = ["produtos", "estoque", "clientes"] as const;
const DEFAULT_LOCAL_PORT = 3333;
const HTTP_TIMEOUT_MS = 4000;

class LocalServerReadError extends Error {
  code = "LOCAL_SERVER_READ_FAILED" as const;

  constructor(domain: string, method: string, detail: string) {
    super(`Falha na leitura local (${domain}.${method}): ${detail}`);
    this.name = "LocalServerReadError";
  }
}

class LocalOfflineUnsupportedError extends Error {
  code = "LOCAL_OFFLINE_UNSUPPORTED" as const;

  constructor(operacao: string) {
    super(
      `${operacao} ainda nÃ£o tem gravaÃ§Ã£o local/offline implementada. ` +
        "A operaÃ§Ã£o foi bloqueada para evitar divergÃªncia entre o banco local e a nuvem.",
    );
    this.name = "LocalOfflineUnsupportedError";
  }
}

function unsupportedLocalWrite(operacao: string): never {
  throw new LocalOfflineUnsupportedError(operacao);
}

function reportCloudOnly(domain: string, method: string): void {
  reportDataSource({ source: "cloud", domain, method, fallback: true });
}

async function cloudOnly<T>(
  domain: string,
  method: string,
  fn: () => Promise<T>,
): Promise<T> {
  reportCloudOnly(domain, method);
  return fn();
}

function getSelfServerBaseUrl(): string {
  const cfg = getDesktopConfig();
  const baseUrl = getBaseUrl({
    host: "127.0.0.1",
    porta: cfg.terminal?.porta ?? DEFAULT_LOCAL_PORT,
    terminalId: "self",
    terminalNome: cfg.serverNome ?? "Servidor",
    serverToken: cfg.serverAuthToken,
  });

  if (!baseUrl) {
    throw new LocalServerReadError(
      "server",
      "baseUrl",
      "servidor local sem host/porta configurados",
    );
  }

  return baseUrl;
}

async function localGet<T>(
  domain: string,
  method: string,
  path: string,
  query?: Record<string, string | null | undefined>,
): Promise<T> {
  const url = new URL(`${getSelfServerBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value != null && value !== "") url.searchParams.set(key, value);
  }

  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);

  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? null;
    const headers: Record<string, string> = { Accept: "application/json" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(url.toString(), {
      method: "GET",
      headers,
      signal: ctrl.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LocalServerReadError(
        domain,
        method,
        `HTTP ${res.status}${text ? ` - ${text}` : ""}`,
      );
    }

    const json = (await res.json()) as { data?: T } | T;
    const payload =
      json && typeof json === "object" && "data" in (json as Record<string, unknown>)
        ? (json as { data?: T }).data
        : json;

    reportDataSource({ source: "local-server", domain, method, fallback: false });
    return payload as T;
  } catch (error) {
    console.warn(`[gestao-pro] leitura local falhou: ${domain}.${method}`, error);
    if (error instanceof LocalServerReadError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new LocalServerReadError(domain, method, detail);
  } finally {
    window.clearTimeout(timer);
  }
}

async function localPost<T>(
  domain: string,
  method: string,
  path: string,
  body: unknown,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);

  try {
    const res = await fetch(`${getSelfServerBaseUrl()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LocalServerReadError(
        domain,
        method,
        `HTTP ${res.status}${text ? ` - ${text}` : ""}`,
      );
    }

    reportDataSource({ source: "local-server", domain, method, fallback: false });
    return (await res.json()) as T;
  } catch (error) {
    console.warn(`[gestao-pro] escrita local falhou: ${domain}.${method}`, error);
    if (error instanceof LocalServerReadError) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new LocalServerReadError(domain, method, detail);
  } finally {
    window.clearTimeout(timer);
  }
}

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function filterProdutos(
  rows: ProdutoComCategoria[],
  input?: Parameters<DataAdapter["produtos"]["list"]>[0],
): ProdutoComCategoria[] {
  const busca = norm(input?.busca);
  return rows.filter((produto) => {
    if (input?.status && produto.status !== input.status) return false;
    if (input?.categoria_id && produto.categoria_id !== input.categoria_id) return false;
    if (!busca) return true;
    return norm(produto.nome).includes(busca) || norm(produto.sku).includes(busca);
  });
}

function mapProdutoToPluResult(row: ProdutoComCategoria): ProdutoPluResult {
  const raw = row as ProdutoComCategoria & {
    vendido_por_peso?: boolean | null;
    aceita_etiqueta_balanca?: boolean | null;
    plu?: string | null;
    codigo_interno?: string | null;
  };

  return {
    produto_id: row.id,
    sku: row.sku,
    nome: row.nome,
    unidade: row.unidade,
    preco_venda: Number(row.preco_venda ?? 0),
    vendido_por_peso: Boolean(raw.vendido_por_peso),
    aceita_etiqueta_balanca: Boolean(raw.aceita_etiqueta_balanca),
    plu: raw.plu ?? raw.codigo_interno ?? row.sku ?? null,
    status: row.status,
  };
}

function matchesPlu(row: ProdutoComCategoria, plu: string): boolean {
  const raw = row as ProdutoComCategoria & {
    plu?: string | null;
    codigo_interno?: string | null;
  };
  const value = plu.trim();
  const stripped = value.replace(/^0+/, "");
  const candidates = [raw.plu, row.sku, raw.codigo_interno]
    .filter((candidate): candidate is string => !!candidate)
    .map((candidate) => candidate.trim());

  return candidates.some(
    (candidate) => candidate === value || (!!stripped && candidate === stripped),
  );
}

function listProdutosLocal(): Promise<ProdutoComCategoria[]> {
  return localGet<ProdutoComCategoria[]>("produtos", "list", "/api/produtos/list");
}

function categoriasFromProdutos(
  rows: ProdutoComCategoria[],
): import("../types").CategoriaProdutoDomain[] {
  const map = new Map<string, import("../types").CategoriaProdutoDomain>();
  for (const row of rows) {
    const raw = row as ProdutoComCategoria & {
      categoria?: { id?: string | null; nome?: string | null } | null;
      categoria_nome?: string | null;
    };
    const id = row.categoria_id ?? raw.categoria?.id ?? null;
    if (!id || map.has(id)) continue;
    map.set(id, {
      id,
      nome: raw.categoria?.nome ?? raw.categoria_nome ?? "Categoria",
      parent_id: null,
      ativo: true,
      descricao: null,
    });
  }
  return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
}

export const localServerAdapter: DataAdapter = {
  ...cloudAdapter,

  produtos: {
    ...cloudAdapter.produtos,
    listar: () => listProdutosLocal(),
    async list(input) {
      const rows = await listProdutosLocal();
      return filterProdutos(rows, input);
    },
    async get(produtoId) {
      const rows = await listProdutosLocal();
      const found = rows.find((produto) => produto.id === produtoId);
      return found ? ({ ...found, variacoes: [] } as ProdutoComVariacoes) : null;
    },
    buscarPorCodigo: (codigo) =>
      localGet<ProdutoBuscaResult | null>("produtos", "buscarPorCodigo", "/api/produtos/buscar", {
        codigo: codigo.trim(),
      }),
    async buscarPorPlu(plu) {
      const value = plu.trim();
      if (!value) return null;
      const rows = await listProdutosLocal();
      const found = rows.find((row) => matchesPlu(row, value));
      return found ? mapProdutoToPluResult(found) : null;
    },
    criar: localTerminalAdapter.produtos.criar,
    editar: (input) =>
      cloudOnly("produtos", "editar", () => cloudAdapter.produtos.editar(input)),
    alterarStatus: (input) =>
      cloudOnly("produtos", "alterarStatus", () => cloudAdapter.produtos.alterarStatus(input)),
    excluir: (produtoId) =>
      cloudOnly("produtos", "excluir", () => cloudAdapter.produtos.excluir(produtoId)),
    adicionarCodigo: (input) =>
      cloudOnly("produtos", "adicionarCodigo", () => cloudAdapter.produtos.adicionarCodigo(input)),
    excluirCodigo: (codigoId) =>
      cloudOnly("produtos", "excluirCodigo", () => cloudAdapter.produtos.excluirCodigo(codigoId)),
    criarVariacao: (input) =>
      cloudOnly("produtos", "criarVariacao", () => cloudAdapter.produtos.criarVariacao(input)),
    excluirVariacao: (variacaoId) =>
      cloudOnly("produtos", "excluirVariacao", () => cloudAdapter.produtos.excluirVariacao(variacaoId)),
    criarCategoria: (input) =>
      cloudOnly("produtos", "criarCategoria", () => cloudAdapter.produtos.criarCategoria(input)),
  },

  estoque: {
    ...cloudAdapter.estoque,
    saldosLinhas: () =>
      localGet<Awaited<ReturnType<DataAdapter["estoque"]["saldosLinhas"]>>>(
        "estoque",
        "saldosLinhas",
        "/api/estoque/saldos",
      ),
    movimentacoes: (input) =>
      localGet<Awaited<ReturnType<DataAdapter["estoque"]["movimentacoes"]>>>(
        "estoque",
        "movimentacoes",
        "/api/estoque/movimentacoes",
        {
          produto_id: input?.produto_id ?? undefined,
          limit: input?.limit != null ? String(input.limit) : undefined,
        },
      ),
    registrarMovimento: localTerminalAdapter.estoque.registrarMovimento,
  },

  vendas: {
    ...cloudAdapter.vendas,
    finalizar: localTerminalAdapter.vendas.finalizar,
    cancelar: localTerminalAdapter.vendas.cancelar,
  },

  caixa: localTerminalAdapter.caixa,

  clientes: {
    ...cloudAdapter.clientes,
    criar: (input) =>
      localPost<Awaited<ReturnType<DataAdapter["clientes"]["criar"]>>>(
        "clientes",
        "criar",
        "/api/clientes/registrar",
        input,
      ),
    list: (input) =>
      localGet<Awaited<ReturnType<DataAdapter["clientes"]["list"]>>>(
        "clientes",
        "list",
        "/api/clientes/list",
        {
          status: input?.status ?? undefined,
          busca: input?.busca ?? undefined,
        },
      ),
    listLite: (input) =>
      localGet<Awaited<ReturnType<DataAdapter["clientes"]["listLite"]>>>(
        "clientes",
        "listLite",
        "/api/clientes/lite",
        {
          status:
            input && "status" in input
              ? input.status === null
                ? ""
                : (input.status ?? undefined)
          : undefined,
        },
      ),
    get: (clienteId) =>
      localGet<Awaited<ReturnType<DataAdapter["clientes"]["get"]>>>(
        "clientes",
        "get",
        "/api/clientes/get",
        { cliente_id: clienteId },
      ),
    metricas: async () => new Map(),
    historico: async () => [],
    checkDocumentoDuplicado: (documento, ignoreId) =>
      localGet<Awaited<ReturnType<DataAdapter["clientes"]["checkDocumentoDuplicado"]>>>(
        "clientes",
        "checkDocumentoDuplicado",
        "/api/clientes/documento",
        { documento, ignore_id: ignoreId ?? undefined },
      ),
    editar: (input) =>
      cloudOnly("clientes", "editar", () => cloudAdapter.clientes.editar(input)),
    alterarStatus: (input) =>
      cloudOnly("clientes", "alterarStatus", () => cloudAdapter.clientes.alterarStatus(input)),
    excluir: (clienteId) =>
      cloudOnly("clientes", "excluir", () => cloudAdapter.clientes.excluir(clienteId)),
  },

  categoriasProduto: {
    ...cloudAdapter.categoriasProduto,
    async list() {
      return categoriasFromProdutos(await listProdutosLocal());
    },
    editar: (input) =>
      cloudOnly("categoriasProduto", "editar", () => cloudAdapter.categoriasProduto.editar(input)),
    alterarStatus: (input) =>
      cloudOnly("categoriasProduto", "alterarStatus", () =>
        cloudAdapter.categoriasProduto.alterarStatus(input),
      ),
    excluir: (categoriaId) =>
      cloudOnly("categoriasProduto", "excluir", () =>
        cloudAdapter.categoriasProduto.excluir(categoriaId),
      ),
  },
};

export { LOCAL_READ_DOMAINS };
