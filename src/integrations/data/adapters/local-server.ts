/**
 * ============================================================================
 * local-server adapter - maquina que hospeda o backend local
 * ============================================================================
 *
 * Leituras seguras usam a API HTTP local primeiro. Se essa API nao estiver
 * disponivel, caem para cloud para manter o modo online normal. Escritas
 * criticas de PDV/caixa/estoque passam pelo adapter local-terminal, que grava
 * no servidor local quando ele esta configurado.
 */

import { supabase } from "@/integrations/supabase/client";
import type { DataAdapter } from "../adapter";
import type { ProdutoComVariacoes } from "../types";
import { cloudAdapter } from "./cloud";
import { localTerminalAdapter } from "./local-terminal";
import { reportDataSource } from "../source-telemetry";
import { getDesktopConfig } from "@/integrations/desktop/configStore";

const LOCAL_READ_DOMAINS = ["produtos", "estoque", "clientes"] as const;
const DEFAULT_LOCAL_PORT = 3333;
const HTTP_TIMEOUT_MS = 4000;

function getSelfServerBaseUrl(): string {
  const cfg = getDesktopConfig();
  return `http://127.0.0.1:${cfg.terminal?.porta ?? DEFAULT_LOCAL_PORT}`;
}

async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function localGet<T>(
  domain: string,
  method: string,
  path: string,
  query?: Record<string, string | undefined>,
): Promise<T | null> {
  const url = new URL(`${getSelfServerBaseUrl()}${path}`);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value != null && value !== "") url.searchParams.set(key, value);
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const headers = await getAuthHeader();
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json", ...headers },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: T } | T;
    reportDataSource({ source: "local-server", domain, method, fallback: false });
    return json && typeof json === "object" && "data" in (json as any)
      ? ((json as any).data as T)
      : (json as T);
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function localPost<T>(
  domain: string,
  method: string,
  path: string,
  body: unknown,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${getSelfServerBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...headers,
      },
      signal: ctrl.signal,
      cache: "no-store",
      body: JSON.stringify(body),
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(await res.text());
    const json = (await res.json()) as { data?: T } | T;
    reportDataSource({ source: "local-server", domain, method, fallback: false });
    return json && typeof json === "object" && "data" in (json as any)
      ? ((json as any).data as T)
      : (json as T);
  } catch (error) {
    clearTimeout(timer);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

async function withFallback<T>(
  domain: string,
  method: string,
  localFetcher: () => Promise<T | null>,
  cloudFetcher: () => Promise<T>,
): Promise<T> {
  const local = await localFetcher();
  if (local !== null && local !== undefined) return local;
  const result = await cloudFetcher();
  reportDataSource({ source: "cloud", domain, method, fallback: true });
  return result;
}

async function cloudOnly<T>(
  domain: string,
  method: string,
  fn: () => Promise<T>,
): Promise<T> {
  const result = await fn();
  reportDataSource({ source: "cloud", domain, method, fallback: true });
  return result;
}

function categoriasFromProdutos(produtos: ProdutoComVariacoes[]) {
  const map = new Map<string, { id: string; nome: string; parent_id: string | null; ativo: boolean }>();
  for (const produto of produtos as Array<ProdutoComVariacoes & { categoria?: { id?: string; nome?: string } | null }>) {
    const categoria = produto.categoria;
    if (produto.categoria_id && categoria?.nome) {
      map.set(produto.categoria_id, {
        id: produto.categoria_id,
        nome: categoria.nome,
        parent_id: null,
        ativo: true,
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => a.nome.localeCompare(b.nome));
}

export const localServerAdapter: DataAdapter = {
  ...cloudAdapter,

  produtos: {
    ...cloudAdapter.produtos,
    listar: () =>
      withFallback(
        "produtos",
        "listar",
        () =>
          localGet<Awaited<ReturnType<DataAdapter["produtos"]["listar"]>>>(
            "produtos",
            "listar",
            "/api/produtos/list",
          ),
        () => cloudAdapter.produtos.listar(),
      ),
    list: (input) =>
      withFallback(
        "produtos",
        "list",
        () =>
          localGet<Awaited<ReturnType<DataAdapter["produtos"]["list"]>>>(
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
    get: (produtoId) =>
      withFallback(
        "produtos",
        "get",
        async () => {
          const produtos = await localGet<ProdutoComVariacoes[]>(
            "produtos",
            "get",
            "/api/produtos/list",
          );
          return produtos?.find((p) => p.id === produtoId) ?? null;
        },
        () => cloudAdapter.produtos.get(produtoId),
      ),
    buscarPorCodigo: (codigo) =>
      withFallback(
        "produtos",
        "buscarPorCodigo",
        () =>
          localGet<Awaited<ReturnType<DataAdapter["produtos"]["buscarPorCodigo"]>>>(
            "produtos",
            "buscarPorCodigo",
            "/api/produtos/buscar",
            { codigo },
          ),
        () => cloudAdapter.produtos.buscarPorCodigo(codigo),
      ),
    buscarPorPlu: (plu) =>
      withFallback(
        "produtos",
        "buscarPorPlu",
        () =>
          localGet<Awaited<ReturnType<DataAdapter["produtos"]["buscarPorPlu"]>>>(
            "produtos",
            "buscarPorPlu",
            "/api/produtos/buscar",
            { codigo: plu },
          ),
        () => cloudAdapter.produtos.buscarPorPlu(plu),
      ),
    criar: (input) =>
      localPost<Awaited<ReturnType<DataAdapter["produtos"]["criar"]>>>(
        "produtos",
        "criar",
        "/api/produtos/criar",
        input,
      ),
    editar: (input) =>
      cloudOnly("produtos", "editar", () => cloudAdapter.produtos.editar(input)),
    alterarStatus: (input) =>
      cloudOnly("produtos", "alterarStatus", () =>
        cloudAdapter.produtos.alterarStatus(input),
      ),
    excluir: (produtoId) =>
      cloudOnly("produtos", "excluir", () => cloudAdapter.produtos.excluir(produtoId)),
    adicionarCodigo: (input) =>
      cloudOnly("produtos", "adicionarCodigo", () =>
        cloudAdapter.produtos.adicionarCodigo(input),
      ),
    excluirCodigo: (codigoId) =>
      cloudOnly("produtos", "excluirCodigo", () =>
        cloudAdapter.produtos.excluirCodigo(codigoId),
      ),
    criarVariacao: (input) =>
      cloudOnly("produtos", "criarVariacao", () =>
        cloudAdapter.produtos.criarVariacao(input),
      ),
    excluirVariacao: (variacaoId) =>
      cloudOnly("produtos", "excluirVariacao", () =>
        cloudAdapter.produtos.excluirVariacao(variacaoId),
      ),
    criarCategoria: (input) =>
      cloudOnly("produtos", "criarCategoria", () =>
        cloudAdapter.produtos.criarCategoria(input),
      ),
  },

  categoriasProduto: {
    ...cloudAdapter.categoriasProduto,
    list: async () => {
      const produtos = await localServerAdapter.produtos.listar();
      return categoriasFromProdutos(produtos as unknown as ProdutoComVariacoes[]);
    },
    editar: (input) =>
      cloudOnly("categoriasProduto", "editar", () =>
        cloudAdapter.categoriasProduto.editar(input),
      ),
    alterarStatus: (input) =>
      cloudOnly("categoriasProduto", "alterarStatus", () =>
        cloudAdapter.categoriasProduto.alterarStatus(input),
      ),
    excluir: (categoriaId) =>
      cloudOnly("categoriasProduto", "excluir", () =>
        cloudAdapter.categoriasProduto.excluir(categoriaId),
      ),
  },

  estoque: {
    ...cloudAdapter.estoque,
    saldosLinhas: () =>
      withFallback(
        "estoque",
        "saldosLinhas",
        () =>
          localGet<Awaited<ReturnType<DataAdapter["estoque"]["saldosLinhas"]>>>(
            "estoque",
            "saldosLinhas",
            "/api/estoque/saldos",
          ),
        () => cloudAdapter.estoque.saldosLinhas(),
      ),
    movimentacoes: (input) =>
      withFallback(
        "estoque",
        "movimentacoes",
        () =>
          localGet<Awaited<ReturnType<DataAdapter["estoque"]["movimentacoes"]>>>(
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
    registrarMovimento: (input) => localTerminalAdapter.estoque.registrarMovimento(input),
  },

  vendas: {
    ...cloudAdapter.vendas,
    finalizar: (input) => localTerminalAdapter.vendas.finalizar(input),
    cancelar: (input) => localTerminalAdapter.vendas.cancelar(input),
  },

  clientes: {
    ...cloudAdapter.clientes,
    criar: (input) =>
      localPost<Awaited<ReturnType<DataAdapter["clientes"]["criar"]>>>(
        "clientes",
        "criar",
        "/api/clientes/criar",
        input,
      ),
    editar: (input) =>
      cloudOnly("clientes", "editar", () => cloudAdapter.clientes.editar(input)),
    alterarStatus: (input) =>
      cloudOnly("clientes", "alterarStatus", () =>
        cloudAdapter.clientes.alterarStatus(input),
      ),
    excluir: (clienteId) =>
      cloudOnly("clientes", "excluir", () => cloudAdapter.clientes.excluir(clienteId)),
    list: (input) =>
      withFallback(
        "clientes",
        "list",
        () =>
          localGet<Awaited<ReturnType<DataAdapter["clientes"]["list"]>>>(
            "clientes",
            "list",
            "/api/clientes/list",
            {
              status:
                input && "status" in input
                  ? input.status === null
                    ? ""
                    : (input.status ?? undefined)
                  : undefined,
            },
          ),
        () => cloudAdapter.clientes.list(input),
      ),
    listLite: (input) =>
      withFallback(
        "clientes",
        "listLite",
        () =>
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
        () => cloudAdapter.clientes.listLite(input),
      ),
    get: (clienteId) =>
      withFallback(
        "clientes",
        "get",
        async () => {
          const clientes = await localGet<Awaited<ReturnType<DataAdapter["clientes"]["list"]>>>(
            "clientes",
            "get",
            "/api/clientes/list",
          );
          return clientes?.find((c) => c.id === clienteId) ?? null;
        },
        () => cloudAdapter.clientes.get(clienteId),
      ),
    metricas: async () => new Map(),
    historico: async () => [],
    checkDocumentoDuplicado: async (documento, ignoreId) => {
      const clientes = await localServerAdapter.clientes.list({ status: null });
      const normalizado = documento.replace(/\D/g, "");
      return (
        clientes.find((cliente) => {
          const doc = (cliente.documento ?? "").replace(/\D/g, "");
          return doc === normalizado && cliente.id !== ignoreId;
        }) ?? null
      );
    },
  },

  caixa: {
    ...cloudAdapter.caixa,
    abrir: async (input) => {
      const local = await localPost<Awaited<ReturnType<DataAdapter["caixa"]["abrir"]>> | {
        caixa_id: string;
        remote_id?: string | null;
      }>("caixa", "abrir", "/api/caixa/abrir", input);
      if (typeof local === "string") return local;
      return local.remote_id ?? local.caixa_id;
    },
    registrarMovimento: async (input) => {
      const local = await localPost<Awaited<ReturnType<DataAdapter["caixa"]["registrarMovimento"]>> | {
        movimento_id: string;
        remote_id?: string | null;
      }>("caixa", "registrarMovimento", "/api/caixa/movimento", input);
      if (typeof local === "string") return local;
      return local.remote_id ?? local.movimento_id;
    },
    fechar: async (input) => {
      const local = await localPost<{
        remote_id?: string | null;
        valor_informado: number;
      }>("caixa", "fechar", "/api/caixa/fechar", input);
      return {
        caixa_id: local.remote_id ?? input.caixa_id,
        valor_esperado: input.valor_informado,
        valor_informado: local.valor_informado,
        diferenca: 0,
        fechado_em: new Date().toISOString(),
      };
    },
    aberto: (filtro) => localTerminalAdapter.caixa.aberto(filtro),
    resumo: (caixaId) => localTerminalAdapter.caixa.resumo(caixaId),
  },
};

export { LOCAL_READ_DOMAINS };
