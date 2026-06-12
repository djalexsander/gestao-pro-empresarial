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
  cancelarVendaLocal,
  fecharCaixaLocal,
  fetchCaixaHistoricoLocal,
  fetchCaixaLocalAberto,
  fetchCaixaMovimentosLocal,
  fetchCaixaResumoLocal,
  getBaseUrl,
  pingServidorLocal,
  registrarMovCaixaLocal,
  registrarMovimentoLocal,
  registrarVendaLocal,
} from "@/integrations/desktop/serverConnection";
import type {
  AbrirCaixaInput,
  CategoriaProdutoDomain,
  FecharCaixaInput,
  FecharCaixaResult,
  ProdutoComVariacoes,
  RegistrarMovimentoCaixaInput,
} from "../types";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";

const HTTP_TIMEOUT_MS = 4000;
const DEFAULT_LOCAL_PORT = 3333;

class LocalServerIndisponivelError extends Error {
  code = "LOCAL_SERVER_UNAVAILABLE";

  constructor(operacao: string) {
    super(
      `Servidor local indisponivel para ${operacao}. Verifique a conexao local e tente novamente.`,
    );
    this.name = "LocalServerIndisponivelError";
  }
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

function getLocalConnectionConfig(): TerminalConexaoConfig | undefined {
  const cfg = getDesktopConfig();
  if (cfg.role === "server") {
    return {
      host: "127.0.0.1",
      porta: cfg.terminal?.porta ?? DEFAULT_LOCAL_PORT,
      terminalId: "self",
      terminalNome: cfg.serverNome ?? "Servidor",
    };
  }
  return cfg.terminal;
}

function getServerBaseUrl(): string | null {
  return getBaseUrl(getLocalConnectionConfig());
}

function localUnavailable<T>(domain: string, method: string): T {
  reportDataSource({ source: "local-server", domain, method, fallback: false });
  throw new LocalServerIndisponivelError(`${domain}.${method}`);
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

async function postLocal<T>(
  domain: string,
  method: string,
  path: string,
  body: unknown,
): Promise<T> {
  const baseUrl = getServerBaseUrl();
  if (!baseUrl) return localUnavailable<T>(domain, method);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${baseUrl}${path}`, {
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
    reportDataSource({
      source: "local-server",
      domain,
      method,
      fallback: false,
    });
    return json && typeof json === "object" && "data" in (json as any)
      ? ((json as any).data as T)
      : (json as T);
  } catch (error) {
    clearTimeout(timer);
    if (error instanceof LocalServerIndisponivelError) throw error;
    return localUnavailable<T>(domain, method);
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
  const map = new Map<string, CategoriaProdutoDomain>();
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

async function listCategoriasProduto(input?: Parameters<DataAdapter["categoriasProduto"]["list"]>[0]) {
  try {
    const categorias = await cloudAdapter.categoriasProduto.list(input);
    console.info("[categorias-produto] LISTAR CATEGORIAS", {
      adapter: "local-terminal",
      source: "cloud",
      total: categorias.length,
    });
    return categorias;
  } catch (error) {
    console.warn("[categorias-produto] LISTAR CATEGORIAS fallback local-produtos", {
      adapter: "local-terminal",
      error,
    });
    const produtos = await localTerminalAdapter.produtos.listar();
    return categoriasFromProdutos(produtos as unknown as ProdutoComVariacoes[]);
  }
}

async function assertLocalServerReady(
  cfg: TerminalConexaoConfig | undefined,
  operation: string,
): Promise<void> {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const health = await pingServidorLocal(cfg);
    if (health.status === "online") return;
    console.warn("[local-terminal-adapter] health fail before critical operation", {
      operation,
      attempt,
      status: health.status,
      baseUrl: health.baseUrl,
      message: health.mensagem ?? null,
    });
  }
  throw new Error(
    "Servidor local não está pronto. Reinicie o servidor local em Configurações → Desktop.",
  );
}

type CaixaLocalRow = Awaited<ReturnType<typeof fetchCaixaHistoricoLocal>>[number];
type CaixaResumoLocalRow = NonNullable<Awaited<ReturnType<typeof fetchCaixaResumoLocal>>>;
type CaixaMovimentoLocal = Awaited<ReturnType<typeof fetchCaixaMovimentosLocal>>[number];

function caixaLocalToDomain(
  local: CaixaLocalRow,
  resumo?: CaixaResumoLocalRow | null,
): Awaited<ReturnType<DataAdapter["caixa"]["historico"]>>[number] {
  const dataAbertura = new Date(local.data_abertura_ms).toISOString();
  const dataFechamento =
    local.data_fechamento_ms != null
      ? new Date(local.data_fechamento_ms).toISOString()
      : null;
  const porForma = new Map(
    (resumo?.por_forma ?? []).map((row) => [row.forma_pagamento, Number(row.total) || 0]),
  );
  return {
    id: local.remote_id ?? local.local_uuid,
    owner_id: "",
    usuario_id: "",
    operador_id: local.operador_id,
    data_abertura: dataAbertura,
    data_fechamento: dataFechamento,
    valor_inicial: Number(local.valor_inicial) || 0,
    total_vendas: Number(resumo?.total_vendido) || 0,
    qtd_vendas: Number(resumo?.qtd_vendas) || 0,
    total_dinheiro: porForma.get("dinheiro") ?? 0,
    total_pix: porForma.get("pix") ?? 0,
    total_debito: porForma.get("debito") ?? 0,
    total_credito: porForma.get("credito") ?? 0,
    total_boleto: porForma.get("boleto") ?? 0,
    total_ifood: porForma.get("ifood") ?? 0,
    total_fiado: porForma.get("fiado") ?? 0,
    total_outros: porForma.get("outros") ?? 0,
    total_sangrias: Number(local.total_sangrias) || 0,
    total_suprimentos: Number(local.total_suprimentos) || 0,
    valor_esperado: resumo?.valor_esperado_dinheiro ?? local.valor_esperado,
    valor_informado: local.valor_informado,
    diferenca: local.diferenca,
    status: local.status,
    observacao: local.observacao_abertura,
    observacao_fechamento: local.observacao_fechamento,
    created_at: dataAbertura,
    updated_at: dataFechamento ?? dataAbertura,
  };
}

function caixaMovimentoLocalToDomain(
  local: CaixaMovimentoLocal,
): Awaited<ReturnType<DataAdapter["caixa"]["movimentos"]>>[number] {
  return {
    id: local.remote_id ?? local.local_uuid,
    caixa_id: local.caixa_local_uuid,
    tipo: local.tipo,
    valor: Number(local.valor) || 0,
    motivo: local.motivo,
    venda_id: null,
    usuario_id: null,
    operador_id: local.operador_id,
    created_at: new Date(local.created_at_ms).toISOString(),
  };
}

// ----------------------------------------------------------------------------
// Adapter
// ----------------------------------------------------------------------------

export const localTerminalAdapter: DataAdapter = {
  ...cloudAdapter,

  produtos: {
    ...cloudAdapter.produtos,
    listar: () =>
      withFallback(
        "produtos",
        "listar",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["produtos"]["listar"]>>>(
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
    get: (produtoId) =>
      cloudOnly("produtos", "get", () => cloudAdapter.produtos.get(produtoId)),
    buscarPorCodigo: (codigo) =>
      withFallback(
        "produtos",
        "buscarPorCodigo",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["produtos"]["buscarPorCodigo"]>>>(
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
          tryLocal<Awaited<ReturnType<DataAdapter["produtos"]["buscarPorPlu"]>>>(
            "produtos",
            "buscarPorPlu",
            "/api/produtos/buscar",
            { codigo: plu },
          ),
        () => cloudAdapter.produtos.buscarPorPlu(plu),
      ),
    criar: (input) =>
      cloudOnly("produtos", "criar", () => cloudAdapter.produtos.criar(input)),
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
    list: listCategoriasProduto,
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
      const cfg = getLocalConnectionConfig();
      if (getBaseUrl(cfg)) {
        await assertLocalServerReady(cfg, "estoque.registrarMovimento");
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
        return localUnavailable("estoque", "registrarMovimento");
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
      const cfg = getLocalConnectionConfig();
      if (getBaseUrl(cfg)) {
        await assertLocalServerReady(cfg, "caixa.fechar");
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token ?? null;
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
            data_vencimento: input.data_vencimento ?? null,
          },
          token,
        );
        if (local) {
          reportDataSource({
            source: "local-server",
            domain: "vendas",
            method: "finalizar",
            fallback: false,
          });
          // Quando upstream entregou, preferimos o id remoto (consistência
          // com o que o cloud devolveria). Em pendente, devolvemos o
          // local_uuid — o PDV consegue exibir cupom mesmo offline.
          return local.remote_id ?? local.venda_id;
        }
        return localUnavailable("vendas", "finalizar");
      }
      // Fallback cloud — mantém o app funcional sem servidor local.
      const result = await cloudAdapter.vendas.finalizar(input);
      reportDataSource({
        source: "cloud",
        domain: "vendas",
        method: "finalizar",
        fallback: true,
      });
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
      const cfg = getLocalConnectionConfig();
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
          /* erro tratado abaixo como indisponibilidade local */
        }
        return localUnavailable("vendas", "cancelar");
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
    criar: (input) => {
      if (getServerBaseUrl()) {
        return postLocal<Awaited<ReturnType<DataAdapter["clientes"]["criar"]>>>(
          "clientes",
          "criar",
          "/api/clientes/criar",
          input,
        );
      }
      return cloudOnly("clientes", "criar", () => cloudAdapter.clientes.criar(input));
    },
    editar: (input) =>
      cloudOnly("clientes", "editar", () => cloudAdapter.clientes.editar(input)),
    alterarStatus: (input) =>
      cloudOnly("clientes", "alterarStatus", () =>
        cloudAdapter.clientes.alterarStatus(input),
      ),
    excluir: (clienteId) =>
      cloudOnly("clientes", "excluir", () => cloudAdapter.clientes.excluir(clienteId)),
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
    metricas: async () => new Map(),
    historico: async () => [],
    checkDocumentoDuplicado: async (documento, ignoreId) => {
      const clientes = await cloudAdapter.clientes.list({ status: null });
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
    /**
     * WRITE LOCAL: abertura/sangria/suprimento/fechamento vão PRIMEIRO ao
     * servidor local (SQLite + outbox). Se o servidor local não responde,
     * caímos no cloudAdapter — comportamento legado preservado.
     *
     * Idempotência:
     *  - `client_uuid` (1 por modal/operação) impede duplicar entre cliques.
     *  - O servidor local gera/reusa um `local_uuid` estável que vira o
     *    `_client_uuid` da RPC upstream (movimento). Para abrir/fechar a
     *    chave única do caixa (terminal_id / caixa_id) protege a nuvem.
     */
    abrir: async (input: AbrirCaixaInput): Promise<string> => {
      const cfg = getLocalConnectionConfig();
      if (!getBaseUrl(cfg)) return localUnavailable("caixa", "abrir");

      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token ?? null;
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
        token,
      );
      if (local) {
        reportDataSource({
          source: "local-server",
          domain: "caixa",
          method: "abrir",
          fallback: false,
        });
        return local.remote_id ?? local.caixa_id;
      }
      return localUnavailable("caixa", "abrir");
    },

    registrarMovimento: async (
      input: RegistrarMovimentoCaixaInput,
    ): Promise<string> => {
      const cfg = getLocalConnectionConfig();
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
        return localUnavailable("caixa", "registrarMovimento");
      }
      const result = await cloudAdapter.caixa.registrarMovimento(input);
      reportDataSource({
        source: "cloud", domain: "caixa", method: "registrarMovimento", fallback: true,
      });
      return result;
    },

    fechar: async (input: FecharCaixaInput): Promise<FecharCaixaResult> => {
      const cfg = getLocalConnectionConfig();
      if (getBaseUrl(cfg)) {
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
          reportDataSource({
            source: "local-server",
            domain: "caixa",
            method: "fechar",
            fallback: false,
          });
          // Se ainda pendente, devolvemos um resultado provisório válido
          // para a UI (a confirmação real virá quando o cloud responder).
          if (local.outbox_status === "sent" && local.remote_id) {
            // Best-effort: pega o resumo real da nuvem se possível.
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
        return localUnavailable("caixa", "fechar");
      }
      const result = await cloudAdapter.caixa.fechar(input);
      reportDataSource({
        source: "cloud", domain: "caixa", method: "fechar", fallback: true,
      });
      return result;
    },
    aberto: async (filtro) => {
      const cfg = getLocalConnectionConfig();
      const local = await fetchCaixaLocalAberto(
        cfg,
        filtro?.qualquer ? undefined : filtro?.operador_id,
      );
      if (!local) return null;
      reportDataSource({
        source: "local-server",
        domain: "caixa",
        method: "aberto",
        fallback: false,
      });
      const resumo = await fetchCaixaResumoLocal(cfg, { caixaId: local.local_uuid });
      return caixaLocalToDomain(local, resumo);
    },
    resumo: async (caixaId) => {
      const cfg = getLocalConnectionConfig();
      const local = await fetchCaixaResumoLocal(cfg, { caixaId });
      if (!local) return null;
      reportDataSource({
        source: "local-server",
        domain: "caixa",
        method: "resumo",
        fallback: false,
      });
      const porForma = new Map(
        local.por_forma.map((row) => [row.forma_pagamento, Number(row.total) || 0]),
      );
      return {
        caixa_id: local.remote_id ?? local.caixa_local_uuid,
        status: local.status,
        data_abertura: new Date(local.data_abertura_ms).toISOString(),
        data_fechamento:
          local.data_fechamento_ms != null
            ? new Date(local.data_fechamento_ms).toISOString()
            : null,
        valor_inicial: Number(local.valor_inicial) || 0,
        qtd_vendas: Number(local.qtd_vendas) || 0,
        total_vendas: Number(local.total_vendido) || 0,
        total_dinheiro: porForma.get("dinheiro") ?? 0,
        total_pix: porForma.get("pix") ?? 0,
        total_debito: porForma.get("debito") ?? 0,
        total_credito: porForma.get("credito") ?? 0,
        total_boleto: porForma.get("boleto") ?? 0,
        total_ifood: porForma.get("ifood") ?? 0,
        total_fiado: porForma.get("fiado") ?? 0,
        total_outros: porForma.get("outros") ?? 0,
        total_sangrias: Number(local.total_sangrias) || 0,
        total_suprimentos: Number(local.total_suprimentos) || 0,
        valor_esperado: Number(local.valor_esperado_dinheiro) || 0,
        valor_informado: local.valor_informado,
        diferenca: local.diferenca,
      };
    },
    historico: async (input) => {
      const cfg = getLocalConnectionConfig();
      const rows = await fetchCaixaHistoricoLocal(cfg, input?.limit);
      reportDataSource({
        source: "local-server",
        domain: "caixa",
        method: "historico",
        fallback: false,
      });
      return Promise.all(
        rows.map(async (row) => {
          const resumo = await fetchCaixaResumoLocal(cfg, { caixaId: row.local_uuid });
          return caixaLocalToDomain(row, resumo);
        }),
      );
    },
    movimentos: async (caixaId) => {
      const cfg = getLocalConnectionConfig();
      const rows = await fetchCaixaMovimentosLocal(cfg, caixaId);
      reportDataSource({
        source: "local-server",
        domain: "caixa",
        method: "movimentos",
        fallback: false,
      });
      return rows.map(caixaMovimentoLocalToDomain);
    },
  },
};
