/**
 * ============================================================================
 * local-terminal adapter — Terminal cliente conectado ao Servidor Local
 * ============================================================================
 *
 * Estratégia incremental nesta etapa:
 *
 *  - Para os domínios "provados" (produtos.list, estoque.saldosLinhas,
 *    estoque.movimentacoes, clientes.listLite), o adapter chama o backend
 *    HTTP local do servidor (`/api/<dominio>/...`). Se a chamada falhar
 *    (timeout, rede, status != 200), o adapter cai para o cloudAdapter
 *    sem quebrar a operação e marca a origem como "cloud" com `fallback: true`.
 *  - Todas as demais operações (writes complexos, vendas, caixa, etc.)
 *    são delegadas direto ao cloudAdapter — não migramos nada além do
 *    escopo desta fase.
 *
 *  Esta camada NÃO sabe sobre Supabase: ela conversa com o servidor local
 *  via HTTP simples e respeita o token JWT do usuário (passado por header)
 *  para que o servidor local possa repassá-lo a quem for de fato a fonte
 *  (cloud agora, banco local depois).
 */

import { supabase } from "@/integrations/supabase/client";
import type { DataAdapter } from "../adapter";
import type {
  CancelarVendaInput,
  CancelarVendaResumo,
  FinalizarVendaInput,
  RegistrarMovimentoEstoqueInput,
  RegistrarMovimentoEstoqueResult,
} from "../types";
import { cloudAdapter } from "./cloud";
import { reportDataSource } from "../source-telemetry";
import { getDesktopConfig } from "@/integrations/desktop/configStore";
import {
  abrirCaixaLocal,
  alterarStatusCategoriaProdutoLocal,
  alterarStatusClienteLocal,
  alterarStatusCompraLocal,
  alterarStatusFornecedorLocal,
  alterarStatusFuncionarioLocal,
  alterarStatusProdutoLocal,
  baixarPagarLocal,
  baixarReceberLocal,
  cancelarPagarLocal,
  cancelarReceberLocal,
  cancelarVendaLocal,
  criarCategoriaProdutoLocal,
  criarClienteLocal,
  criarCompraLocal,
  criarFornecedorLocal,
  criarFuncionarioLocal,
  criarProdutoLocal,
  editarCategoriaProdutoLocal,
  editarClienteLocal,
  editarCompraMetadadosLocal,
  editarFornecedorLocal,
  editarFuncionarioLocal,
  editarProdutoLocal,
  excluirCategoriaProdutoLocal,
  excluirClienteLocal,
  excluirCompraLocal,
  excluirFornecedorLocal,
  excluirFuncionarioLocal,
  excluirProdutoLocal,
  fecharCaixaLocal,
  fetchContasPagarLocal,
  fetchContasReceberLocal,
  getBaseUrl,
  receberCompraItensLocal,
  receberCompraLocal,
  registrarMovCaixaLocal,
  registrarMovimentoLocal,
  registrarVendaLocal,
  resetarPinFuncionarioLocal,
  validarPinServidor,
  type ContaPagarLocalRow,
  type ContaReceberLocalRow,
} from "@/integrations/desktop/serverConnection";
import { buildDashboardFromRaw } from "./offline-dashboard";
import type {
  AbrirCaixaInput,
  FecharCaixaInput,
  FecharCaixaResult,
  RegistrarMovimentoCaixaInput,
} from "../types";

const HTTP_TIMEOUT_MS = 4000;

async function getAuthHeader(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

function getServerBaseUrl(): string | null {
  const cfg = getDesktopConfig();
  return getBaseUrl(cfg.terminal);
}

async function tryLocal<T>(
  domain: string,
  method: string,
  path: string,
  query?: Record<string, string | undefined>,
): Promise<T | null> {
  const baseUrl = getServerBaseUrl();
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
    const payload = (json && typeof json === "object" && "data" in (json as any)
      ? (json as any).data
      : json) as T;
    // Origem real do dado conforme o servidor:
    //   "local-db"           → cache_kv (TTL curto, payload cru)
    //   "local-table"        → tabela tipada local (sync incremental aplicado)
    //   "local-table-stale"  → tabela tipada local (upstream caiu)
    //   "upstream"           → o servidor foi à nuvem buscar agora
    const sourceHdr = res.headers.get("x-gp-source");
    const isLocalData =
      sourceHdr === "local-db" ||
      sourceHdr === "local-table" ||
      sourceHdr === "local-table-stale";
    reportDataSource({
      source: isLocalData ? "local-server" : "local-terminal",
      domain,
      method,
      fallback: false,
    });
    return payload;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

async function withFallback<T>(
  domain: string,
  method: string,
  localFetcher: () => Promise<T | null>,
  cloudFetcher: () => Promise<T>,
): Promise<T> {
  const local = await localFetcher();
  if (local !== null && local !== undefined) {
    // ETAPA 13 — logs DEV de leitura offline para Dashboard / Relatórios.
    if (import.meta.env.DEV && (domain === "relatorios" || domain === "dashboard")) {
      const tag = domain === "dashboard" ? "[LOCAL_DASHBOARD]" : "[LOCAL_REPORTS]";
      // eslint-disable-next-line no-console
      console.debug(`${tag} ${domain}.${method} (origem=local)`);
    }
    return local;
  }
  const result = await cloudFetcher();
  reportDataSource({ source: "cloud", domain, method, fallback: true });
  if (import.meta.env.DEV && (domain === "relatorios" || domain === "dashboard")) {
    const tag = domain === "dashboard" ? "[LOCAL_DASHBOARD]" : "[LOCAL_REPORTS]";
    // eslint-disable-next-line no-console
    console.debug(`${tag} ${domain}.${method} (origem=cloud-fallback)`);
  }
  return result;
}

/**
 * Variante para `buscarPorCodigo`/`buscarPorPlu`. Distingue:
 *   - 200 + `{ result: ... }` → resposta autoritativa offline (mesmo se null).
 *   - 503 / network error     → servidor local indisponível.
 */
async function tryLocalSearch<T>(
  domain: string,
  method: string,
  path: string,
  query: Record<string, string | undefined>,
): Promise<{ kind: "ok"; result: T | null } | { kind: "unavailable" }> {
  const baseUrl = getServerBaseUrl();
  if (!baseUrl) return { kind: "unavailable" };
  const url = new URL(`${baseUrl}${path}`);
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== "") url.searchParams.set(k, v);
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
    if (res.status === 503) return { kind: "unavailable" };
    if (!res.ok) return { kind: "unavailable" };
    const json = (await res.json()) as { result: T | null };
    reportDataSource({ source: "local-server", domain, method, fallback: false });
    return { kind: "ok", result: json.result ?? null };
  } catch {
    clearTimeout(timer);
    return { kind: "unavailable" };
  }
}

// ----------------------------------------------------------------------------
// Mappers locais → domínio
// ----------------------------------------------------------------------------

function msToIsoDate(ms: number | null | undefined): string | null {
  if (!ms || !Number.isFinite(ms)) return null;
  try {
    return new Date(ms).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

function statusContaToFiadoDomain(status: string): string {
  switch (status) {
    case "pago":
      return "recebido";
    case "parcial":
      return "parcial";
    case "cancelado":
      return "cancelado";
    case "vencido":
    case "aberto":
    default:
      return "pendente";
  }
}

function mapContaReceberToFiadoDomain(
  r: ContaReceberLocalRow,
): import("../adapter").FiadoLancamentoDomain {
  const dataEmissao = msToIsoDate(r.created_at_ms);
  const dataVenc = msToIsoDate(r.vencimento_ms ?? r.created_at_ms) ?? dataEmissao ?? "";
  const dataPag =
    r.valor_pago > 0 || r.status === "pago" ? msToIsoDate(r.updated_at_ms) : null;
  // Indicador discreto de sync — vai dentro de `observacoes` para não exigir
  // mudança de layout. Telas que mostram observações já renderizam isso.
  const obs =
    r.sync_status && r.sync_status !== "synced"
      ? `[sync:${r.sync_status}]`
      : null;
  return {
    id: r.local_uuid,
    descricao: `Venda fiado ${r.venda_local_uuid.slice(0, 8)}`,
    valor: r.valor,
    valor_pago: r.valor_pago,
    data_vencimento: dataVenc,
    data_emissao: dataEmissao,
    data_pagamento: dataPag,
    status: statusContaToFiadoDomain(r.status),
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

// ----------------------------------------------------------------------------
// Etapa 9 — Contas a Pagar offline-first
// ----------------------------------------------------------------------------

function statusContaPagarToDomain(status: string): string {
  switch (status) {
    case "pago":
      return "pago";
    case "parcial":
      return "parcial";
    case "cancelado":
      return "cancelado";
    case "vencido":
      return "vencido";
    case "aberto":
    default:
      return "pendente";
  }
}

function mapContaPagarToLancamentoCompleto(
  r: ContaPagarLocalRow,
): import("../adapter").LancamentoCompletoDomain {
  const dataEmissao = msToIsoDate(r.data_emissao_ms ?? r.created_at_ms);
  const dataVenc =
    msToIsoDate(r.vencimento_ms ?? r.created_at_ms) ?? dataEmissao ?? "";
  const dataPag =
    r.valor_pago > 0 || r.status === "pago" ? msToIsoDate(r.updated_at_ms) : null;
  const syncTag =
    r.sync_status && r.sync_status !== "synced" ? `[sync:${r.sync_status}] ` : "";
  return {
    id: r.remote_id ?? r.local_uuid,
    descricao: `${syncTag}${r.descricao ?? "Conta a pagar"}`,
    valor: r.valor,
    valor_pago: r.valor_pago,
    data_vencimento: dataVenc,
    data_pagamento: dataPag,
    data_emissao: dataEmissao,
    // Mantemos "despesa" para compatibilidade com filtros da tela /financeiro
    // (que tratam despesa como sinônimo de "pagar").
    tipo: "despesa" as unknown as "pagar",
    status: statusContaPagarToDomain(r.status),
    observacoes: r.observacao ?? null,
    numero_documento: null,
    forma_pagamento: r.forma_pagamento,
    created_at: msToIsoDate(r.created_at_ms),
    conciliado_em: null,
    valor_repasse: null,
    taxa_repasse: null,
    numero_repasse: null,
    observacao_repasse: null,
    cliente_id: null,
    venda_id: null,
    compra_id: r.compra_remote_id ?? r.compra_local_uuid,
    fornecedor_nome: r.fornecedor_nome,
    fornecedor_documento: null,
    fornecedor_telefone: null,
    cliente_nome: null,
    cliente_documento: null,
    cliente_telefone: null,
    cliente_email: null,
    venda_numero: null,
    venda_data: null,
    venda_total: null,
    compra_numero: null,
    compra_data_emissao: null,
    compra_total: null,
    compra_status: null,
    categoria_nome: null,
  };
}

export const localTerminalAdapter: DataAdapter = {
  ...cloudAdapter,

  produtos: {
    ...cloudAdapter.produtos,
    list: (input) =>
      withFallback(
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
    // Etapa 5 — busca de código de barras / PLU vai SEMPRE primeiro ao
    // servidor local. Se o local responder (mesmo "não encontrado"), a
    // resposta é autoritativa: não consultamos a nuvem. Cloud só entra
    // quando o servidor local está totalmente fora do ar.
    buscarPorCodigo: async (codigo) => {
      const r = await tryLocalSearch<
        Awaited<ReturnType<DataAdapter["produtos"]["buscarPorCodigo"]>>
      >("produtos", "buscarPorCodigo", "/api/produtos/buscar-codigo", { codigo });
      if (r.kind === "ok") {
        if (import.meta.env.DEV)
          // eslint-disable-next-line no-console
          console.debug("[LOCAL_BUSCA] terminal buscarPorCodigo via servidor local", {
            codigo,
            hit: r.result != null,
          });
        return r.result;
      }
      // eslint-disable-next-line no-console
      console.debug("[LOCAL_BUSCA] fallback cloud — servidor local indisponível");
      return cloudAdapter.produtos.buscarPorCodigo(codigo);
    },
    buscarPorPlu: async (plu) => {
      const r = await tryLocalSearch<
        Awaited<ReturnType<DataAdapter["produtos"]["buscarPorPlu"]>>
      >("produtos", "buscarPorPlu", "/api/produtos/buscar-plu", { plu });
      if (r.kind === "ok") {
        if (import.meta.env.DEV)
          // eslint-disable-next-line no-console
          console.debug("[LOCAL_BUSCA] terminal buscarPorPlu via servidor local", {
            plu,
            hit: r.result != null,
          });
        return r.result;
      }
      return cloudAdapter.produtos.buscarPorPlu(plu);
    },
    // ------- WRITES offline-first (Fase 1 v24) -------
    criar: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await criarProdutoLocal(cfg, input as unknown as Record<string, unknown>, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "produtos", method: "criar", fallback: false });
          // eslint-disable-next-line no-console
          console.debug(`[PRODUTOS_LOCAL_CREATE] id=${r.produto_id} idempotente=${r.idempotente} outbox=${r.outbox_status}`);
          return { produto_id: r.produto_id, idempotente: r.idempotente };
        }
      }
      const result = await cloudAdapter.produtos.criar(input);
      reportDataSource({ source: "cloud", domain: "produtos", method: "criar", fallback: true });
      return result;
    },
    editar: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const { produto_id, ...rest } = input as unknown as Record<string, unknown> & { produto_id: string };
        const r = await editarProdutoLocal(cfg, produto_id, rest, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "produtos", method: "editar", fallback: false });
          // eslint-disable-next-line no-console
          console.debug(`[PRODUTOS_OUTBOX] editar id=${r.produto_id} outbox=${r.outbox_status}`);
          return { produto_id: r.produto_id };
        }
      }
      const result = await cloudAdapter.produtos.editar(input);
      reportDataSource({ source: "cloud", domain: "produtos", method: "editar", fallback: true });
      return result;
    },
    alterarStatus: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await alterarStatusProdutoLocal(
          cfg,
          { produto_id: input.produto_id, status: input.status },
          token,
        );
        if (r) {
          reportDataSource({ source: "local-server", domain: "produtos", method: "alterarStatus", fallback: false });
          // eslint-disable-next-line no-console
          console.debug(`[PRODUTOS_OUTBOX] alterar_status id=${r.produto_id} status=${input.status} outbox=${r.outbox_status}`);
          return { produto_id: r.produto_id, status: input.status };
        }
      }
      const result = await cloudAdapter.produtos.alterarStatus(input);
      reportDataSource({ source: "cloud", domain: "produtos", method: "alterarStatus", fallback: true });
      return result;
    },
    excluir: async (produtoId) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await excluirProdutoLocal(cfg, { produto_id: produtoId }, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "produtos", method: "excluir", fallback: false });
          // eslint-disable-next-line no-console
          console.debug(`[PRODUTOS_OUTBOX] excluir id=${r.produto_id} outbox=${r.outbox_status}`);
          return { produto_id: r.produto_id, excluido: true };
        }
      }
      const result = await cloudAdapter.produtos.excluir(produtoId);
      reportDataSource({ source: "cloud", domain: "produtos", method: "excluir", fallback: true });
      return result;
    },
    criarCategoria: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await criarCategoriaProdutoLocal(cfg, {
          nome: input.nome,
          parent_id: input.parent_id ?? null,
          descricao: input.descricao ?? null,
          categoria_id: input.categoria_id ?? null,
          client_uuid: input.client_uuid ?? null,
        }, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "categoriasProduto", method: "criar", fallback: false });
          // eslint-disable-next-line no-console
          console.debug(`[CAT_PROD_LOCAL_CREATE] id=${r.categoria_id} idempotente=${r.idempotente} outbox=${r.outbox_status}`);
          return { categoria_id: r.categoria_id, idempotente: r.idempotente };
        }
      }
      const result = await cloudAdapter.produtos.criarCategoria(input);
      reportDataSource({ source: "cloud", domain: "categoriasProduto", method: "criar", fallback: true });
      return result;
    },
  },

  categoriasProduto: {
    ...cloudAdapter.categoriasProduto,
    editar: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await editarCategoriaProdutoLocal(cfg, {
          categoria_id: input.categoria_id,
          nome: input.nome,
          parent_id: input.parent_id ?? null,
          descricao: input.descricao ?? null,
        }, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "categoriasProduto", method: "editar", fallback: false });
          // eslint-disable-next-line no-console
          console.debug(`[CAT_PROD_OUTBOX] editar id=${r.categoria_id} outbox=${r.outbox_status}`);
          return { categoria_id: r.categoria_id };
        }
      }
      const result = await cloudAdapter.categoriasProduto.editar(input);
      reportDataSource({ source: "cloud", domain: "categoriasProduto", method: "editar", fallback: true });
      return result;
    },
    alterarStatus: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await alterarStatusCategoriaProdutoLocal(cfg, {
          categoria_id: input.categoria_id,
          ativo: input.ativo,
        }, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "categoriasProduto", method: "alterarStatus", fallback: false });
          // eslint-disable-next-line no-console
          console.debug(`[CAT_PROD_OUTBOX] alterar_status id=${r.categoria_id} ativo=${input.ativo} outbox=${r.outbox_status}`);
          return { categoria_id: r.categoria_id, ativo: input.ativo, idempotente: r.idempotente };
        }
      }
      const result = await cloudAdapter.categoriasProduto.alterarStatus(input);
      reportDataSource({ source: "cloud", domain: "categoriasProduto", method: "alterarStatus", fallback: true });
      return result;
    },
    excluir: async (categoriaId) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await excluirCategoriaProdutoLocal(cfg, { categoria_id: categoriaId }, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "categoriasProduto", method: "excluir", fallback: false });
          // eslint-disable-next-line no-console
          console.debug(`[CAT_PROD_OUTBOX] excluir id=${r.categoria_id} outbox=${r.outbox_status}`);
          return { categoria_id: r.categoria_id, excluido: true };
        }
      }
      const result = await cloudAdapter.categoriasProduto.excluir(categoriaId);
      reportDataSource({ source: "cloud", domain: "categoriasProduto", method: "excluir", fallback: true });
      return result;
    },
  },

  // Sub-etapa 4.1: terminais LAN validam PIN do operador no SERVIDOR LOCAL
  // (SQLite central com PBKDF2). Cloud só é usada como fallback online se o
  // operador ainda não foi "aquecido" no servidor local. O cache JS do
  // próprio terminal continua sendo o último recurso (camada superior em
  // `useFuncionarios`), usado quando o servidor local também está fora.
  funcionarios: {
    ...cloudAdapter.funcionarios,
    /**
     * WRITE LOCAL (offline-first): cria funcionário no servidor local que
     * grava no SQLite, aquece o PIN e enfileira na outbox para push à
     * RPC `funcionario_criar` na nuvem. Idempotência por `funcionario_id`
     * (mesmo UUID em SQLite e Supabase) + `client_uuid`.
     */
    criar: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await criarFuncionarioLocal(
          cfg,
          {
            funcionario_id: input.funcionario_id ?? null,
            nome: input.nome,
            login: input.login,
            pin: input.pin,
            role: input.role,
            client_uuid: input.client_uuid ?? null,
          },
          token,
        );
        if (r) {
          reportDataSource({ source: "local-server", domain: "funcionarios", method: "criar", fallback: false });
          // eslint-disable-next-line no-console
          console.debug(`[FUNCIONARIOS_LOCAL_CREATE] id=${r.funcionario_id} idempotente=${r.idempotente} outbox=${r.outbox_status}`);
          return { funcionario_id: r.funcionario_id, idempotente: r.idempotente };
        }
      }
      const result = await cloudAdapter.funcionarios.criar(input);
      reportDataSource({ source: "cloud", domain: "funcionarios", method: "criar", fallback: true });
      return result;
    },
    editar: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await editarFuncionarioLocal(cfg, input, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "funcionarios", method: "editar", fallback: false });
          // eslint-disable-next-line no-console
          console.debug(`[FUNCIONARIOS_OUTBOX] editar id=${r.funcionario_id} outbox=${r.outbox_status}`);
          return { funcionario_id: r.funcionario_id };
        }
      }
      const result = await cloudAdapter.funcionarios.editar(input);
      reportDataSource({ source: "cloud", domain: "funcionarios", method: "editar", fallback: true });
      return result;
    },
    alterarStatus: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await alterarStatusFuncionarioLocal(cfg, input, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "funcionarios", method: "alterarStatus", fallback: false });
          // eslint-disable-next-line no-console
          console.debug(`[FUNCIONARIOS_OUTBOX] alterar_status id=${r.funcionario_id} ativo=${input.ativo} outbox=${r.outbox_status}`);
          return { funcionario_id: r.funcionario_id, ativo: input.ativo, idempotente: r.idempotente };
        }
      }
      const result = await cloudAdapter.funcionarios.alterarStatus(input);
      reportDataSource({ source: "cloud", domain: "funcionarios", method: "alterarStatus", fallback: true });
      return result;
    },
    excluir: async (funcionarioId) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await excluirFuncionarioLocal(cfg, { funcionario_id: funcionarioId }, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "funcionarios", method: "excluir", fallback: false });
          // eslint-disable-next-line no-console
          console.debug(`[FUNCIONARIOS_OUTBOX] excluir id=${r.funcionario_id} outbox=${r.outbox_status}`);
          return { funcionario_id: r.funcionario_id, excluido: true };
        }
      }
      const result = await cloudAdapter.funcionarios.excluir(funcionarioId);
      reportDataSource({ source: "cloud", domain: "funcionarios", method: "excluir", fallback: true });
      return result;
    },
    resetarPin: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await resetarPinFuncionarioLocal(cfg, input, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "funcionarios", method: "resetarPin", fallback: false });
          // eslint-disable-next-line no-console
          console.debug(`[FUNCIONARIOS_OUTBOX] resetar_pin id=${r.funcionario_id} outbox=${r.outbox_status}`);
          return;
        }
      }
      await cloudAdapter.funcionarios.resetarPin(input);
      reportDataSource({ source: "cloud", domain: "funcionarios", method: "resetarPin", fallback: true });
    },
    validarPin: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        // eslint-disable-next-line no-console
        console.debug("[OFFLINE_AUTH] terminal validando PIN no servidor LAN");
        const r = await validarPinServidor(cfg, input.funcionario_id, input.pin);
        if (r.kind === "ok") {
          if (r.data.autorizado && r.data.funcionario) {
            return {
              id: r.data.funcionario.id,
              nome: r.data.funcionario.nome,
              login: r.data.funcionario.login,
              role: r.data.funcionario.role,
            };
          }
          throw new Error(r.data.motivo ?? "PIN inválido.");
        }
        // notReady / unavailable → cai pra cloud (online).
        // eslint-disable-next-line no-console
        console.debug("[OFFLINE_AUTH] fallback cloud online — servidor LAN", r.kind);
      }
      return cloudAdapter.funcionarios.validarPin(input);
    },
  },

  estoque: {
    ...cloudAdapter.estoque,
    saldosLinhas: () =>
      withFallback(
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
      withFallback(
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

    /**
     * WRITE LOCAL: a movimentação vai PRIMEIRO ao servidor local (que grava
     * em SQLite, atualiza o saldo materializado e enfileira na outbox para
     * o push posterior à nuvem). Se o servidor local não responde (offline,
     * sem config, etc.), caímos no cloudAdapter — comportamento legado.
     *
     * Idempotência:
     *  - `client_uuid` (1 por modal) impede duplicar via duplo clique antes
     *    do servidor responder.
     *  - O servidor local gera um `local_uuid` estável que vira o
     *    `_client_uuid` da RPC upstream — retries cross-runs também não
     *    duplicam.
     */
    registrarMovimento: async (
      input: RegistrarMovimentoEstoqueInput,
    ): Promise<RegistrarMovimentoEstoqueResult> => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const local = await registrarMovimentoLocal(
          cfg,
          {
            produto_id: input.produto_id,
            variacao_id: input.variacao_id ?? null,
            tipo: input.tipo,
            quantidade: input.quantidade,
            custo_unitario: input.custo_unitario ?? null,
            observacoes: input.observacoes ?? null,
            origem: input.origem ?? null,
            client_uuid: input.client_uuid ?? null,
          },
          token,
        );
        if (local) {
          reportDataSource({
            source: "local-server",
            domain: "estoque",
            method: "registrarMovimento",
            fallback: false,
          });
          return {
            movimento_id: local.movimento_id,
            idempotente: local.idempotente,
            saldo_anterior: local.saldo_anterior,
            saldo_posterior: local.saldo_posterior,
          };
        }
      }
      // Fallback cloud — o app continua funcionando mesmo sem servidor local.
      const result = await cloudAdapter.estoque.registrarMovimento(input);
      reportDataSource({
        source: "cloud",
        domain: "estoque",
        method: "registrarMovimento",
        fallback: true,
      });
      return result;
    },
  },

  vendas: {
    ...cloudAdapter.vendas,
    /**
     * Histórico de vendas (v16): leitura offline-first a partir de
     * `vendas_remote_cache`. Não confundir com o write do PDV
     * (`finalizar`/`cancelar`), que segue lógica própria abaixo.
     */
    list: (input) =>
      withFallback(
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
    /**
     * WRITE LOCAL: a venda vai PRIMEIRO ao servidor local (que grava em
     * SQLite, baixa o estoque local na mesma transação e enfileira na
     * outbox para push posterior à RPC `finalizar_venda_pdv` na nuvem).
     *
     * Idempotência:
     *  - `client_uuid` (1 por carrinho) impede duplicar entre cliques.
     *  - O servidor local gera um `local_uuid` estável que vira o
     *    `_client_uuid` da RPC upstream — retries cross-runs também não
     *    duplicam venda, itens, estoque, financeiro nem caixa.
     *
     * Comportamento:
     *  - online + upstream ok → `outbox_status: "sent"` (entrega imediata);
     *  - upstream caiu / sem rede → `outbox_status: "pending"`, scheduler
     *    de background tenta sozinho com backoff exponencial.
     *
     * Em ambos os casos, esta função retorna o `venda_id` (que é o
     * `local_uuid` quando a entrega ainda está pendente, ou o id da nuvem
     * quando já foi entregue). O PDV trata os dois casos da mesma forma
     * — a venda é válida localmente desde o momento do registro.
     */
    finalizar: async (input: FinalizarVendaInput): Promise<string> => {
      const cfg = getDesktopConfig().terminal;
      const hasBase = !!getBaseUrl(cfg);
      const online = typeof navigator === "undefined" ? true : navigator.onLine;
      if (import.meta.env.DEV) {
        // eslint-disable-next-line no-console
        console.log("[PDV_FINALIZAR] iniciado", {
          modo: hasBase ? "local-terminal" : "cloud",
          online,
          itens: input.itens?.length ?? 0,
          total: input.total,
        });
      }
      if (hasBase) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        if (import.meta.env.DEV) console.log("[PDV_FINALIZAR_LOCAL] gravando SQLite (terminal → servidor local)");
        const local = await registrarVendaLocal(
          cfg,
          {
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
          },
          token,
        );
        if (local.ok) {
          reportDataSource({
            source: "local-server",
            domain: "vendas",
            method: "finalizar",
            fallback: false,
          });
          if (import.meta.env.DEV) {
            console.log("[PDV_FINALIZAR_LOCAL] estoque baixado / caixa vinculado", {
              venda_id: local.data.venda_id,
              outbox_status: local.data.outbox_status,
            });
            console.log("[PDV_FINALIZAR_OUTBOX]", { status: local.data.outbox_status });
            console.log("[PDV_FINALIZAR_OK] venda finalizada", {
              modo: "local-terminal",
              venda_id: local.data.venda_id,
            });
          }
          return local.data.remote_id ?? local.data.venda_id;
        }
        // Servidor local devolveu erro de validação → não tentar cloud,
        // mostra a mensagem real do servidor local.
        if (local.reason === "http_error") {
          if (import.meta.env.DEV) console.warn("[PDV_FINALIZAR_ERRO] servidor local rejeitou", local);
          throw new Error(local.error);
        }
        // Servidor local inalcançável → se offline, não cair pra cloud.
        if (!online) {
          if (import.meta.env.DEV) console.warn("[PDV_FINALIZAR_ERRO] offline e servidor local indisponível");
          throw new Error("Sem conexão com o servidor local. Reabra o terminal ou conecte ao servidor para finalizar a venda.");
        }
      } else if (!online) {
        if (import.meta.env.DEV) console.warn("[PDV_FINALIZAR_ERRO] offline sem servidor local configurado");
        throw new Error("Sem conexão com a internet e sem servidor local. Não foi possível finalizar a venda.");
      }
      // Fallback cloud — mantém o app funcional sem servidor local.
      if (import.meta.env.DEV) console.log("[PDV_FINALIZAR] fallback cloud");
      const result = await cloudAdapter.vendas.finalizar(input);
      reportDataSource({
        source: "cloud",
        domain: "vendas",
        method: "finalizar",
        fallback: true,
      });
      if (import.meta.env.DEV) console.log("[PDV_FINALIZAR_OK] venda finalizada", { modo: "cloud", venda_id: result });
      return result;
    },

    /**
     * CANCELAMENTO LOCAL: tenta primeiro o servidor local (estorna estoque
     * local + regenera lançamentos do caixa local + enfileira para upstream).
     * Em qualquer falha (sem servidor, venda só na nuvem, erro de validação),
     * delega ao cloudAdapter — comportamento legado preservado.
     *
     * Idempotência: o backend local detecta venda já cancelada e devolve
     * `idempotente=true` sem refazer o estorno.
     */
    cancelar: async (input: CancelarVendaInput): Promise<CancelarVendaResumo> => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        try {
          const { data } = await supabase.auth.getSession();
          const token = data.session?.access_token ?? null;
          const local = await cancelarVendaLocal(
            cfg,
            {
              venda_local_uuid: input.venda_id,
              motivo: input.motivo ?? null,
              client_uuid: input.venda_id,
            },
            token,
          );
          if (local) {
            reportDataSource({
              source: "local-server",
              domain: "vendas",
              method: "cancelar",
              fallback: false,
            });
            // Backend local devolve apenas os agregados — para o resumo
            // detalhado (itens estornados, lançamentos cancelados), buscamos
            // do cloud quando já estiver sincronizado. Caso contrário,
            // entregamos um resumo mínimo válido para a UI.
            if (local.outbox_status === "sent") {
              try {
                return await cloudAdapter.vendas.cancelar(input);
              } catch {
                /* fallback ao resumo mínimo abaixo */
              }
            }
            return {
              venda_id: input.venda_id,
              numero: "",
              total: local.qtd_total_estornada,
              motivo: input.motivo ?? null,
              cancelado_em: new Date().toISOString(),
              qtd_itens_estornados: local.qtd_itens_estornados,
              qtd_total_estornada: local.qtd_total_estornada,
              itens_estornados: [],
              qtd_lancamentos_cancelados: 0,
              total_lancamentos_cancelados: 0,
              lancamentos_cancelados: [],
            };
          }
        } catch {
          /* cai no fallback cloud abaixo */
        }
      }
      const result = await cloudAdapter.vendas.cancelar(input);
      reportDataSource({
        source: "cloud",
        domain: "vendas",
        method: "cancelar",
        fallback: true,
      });
      return result;
    },
  },

  clientes: {
    ...cloudAdapter.clientes,
    /**
     * Writes (Fase 2): vão PRIMEIRO ao servidor local. Lá geram um
     * `local_uuid` estável, gravam no `clientes_local`, enfileiram na
     * `outbox_clientes` e tentam push imediato à nuvem. Se o servidor
     * local não responde, caímos no cloudAdapter (legado).
     */
    criar: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await criarClienteLocal(cfg, input as unknown as Record<string, unknown>, token);
        if (r) {
          reportDataSource({
            source: "local-server",
            domain: "clientes",
            method: "criar",
            fallback: false,
          });
          return { cliente_id: r.cliente_id, idempotente: r.idempotente };
        }
      }
      const result = await cloudAdapter.clientes.criar(input);
      reportDataSource({ source: "cloud", domain: "clientes", method: "criar", fallback: true });
      return result;
    },
    editar: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await editarClienteLocal(
          cfg,
          input as unknown as Record<string, unknown> & { cliente_id: string },
          token,
        );
        if (r) {
          reportDataSource({
            source: "local-server",
            domain: "clientes",
            method: "editar",
            fallback: false,
          });
          return { cliente_id: r.cliente_id };
        }
      }
      const result = await cloudAdapter.clientes.editar(input);
      reportDataSource({ source: "cloud", domain: "clientes", method: "editar", fallback: true });
      return result;
    },
    alterarStatus: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await alterarStatusClienteLocal(
          cfg,
          { cliente_id: input.cliente_id, status: input.status },
          token,
        );
        if (r) {
          reportDataSource({
            source: "local-server",
            domain: "clientes",
            method: "alterarStatus",
            fallback: false,
          });
          return { cliente_id: r.cliente_id, status: input.status };
        }
      }
      const result = await cloudAdapter.clientes.alterarStatus(input);
      reportDataSource({ source: "cloud", domain: "clientes", method: "alterarStatus", fallback: true });
      return result;
    },
    excluir: async (clienteId) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await excluirClienteLocal(cfg, { cliente_id: clienteId }, token);
        if (r) {
          reportDataSource({
            source: "local-server",
            domain: "clientes",
            method: "excluir",
            fallback: false,
          });
          return { cliente_id: r.cliente_id, excluido: true };
        }
      }
      const result = await cloudAdapter.clientes.excluir(clienteId);
      reportDataSource({ source: "cloud", domain: "clientes", method: "excluir", fallback: true });
      return result;
    },
    /**
     * Leitura completa do cadastro de clientes. Lê do `clientes_local`
     * (payload completo armazenado pelo `ingest_clientes`). Filtros
     * `status` / `busca` são aplicados client-side sobre o resultado local.
     */
    list: (input) =>
      withFallback(
        "clientes",
        "list",
        async () => {
          const all = await tryLocal<
            Awaited<ReturnType<DataAdapter["clientes"]["list"]>>
          >(
            "clientes",
            "list",
            "/api/clientes/lite",
            { status: "" },
          );
          if (!Array.isArray(all)) return all;
          let rows = all;
          if (input?.status) {
            rows = rows.filter(
              (c) => (c as { status?: string }).status === input.status,
            );
          }
          if (input?.busca) {
            const b = input.busca.trim().toLowerCase();
            if (b) {
              rows = rows.filter((c) => {
                const x = c as {
                  nome?: string | null;
                  nome_fantasia?: string | null;
                  documento?: string | null;
                };
                return (
                  (x.nome ?? "").toLowerCase().includes(b) ||
                  (x.nome_fantasia ?? "").toLowerCase().includes(b) ||
                  (x.documento ?? "").toLowerCase().includes(b)
                );
              });
            }
          }
          return rows;
        },
        () => cloudAdapter.clientes.list(input),
      ),
    listLite: (input) =>
      withFallback(
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
                  ? input.status === null
                    ? ""
                    : (input.status ?? undefined)
                  : undefined,
            },
          ),
        () => cloudAdapter.clientes.listLite(input),
      ),
  },

  /**
   * Fornecedores (v13): mesma filosofia de clientes — leitura completa do
   * cadastro a partir de `fornecedores_local` (payload completo). Filtros
   * client-side. Writes continuam diretos na nuvem por enquanto.
   */
  fornecedores: {
    ...cloudAdapter.fornecedores,
    /**
     * Writes (Fase 2 — fornecedores): mesma filosofia de clientes. Vão ao
     * servidor local que grava em `fornecedores_local`, enfileira em
     * `outbox_fornecedores` e tenta push imediato à nuvem.
     */
    criar: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await criarFornecedorLocal(
          cfg,
          input as unknown as Record<string, unknown>,
          token,
        );
        if (r) {
          reportDataSource({
            source: "local-server",
            domain: "fornecedores",
            method: "criar",
            fallback: false,
          });
          return { fornecedor_id: r.fornecedor_id, idempotente: r.idempotente };
        }
      }
      const result = await cloudAdapter.fornecedores.criar(input);
      reportDataSource({ source: "cloud", domain: "fornecedores", method: "criar", fallback: true });
      return result;
    },
    editar: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await editarFornecedorLocal(
          cfg,
          input as unknown as Record<string, unknown> & { fornecedor_id: string },
          token,
        );
        if (r) {
          reportDataSource({
            source: "local-server",
            domain: "fornecedores",
            method: "editar",
            fallback: false,
          });
          return { fornecedor_id: r.fornecedor_id };
        }
      }
      const result = await cloudAdapter.fornecedores.editar(input);
      reportDataSource({ source: "cloud", domain: "fornecedores", method: "editar", fallback: true });
      return result;
    },
    alterarStatus: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await alterarStatusFornecedorLocal(
          cfg,
          { fornecedor_id: input.fornecedor_id, status: input.status },
          token,
        );
        if (r) {
          reportDataSource({
            source: "local-server",
            domain: "fornecedores",
            method: "alterarStatus",
            fallback: false,
          });
          return { fornecedor_id: r.fornecedor_id, status: input.status };
        }
      }
      const result = await cloudAdapter.fornecedores.alterarStatus(input);
      reportDataSource({ source: "cloud", domain: "fornecedores", method: "alterarStatus", fallback: true });
      return result;
    },
    excluir: async (fornecedorId) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await excluirFornecedorLocal(cfg, { fornecedor_id: fornecedorId }, token);
        if (r) {
          reportDataSource({
            source: "local-server",
            domain: "fornecedores",
            method: "excluir",
            fallback: false,
          });
          return { fornecedor_id: r.fornecedor_id, excluido: true };
        }
      }
      const result = await cloudAdapter.fornecedores.excluir(fornecedorId);
      reportDataSource({ source: "cloud", domain: "fornecedores", method: "excluir", fallback: true });
      return result;
    },
    list: (input) =>
      withFallback(
        "fornecedores",
        "list",
        async () => {
          const all = await tryLocal<
            Awaited<ReturnType<DataAdapter["fornecedores"]["list"]>>
          >(
            "fornecedores",
            "list",
            "/api/fornecedores",
            { status: "" },
          );
          if (!Array.isArray(all)) return all;
          let rows = all;
          if (input?.status) {
            rows = rows.filter(
              (f) => (f as { status?: string }).status === input.status,
            );
          }
          if (input?.busca) {
            const b = input.busca.trim().toLowerCase();
            if (b) {
              rows = rows.filter((f) => {
                const x = f as {
                  razao_social?: string | null;
                  nome_fantasia?: string | null;
                  documento?: string | null;
                };
                return (
                  (x.razao_social ?? "").toLowerCase().includes(b) ||
                  (x.nome_fantasia ?? "").toLowerCase().includes(b) ||
                  (x.documento ?? "").toLowerCase().includes(b)
                );
              });
            }
          }
          return rows;
        },
        () => cloudAdapter.fornecedores.list(input),
      ),
  },

  /**
   * Financeiro (v14): a tela /financeiro lista TODOS os lançamentos com
   * joins (cliente, fornecedor, venda, compra, categoria). Cacheamos o
   * payload completo do PostgREST em `financeiro_lancamentos_local` e
   * reaplicamos o mapeamento do cloudAdapter para que a UI receba
   * `LancamentoCompletoDomain[]` sem perceber a origem. Writes do
   * financeiro continuam direto na nuvem nesta fase.
   */
  financeiro: {
    ...cloudAdapter.financeiro,
    listLancamentosCompleto: async () => {
      // Cache remoto (proxied) primeiro; depois mescla títulos a pagar
      // locais (`contas_pagar_local`) que ainda não vieram da nuvem ou
      // foram gerados offline a partir de `compra_receber_local`.
      const cfg = getDesktopConfig().terminal;
      let remoteRows: import("../adapter").LancamentoCompletoDomain[] | null = null;
      try {
        remoteRows = await withFallback(
          "financeiro",
          "listLancamentosCompleto",
          async () => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const raw = await tryLocal<any[]>(
              "financeiro_lancamentos_completo",
              "listLancamentosCompleto",
              "/api/financeiro/lancamentos-completo",
            );
            if (!Array.isArray(raw)) return null;
            return raw.map(
              (r): import("../adapter").LancamentoCompletoDomain => ({
                id: r.id,
                descricao: r.descricao,
                valor: r.valor,
                valor_pago: r.valor_pago,
                data_vencimento: r.data_vencimento,
                data_pagamento: r.data_pagamento,
                data_emissao: r.data_emissao,
                tipo: r.tipo,
                status: r.status,
                observacoes: r.observacoes,
                numero_documento: r.numero_documento,
                forma_pagamento: r.forma_pagamento,
                created_at: r.created_at,
                conciliado_em: r.conciliado_em,
                valor_repasse: r.valor_repasse,
                taxa_repasse: r.taxa_repasse,
                numero_repasse: r.numero_repasse,
                observacao_repasse: r.observacao_repasse,
                cliente_id: r.cliente_id,
                venda_id: r.venda_id,
                compra_id: r.compra_id,
                fornecedor_nome:
                  r.fornecedor?.nome_fantasia ?? r.fornecedor?.razao_social ?? null,
                fornecedor_documento: r.fornecedor?.documento ?? null,
                fornecedor_telefone: r.fornecedor?.telefone ?? null,
                cliente_nome: r.cliente?.nome ?? null,
                cliente_documento: r.cliente?.documento ?? null,
                cliente_telefone: r.cliente?.telefone ?? r.cliente?.celular ?? null,
                cliente_email: r.cliente?.email ?? null,
                venda_numero: r.venda?.numero ?? null,
                venda_data: r.venda?.data_finalizacao ?? null,
                venda_total: r.venda?.total ?? null,
                compra_numero: r.compra?.numero ?? null,
                compra_data_emissao: r.compra?.data_emissao ?? null,
                compra_total: r.compra?.total ?? null,
                compra_status: r.compra?.status ?? null,
                categoria_nome: r.categoria?.nome ?? null,
              }),
            );
          },
          () => cloudAdapter.financeiro.listLancamentosCompleto(),
        );
      } catch {
        remoteRows = [];
      }
      const base = remoteRows ?? [];
      // Mescla locais a pagar não represados ainda no cache remoto.
      if (getBaseUrl(cfg)) {
        try {
          const locais = await fetchContasPagarLocal(cfg, { status: "todos", limit: 1000 });
          if (locais.length > 0) {
            const remoteIds = new Set(base.map((b) => b.id));
            const mesclar = locais
              .filter((l) => !(l.remote_id && remoteIds.has(l.remote_id)))
              .map(mapContaPagarToLancamentoCompleto);
            if (mesclar.length > 0) {
              if (import.meta.env.DEV) {
                // eslint-disable-next-line no-console
                console.debug("[LOCAL_PAYABLE_UI] merge listLancamentos", {
                  remotos: base.length,
                  locais: mesclar.length,
                });
              }
              return [...base, ...mesclar];
            }
          }
        } catch {
          // sem rede local, devolve só o cache remoto
        }
      }
      return base;
    },

    // -----------------------------------------------------------------
    // Sub-etapa 8.1 — Clientes a Receber / Fiado offline-first
    //
    // listFiado prioriza títulos locais (`contas_receber_local`). Quando
    // local responde com lista NÃO vazia, devolvemos apenas eles. Caso o
    // servidor local esteja fora OU ainda não tenha gerado fiados locais,
    // caímos para a cloud — preserva UX em transição.
    //
    // registrarPagamento e cancelarLancamento tentam primeiro o endpoint
    // local (idempotente por `client_uuid`). Se o título não existir
    // localmente (id é de origem cloud), caímos para a cloud sem ruído.
    // -----------------------------------------------------------------
    listFiado: async () => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        try {
          const rows = await fetchContasReceberLocal(cfg, { status: "todos", limit: 1000 });
          if (rows.length > 0) {
            if (import.meta.env.DEV) {
              // eslint-disable-next-line no-console
              console.debug("[LOCAL_RECEIVABLE_UI] listFiado servidor local", {
                rows: rows.length,
              });
            }
            reportDataSource({ source: "local-server", domain: "financeiro", method: "listFiado", fallback: false });
            return rows.map(mapContaReceberToFiadoDomain);
          }
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[LOCAL_RECEIVABLE_UI] listFiado vazio local — fallback cloud");
          }
        } catch {
          // network → cloud fallback abaixo
        }
      }
      const result = await cloudAdapter.financeiro.listFiado();
      reportDataSource({ source: "cloud", domain: "financeiro", method: "listFiado", fallback: true });
      return result;
    },

    registrarPagamento: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const dataMs = input.data_pagamento
          ? Date.parse(`${input.data_pagamento}T12:00:00`)
          : Date.now();
        const r = await baixarReceberLocal(cfg, {
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
            console.debug("[LOCAL_RECEIVABLE_UI] baixa servidor local ok", {
              titulo: r.receber_local_uuid,
              status: r.status,
              idempotente: r.idempotente,
            });
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
          console.debug("[LOCAL_RECEIVABLE_UI] baixa local falhou — fallback cloud", {
            lancamento_id: input.lancamento_id,
          });
        }
        // Fallthrough Etapa 9: pode ser um título a pagar (`contas_pagar_local`).
        const rp = await baixarPagarLocal(cfg, {
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
            console.debug("[LOCAL_PAYABLE_UI] baixa servidor local ok", {
              titulo: rp.pagar_local_uuid,
              status: rp.status,
              idempotente: rp.idempotente,
            });
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
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const r = await cancelarReceberLocal(cfg, {
          receber_id: input.lancamento_id,
          motivo: input.motivo ?? null,
        });
        if (r) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[LOCAL_RECEIVABLE_UI] cancelamento servidor local ok", {
              titulo: r.receber_local_uuid,
              status: r.status,
              idempotente: r.idempotente,
            });
          }
          reportDataSource({ source: "local-server", domain: "financeiro", method: "cancelarLancamento", fallback: false });
          return { lancamento_id: r.receber_local_uuid, idempotente: r.idempotente };
        }
        if (import.meta.env.DEV) {
          // eslint-disable-next-line no-console
          console.debug("[LOCAL_RECEIVABLE_UI] cancelamento local falhou — fallback cloud", {
            lancamento_id: input.lancamento_id,
          });
        // Fallthrough Etapa 9: pode ser um título a pagar.
        const rp = await cancelarPagarLocal(cfg, {
          pagar_id: input.lancamento_id,
          motivo: input.motivo ?? null,
        });
        if (rp) {
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[LOCAL_PAYABLE_UI] cancelamento servidor local ok", {
              titulo: rp.pagar_local_uuid,
              status: rp.status,
              idempotente: rp.idempotente,
            });
          }
          reportDataSource({ source: "local-server", domain: "financeiro", method: "cancelarLancamento", fallback: false });
          return { lancamento_id: rp.pagar_local_uuid, idempotente: rp.idempotente };
        }
      }
      }
      const out = await cloudAdapter.financeiro.cancelarLancamento(input);
      reportDataSource({ source: "cloud", domain: "financeiro", method: "cancelarLancamento", fallback: true });
      return out;
    },
  },

  /**
   * Compras (v15): a tela /compras lista até 500 compras com fornecedor
   * embutido. Cacheamos o payload completo (mesmo `select` do
   * cloudAdapter) em `compras_local`. Writes (criar, receber, atualizar
   * status/metadados, excluir) seguem direto na nuvem nesta fase.
   */
  compras: {
    ...cloudAdapter.compras,
    list: (input) =>
      withFallback(
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
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const payload: Record<string, unknown> = {
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
        };
        const r = await criarCompraLocal(cfg, payload, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "compras", method: "criar", fallback: false });
          // O retorno do adapter é uma compra com fornecedor; otimisticamente
          // deixamos a UI invalidar e re-buscar via list (cache local cobre).
          return {
            id: r.compra_id,
            local_uuid: r.compra_local_uuid,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any;
        }
      }
      const result = await cloudAdapter.compras.criar(input);
      reportDataSource({ source: "cloud", domain: "compras", method: "criar", fallback: true });
      return result;
    },
    atualizarStatus: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await alterarStatusCompraLocal(cfg, { compra_id: input.id, status: input.status }, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "compras", method: "atualizarStatus", fallback: false });
          return;
        }
      }
      await cloudAdapter.compras.atualizarStatus(input);
      reportDataSource({ source: "cloud", domain: "compras", method: "atualizarStatus", fallback: true });
    },
    atualizarMetadados: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const payload: Record<string, unknown> = { compra_id: input.id };
        if ("data_vencimento" in input) payload._data_vencimento = input.data_vencimento ?? null;
        if ("data_prevista" in input) payload._data_prevista = input.data_prevista ?? null;
        if ("fornecedor_id" in input) payload._fornecedor_id = input.fornecedor_id ?? null;
        if ("numero_nf" in input) payload._numero_nf = input.numero_nf ?? null;
        if ("serie_nf" in input) payload._serie_nf = input.serie_nf ?? null;
        if ("observacoes" in input) payload._observacoes = input.observacoes ?? null;
        const r = await editarCompraMetadadosLocal(cfg, payload as Record<string, unknown> & { compra_id: string }, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "compras", method: "atualizarMetadados", fallback: false });
          return;
        }
      }
      await cloudAdapter.compras.atualizarMetadados(input);
      reportDataSource({ source: "cloud", domain: "compras", method: "atualizarMetadados", fallback: true });
    },
    receber: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await receberCompraLocal(cfg, {
          compra_id: input.id,
          data_recebimento: input.data_recebimento,
          gerar_financeiro: input.gerar_financeiro,
          data_vencimento: input.data_vencimento ?? undefined,
        }, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "compras", method: "receber", fallback: false });
          return { compra_id: r.compra_id, local: true };
        }
      }
      const result = await cloudAdapter.compras.receber(input);
      reportDataSource({ source: "cloud", domain: "compras", method: "receber", fallback: true });
      return result;
    },
    receberItens: async (input) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await receberCompraItensLocal(cfg, {
          compra_id: input.compra_id,
          itens: input.itens.map((i) => ({ item_id: i.item_id, quantidade: i.quantidade })),
          data_recebimento: input.data_recebimento,
          gerar_financeiro: input.gerar_financeiro,
          data_vencimento: input.data_vencimento ?? undefined,
        }, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "compras", method: "receberItens", fallback: false });
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return { compra_id: r.compra_id, local: true } as any;
        }
      }
      const result = await cloudAdapter.compras.receberItens(input);
      reportDataSource({ source: "cloud", domain: "compras", method: "receberItens", fallback: true });
      return result;
    },
    excluir: async (compraId) => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const r = await excluirCompraLocal(cfg, { compra_id: compraId }, token);
        if (r) {
          reportDataSource({ source: "local-server", domain: "compras", method: "excluir", fallback: false });
          return;
        }
      }
      await cloudAdapter.compras.excluir(compraId);
      reportDataSource({ source: "cloud", domain: "compras", method: "excluir", fallback: true });
    },
  },

  /**
   * Dashboard (v17 — Fase 6): agrega os KPIs a partir dos caches locais já
   * existentes (vendas_remote_cache, compras_local,
   * financeiro_lancamentos_local, produtos_local + estoque). Se QUALQUER
   * leitura local falhar (sem servidor / offline / cache vazio) caímos
   * inteiro no cloudAdapter — não montamos KPIs parciais. `kpiDetalhe`
   * continua direto na nuvem nesta fase.
   */
  dashboard: {
    ...cloudAdapter.dashboard,
    carregar: () =>
      withFallback(
        "dashboard",
        "carregar",
        async () => {
          const baseUrl = getServerBaseUrl();
          if (!baseUrl) return null;

          const [vendasRaw, comprasRaw, lancamentosRaw, produtosRaw, saldosRaw] =
            await Promise.all([
              tryLocal<Array<Record<string, unknown>>>(
                "vendas_remote",
                "list",
                "/api/vendas/historico",
                { limit: "500" },
              ),
              tryLocal<Array<Record<string, unknown>>>(
                "compras",
                "list",
                "/api/compras",
                { limit: "500" },
              ),
              tryLocal<Array<Record<string, unknown>>>(
                "financeiro_lancamentos_completo",
                "listLancamentosCompleto",
                "/api/financeiro/lancamentos-completo",
              ),
              tryLocal<Array<Record<string, unknown>>>(
                "produtos",
                "list",
                "/api/produtos/list",
                { status: "ativo" },
              ),
              tryLocal<
                Array<{
                  produto_id: string;
                  tipo: string;
                  quantidade: number | string;
                }>
              >("estoque", "saldosLinhas", "/api/estoque/saldos"),
            ]);

          const dash = buildDashboardFromRaw({
            vendas: vendasRaw,
            compras: comprasRaw,
            lancamentos: lancamentosRaw,
            produtos: produtosRaw,
            saldos: saldosRaw,
          });
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug("[LOCAL_DASHBOARD] terminal carregar", {
              ok: dash != null,
              vendasMes: dash?.vendasMes,
              contasReceber: dash?.contasReceber,
              contasPagar: dash?.contasPagar,
            });
          }
          return dash;
        },
        () => cloudAdapter.dashboard.carregar(),
      ),
  },


  /**
   * Relatórios (v17 — Fase 7): leitura offline-first dos relatórios que
   * podem ser derivados dos caches locais já existentes
   * (vendas_remote_cache, compras_local, financeiro_lancamentos_local,
   * produtos_local + estoque). Métodos que dependem de tabelas ainda não
   * cacheadas (caixa, pagamentos da empresa, funcionários, terminais,
   * notas fiscais) seguem direto na nuvem via spread do cloud.
   */
  relatorios: {
    ...cloudAdapter.relatorios,

    fluxoCaixa: ({ inicio, fim }) =>
      withFallback(
        "relatorios",
        "fluxoCaixa",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "financeiro_lancamentos_completo",
            "listLancamentosCompleto",
            "/api/financeiro/lancamentos-completo",
          );
          if (!Array.isArray(raw)) return null;
          return raw
            .filter((l) => {
              const dv = l.data_vencimento as string | null;
              return dv != null && dv >= inicio && dv <= fim;
            })
            .sort((a, b) =>
              String(b.data_vencimento).localeCompare(String(a.data_vencimento)),
            )
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
      withFallback(
        "relatorios",
        "compras",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "compras",
            "list",
            "/api/compras",
            { limit: "500" },
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
              fornecedor:
                (c.fornecedor as { razao_social?: string } | null)
                  ?.razao_social ?? "—",
              total: Number(c.total) || 0,
              status: String(c.status ?? ""),
            }));
        },
        () => cloudAdapter.relatorios.compras({ inicio, fim }),
      ),

    cardVendas: () =>
      withFallback(
        "relatorios",
        "cardVendas",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "vendas_remote",
            "list",
            "/api/vendas/historico",
            { limit: "1000" },
          );
          if (!Array.isArray(raw)) return null;
          return raw.map((v) => ({
            numero: String(v.numero ?? ""),
            data: String(v.data_emissao ?? ""),
            cliente:
              (v.cliente as { nome?: string } | null)?.nome ?? "Consumidor",
            forma: (v.forma_pagamento as string) ?? "",
            total: Number(v.total) || 0,
            status: String(v.status ?? ""),
            pagamento: String(v.status_pagamento ?? ""),
          }));
        },
        () => cloudAdapter.relatorios.cardVendas(),
      ),

    cardCompras: () =>
      withFallback(
        "relatorios",
        "cardCompras",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "compras",
            "list",
            "/api/compras",
            { limit: "1000" },
          );
          if (!Array.isArray(raw)) return null;
          return raw.map((c) => ({
            numero: String(c.numero ?? ""),
            data: String(c.data_emissao ?? ""),
            fornecedor:
              (c.fornecedor as { razao_social?: string } | null)
                ?.razao_social ?? "—",
            total: Number(c.total) || 0,
            status: String(c.status ?? ""),
          }));
        },
        () => cloudAdapter.relatorios.cardCompras(),
      ),

    notasFiscais: ({ inicio, fim }) =>
      withFallback(
        "relatorios",
        "notasFiscais",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "vendas_remote",
            "list",
            "/api/vendas/historico",
            { limit: "1000" },
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
      withFallback(
        "relatorios",
        "cardNotasFiscais",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "vendas_remote",
            "list",
            "/api/vendas/historico",
            { limit: "1000" },
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
      withFallback(
        "relatorios",
        "cardCaixas",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "caixas_remote",
            "list",
            "/api/relatorios/caixas",
            { limit: "1000" },
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
      withFallback(
        "relatorios",
        "caixasSessoes",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "caixas_remote",
            "list",
            "/api/relatorios/caixas",
            { limit: "1000" },
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
        () =>
          cloudAdapter.relatorios.caixasSessoes({
            iniIso,
            fimIso,
            operadorId,
            terminalId,
            status,
          }),
      ),

    caixaMovimentos: (caixaId) =>
      withFallback(
        "relatorios",
        "caixaMovimentos",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "caixa_movimentos_remote",
            "list",
            "/api/relatorios/caixa-movimentos",
            { caixa_id: caixaId },
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
      withFallback(
        "relatorios",
        "funcionariosAtivos",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "funcionarios_remote",
            "list",
            "/api/relatorios/funcionarios-ativos",
          );
          if (!Array.isArray(raw)) return null;
          return raw.map((f) => ({ id: String(f.id), nome: String(f.nome ?? "") }));
        },
        () => cloudAdapter.relatorios.funcionariosAtivos(),
      ),

    terminaisAtivos: () =>
      withFallback(
        "relatorios",
        "terminaisAtivos",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "terminais_remote",
            "list",
            "/api/relatorios/terminais-ativos",
          );
          if (!Array.isArray(raw)) return null;
          return raw.map((t) => ({ id: String(t.id), nome: String(t.nome ?? "") }));
        },
        () => cloudAdapter.relatorios.terminaisAtivos(),
      ),

    pagamentosEmpresa: () =>
      withFallback(
        "relatorios",
        "pagamentosEmpresa",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "pagamentos_empresa_remote",
            "list",
            "/api/relatorios/pagamentos-empresa",
            { limit: "200" },
          );
          if (!Array.isArray(raw)) return null;
          return raw as unknown as Awaited<
            ReturnType<typeof cloudAdapter.relatorios.pagamentosEmpresa>
          >;
        },
        () => cloudAdapter.relatorios.pagamentosEmpresa(),
      ),

    produtosVendidosPeriodo: ({ inicio, fim }) =>
      withFallback(
        "relatorios",
        "produtosVendidosPeriodo",
        async () => {
          if (import.meta.env.DEV) {
            console.log("[PRODUTOS_VENDIDOS] local-terminal query", { inicio, fim });
          }
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "venda_itens_remote",
            "list",
            "/api/relatorios/venda-itens",
            { inicio, fim },
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
                produtoNome:
                  (produto?.nome as string) ?? (it.descricao as string) ?? "—",
                produtoSku: (produto?.sku as string) ?? "",
                categoriaId: (produto?.categoria_id as string) ?? null,
                precoCusto: Number(produto?.preco_custo) || 0,
                quantidade: Number(it.quantidade) || 0,
                precoUnitario: Number(it.preco_unitario) || 0,
                total: Number(it.total) || 0,
              };
            })
            .filter((r) => {
              if (r.dataEmissao && (r.dataEmissao < inicio || r.dataEmissao > fim)) return false;
              if (r.vendaStatus === "cancelada" || r.vendaStatus === "rascunho") return false;
              return true;
            });
          if (import.meta.env.DEV) {
            console.log("[PRODUTOS_VENDIDOS] local-terminal result", {
              itens: mapped.length,
              origem: "local-terminal",
            });
          }
          return mapped;
        },
        () => cloudAdapter.relatorios.produtosVendidosPeriodo({ inicio, fim }),
      ),

    cardFluxoCaixa: () =>
      withFallback(
        "relatorios",
        "cardFluxoCaixa",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "financeiro_lancamentos_completo",
            "listLancamentosCompleto",
            "/api/financeiro/lancamentos-completo",
          );
          if (!Array.isArray(raw)) return null;
          return [...raw]
            .sort((a, b) =>
              String(b.data_vencimento ?? "").localeCompare(
                String(a.data_vencimento ?? ""),
              ),
            )
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
      withFallback(
        "relatorios",
        "cardFinanceiro",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "financeiro_lancamentos_completo",
            "listLancamentosCompleto",
            "/api/financeiro/lancamentos-completo",
          );
          if (!Array.isArray(raw)) return null;
          return raw
            .filter((l) => l.status !== "cancelado")
            .map((l) => {
              const cli = l.cliente as { id?: string; nome?: string } | null;
              const forn = l.fornecedor as
                | { razao_social?: string; nome_fantasia?: string }
                | null;
              return {
                id: String(l.id),
                descricao: String(l.descricao ?? ""),
                tipo: l.tipo as "receita" | "despesa",
                valor: Number(l.valor) || 0,
                valor_pago: Number(l.valor_pago) || 0,
                data_emissao: String(l.data_emissao ?? ""),
                data_vencimento: String(l.data_vencimento ?? ""),
                data_pagamento: (l.data_pagamento as string) ?? null,
                status: l.status as
                  | "pago"
                  | "pendente"
                  | "atrasado"
                  | "cancelado",
                forma_pagamento: (l.forma_pagamento as string) ?? null,
                categoria_id: (l.categoria_id as string) ?? null,
                categoria_nome:
                  (l.categoria as { nome?: string } | null)?.nome ?? null,
                cliente_id: (l.cliente_id as string) ?? cli?.id ?? null,
                cliente_nome: cli?.nome ?? null,
                fornecedor_id: null,
                fornecedor_nome:
                  forn?.nome_fantasia ?? forn?.razao_social ?? null,
              };
            });
        },
        () => cloudAdapter.relatorios.cardFinanceiro(),
      ),

    lancamentosFinanceiroPeriodo: ({ inicio, fim }) =>
      withFallback(
        "relatorios",
        "lancamentosFinanceiroPeriodo",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "financeiro_lancamentos_completo",
            "listLancamentosCompleto",
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
              const forn = l.fornecedor as
                | { razao_social?: string; nome_fantasia?: string }
                | null;
              return {
                id: String(l.id),
                descricao: String(l.descricao ?? ""),
                tipo: l.tipo as "receita" | "despesa",
                valor: Number(l.valor) || 0,
                valor_pago: Number(l.valor_pago) || 0,
                data_emissao: String(l.data_emissao ?? ""),
                data_vencimento: String(l.data_vencimento ?? ""),
                data_pagamento: (l.data_pagamento as string) ?? null,
                status: l.status as
                  | "pago"
                  | "pendente"
                  | "atrasado"
                  | "cancelado",
                forma_pagamento: (l.forma_pagamento as string) ?? null,
                categoria_id: (l.categoria_id as string) ?? null,
                categoria_nome:
                  (l.categoria as { nome?: string } | null)?.nome ?? null,
                cliente_id: (l.cliente_id as string) ?? cli?.id ?? null,
                cliente_nome: cli?.nome ?? null,
                fornecedor_id: null,
                fornecedor_nome:
                  forn?.nome_fantasia ?? forn?.razao_social ?? null,
              };
            });
        },
        () =>
          cloudAdapter.relatorios.lancamentosFinanceiroPeriodo({ inicio, fim }),
      ),

    saldoAcumuladoFinanceiro: () =>
      withFallback(
        "relatorios",
        "saldoAcumuladoFinanceiro",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "financeiro_lancamentos_completo",
            "listLancamentosCompleto",
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
      withFallback(
        "relatorios",
        "clientesOpcoes",
        async () => {
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "clientes",
            "list",
            "/api/clientes",
            { status: "" },
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
      withFallback(
        "relatorios",
        "clientesPorIds",
        async () => {
          if (!ids.length) return [];
          const raw = await tryLocal<Array<Record<string, unknown>>>(
            "clientes",
            "list",
            "/api/clientes",
            { status: "" },
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
      withFallback(
        "relatorios",
        "estoqueBase",
        async () => {
          const [prodRaw, movRaw] = await Promise.all([
            tryLocal<Array<Record<string, unknown>>>(
              "produtos",
              "list",
              "/api/produtos/list",
              { status: "ativo" },
            ),
            tryLocal<
              Array<{
                produto_id: string;
                tipo: string;
                quantidade: number | string;
              }>
            >("estoque", "saldosLinhas", "/api/estoque/saldos"),
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
      withFallback(
        "relatorios",
        "dreTotais",
        async () => {
          const [vendasRaw, lancRaw] = await Promise.all([
            tryLocal<Array<Record<string, unknown>>>(
              "vendas_remote",
              "list",
              "/api/vendas/historico",
              { limit: "1000" },
            ),
            tryLocal<Array<Record<string, unknown>>>(
              "financeiro_lancamentos_completo",
              "listLancamentosCompleto",
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

  caixa: {
    ...cloudAdapter.caixa,
    /**
     * WRITE LOCAL: abertura/sangria/suprimento/fechamento vão PRIMEIRO ao
     * servidor local (SQLite + outbox). Em modo terminal local, erro de cloud
     * nunca entra no clique: falha local bloqueia; sync cloud fica na outbox.
     *
     * Idempotência:
     *  - `client_uuid` (1 por modal/operação) impede duplicar entre cliques.
     *  - O servidor local gera/reusa um `local_uuid` estável que vira o
     *    `_client_uuid` da RPC upstream (movimento). Para abrir/fechar a
     *    chave única do caixa (terminal_id / caixa_id) protege a nuvem.
     */
    abrir: async (input: AbrirCaixaInput): Promise<string> => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        console.info("[CAIXA_LOCAL] abertura local iniciada");
        const local = await abrirCaixaLocal(
          cfg,
          {
            valor_inicial: input.valor_inicial,
            observacao: input.observacao ?? null,
            operador_id: input.operador_id ?? null,
            terminal_id: input.terminal_id ?? null,
            client_uuid:
              (input as AbrirCaixaInput & { client_uuid?: string | null })
                .client_uuid ?? null,
          },
        );
        if (local) {
          console.info("[CAIXA_LOCAL] persistido SQLite", { caixa_id: local.caixa_id });
          if (local.outbox_status === "pending" || local.outbox_status === "sending") {
            console.info("[CAIXA_OUTBOX] item criado", { caixa_id: local.caixa_id });
            console.info("[CAIXA_SYNC] aguardando internet");
          } else if (local.outbox_status === "sent") {
            console.info("[CAIXA_SYNC] sincronizado");
          }
          reportDataSource({
            source: "local-server",
            domain: "caixa",
            method: "abrir",
            fallback: false,
          });
          return local.remote_id ?? local.caixa_id;
        }
        throw new Error("Não foi possível abrir o caixa no servidor local. Tente novamente.");
      }
      throw new Error("Servidor local indisponível. Não foi possível abrir o caixa no SQLite.");
    },

    registrarMovimento: async (
      input: RegistrarMovimentoCaixaInput,
    ): Promise<string> => {
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const local = await registrarMovCaixaLocal(
          cfg,
          {
            caixa_id: input.caixa_id,
            tipo: input.tipo,
            valor: input.valor,
            motivo: input.motivo ?? null,
            client_uuid: input.client_uuid ?? null,
          },
          token,
        );
        if (local) {
          reportDataSource({
            source: "local-server",
            domain: "caixa",
            method: "registrarMovimento",
            fallback: false,
          });
          return local.remote_id ?? local.movimento_id;
        }
      }
      const result = await cloudAdapter.caixa.registrarMovimento(input);
      reportDataSource({
        source: "cloud", domain: "caixa", method: "registrarMovimento", fallback: true,
      });
      return result;
    },

    fechar: async (input: FecharCaixaInput): Promise<FecharCaixaResult> => {
      const online = typeof navigator === "undefined" ? true : navigator.onLine;
      const cfg = getDesktopConfig().terminal;
      const baseUrl = getBaseUrl(cfg);
      if (import.meta.env.DEV) {
        console.info("[CAIXA_FECHAR] iniciado", {
          modo: baseUrl ? "local-terminal" : "cloud",
          online,
        });
      }
      if (baseUrl) {
        if (import.meta.env.DEV) console.info("[CAIXA_FECHAR_LOCAL] gravando SQLite (LAN)");
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
        const local = await fecharCaixaLocal(
          cfg,
          {
            caixa_id: input.caixa_id,
            valor_informado: input.valor_informado,
            observacao: input.observacao ?? null,
            client_uuid:
              (input as FecharCaixaInput & { client_uuid?: string | null })
                .client_uuid ?? null,
          },
          token,
        );
        if (local) {
          if (import.meta.env.DEV) {
            console.info("[CAIXA_FECHAR_LOCAL] auditoria criada");
            if (local.outbox_status === "pending" || local.outbox_status === "sending") {
              console.info("[CAIXA_FECHAR_OUTBOX] criado");
            }
            console.info("[CAIXA_FECHAR_OK] fechado offline", { online });
          }
          reportDataSource({
            source: "local-server",
            domain: "caixa",
            method: "fechar",
            fallback: false,
          });
          // Só consulta cloud quando online + já sincronizado. Nunca trava o fechamento offline.
          if (online && local.outbox_status === "sent" && local.remote_id) {
            try {
              return await cloudAdapter.caixa.fechar(input);
            } catch {
              /* fallback abaixo */
            }
          }
          return {
            caixa_id: local.remote_id ?? input.caixa_id,
            valor_esperado: input.valor_informado,
            valor_informado: local.valor_informado,
            diferenca: 0,
            fechado_em: new Date().toISOString(),
          };
        }
        if (!online) {
          if (import.meta.env.DEV) console.warn("[CAIXA_FECHAR_ERRO] offline e servidor LAN indisponível");
          throw new Error("Sem conexão com o servidor local. Verifique a rede LAN para fechar o caixa.");
        }
      } else if (!online) {
        if (import.meta.env.DEV) console.warn("[CAIXA_FECHAR_ERRO] offline sem servidor LAN configurado");
        throw new Error("Sem conexão com a internet e sem servidor local. Não foi possível fechar o caixa.");
      }
      if (import.meta.env.DEV) console.info("[CAIXA_FECHAR] fallback cloud");
      const result = await cloudAdapter.caixa.fechar(input);
      reportDataSource({
        source: "cloud", domain: "caixa", method: "fechar", fallback: true,
      });
      return result;
    },
  },
};
