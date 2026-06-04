/**
 * ============================================================================
 * local-terminal adapter — Terminal cliente conectado ao Servidor Local
 * ============================================================================
 *
 * Política anti split-brain (PROMPT 6):
 *
 *  - LEITURAS (produtos/clientes/estoque listagens, movimentações): podem
 *    cair para cloud em caso de falha do servidor local. São operações
 *    seguras — apenas mostram dados na tela, sem alterar caixa/estoque.
 *    Permanecem com `withFallback(... cloud)`.
 *
 *  - OPERAÇÕES CRÍTICAS (finalizar/cancelar venda, abrir/fechar caixa,
 *    sangria/suprimento, movimentação de estoque): NUNCA caem para cloud
 *    automaticamente quando o terminal está em modo "local-terminal".
 *    Se o servidor local estiver indisponível, a operação é BLOQUEADA
 *    com mensagem clara, evitando divergência entre SQLite local e
 *    Supabase (vendas/caixa/estoque que ficariam órfãos).
 *
 *  - O modo "cloud puro" não passa por este adapter — o `dataClient`
 *    resolve direto para `cloudAdapter`. Web/cloud continua funcionando.
 */

import { supabase } from "@/integrations/supabase/client";
import type { DataAdapter } from "../adapter";
import type {
  CancelarVendaInput,
  CancelarVendaResumo,
  FinalizarVendaInput,
  ProdutoComVariacoes,
  RegistrarMovimentoEstoqueInput,
  RegistrarMovimentoEstoqueResult,
} from "../types";
import type { ProdutoComCategoria } from "../types";
import { cloudAdapter } from "./cloud";
import { reportDataSource } from "../source-telemetry";
import { getDesktopConfig } from "@/integrations/desktop/configStore";
import type { TerminalConexaoConfig } from "@/integrations/desktop/types";
import { isDesktop } from "../mode";
import {
  cacheDesktopFuncionarios,
  loadDesktopFuncionariosAtivos,
  saveDesktopFuncionarioPin,
  verifyDesktopFuncionarioPin,
} from "@/integrations/desktop/tauriBridge";
import {
  abrirCaixaLocal,
  cancelarVendaLocal,
  fecharCaixaLocal,
  getBaseUrl,
  registrarMovCaixaLocal,
  registrarMovimentoLocal,
  registrarVendaLocal,
  type CaixaLocalAbertoRow,
  type CaixaResumoLocal,
} from "@/integrations/desktop/serverConnection";
import type {
  AbrirCaixaInput,
  FecharCaixaInput,
  FecharCaixaResult,
  RegistrarMovimentoCaixaInput,
} from "../types";

const HTTP_TIMEOUT_MS = 4000;
const DEFAULT_LOCAL_PORT = 3333;

function getLocalConnectionConfig(): TerminalConexaoConfig | undefined {
  const cfg = getDesktopConfig();
  if (cfg.role === "server") {
    const port = cfg.terminal?.porta ?? DEFAULT_LOCAL_PORT;
    return {
      host: "127.0.0.1",
      porta: port,
      terminalId: "self",
      terminalNome: cfg.serverNome ?? "Servidor",
      serverToken: cfg.serverAuthToken,
    };
  }
  return cfg.terminal;
}

/**
 * Mensagem padronizada exibida ao operador quando o servidor local cai
 * e a operação crítica é bloqueada. Evita split-brain silencioso.
 */
const MSG_LOCAL_INDISPONIVEL =
  "Servidor local indisponível. Esta operação não será enviada direto para a nuvem para evitar divergência de caixa/estoque. Reconecte ao servidor local ou altere o modo de operação nas configurações.";

const MSG_BACKEND_LOCAL_INDISPONIVEL =
  "Backend local do servidor não respondeu. Verifique se o servidor local está iniciado e tente novamente.";

class LocalServerIndisponivelError extends Error {
  code = "LOCAL_SERVER_INDISPONIVEL" as const;
  constructor(public operacao: string, public role: "server" | "terminal" = "terminal") {
    super(role === "server" ? MSG_BACKEND_LOCAL_INDISPONIVEL : MSG_LOCAL_INDISPONIVEL);
    this.name = "LocalServerIndisponivelError";
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

/**
 * Garante que o terminal tem servidor local configurado antes de tentar
 * uma operação crítica. Caso contrário, bloqueia com mensagem clara.
 */
function requireLocalBaseUrl(operacao: string): string {
  const cfg = getLocalConnectionConfig();
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) {
    const role = getDesktopConfig().role === "server" ? "server" : "terminal";
    // Telemetria: registra a tentativa bloqueada (origem = local-terminal,
    // sem fallback — para o operador ver o badge correto).
    reportDataSource({
      source: role === "server" ? "local-server" : "local-terminal",
      domain: "guard",
      method: operacao,
      fallback: false,
    });
    throw new LocalServerIndisponivelError(operacao, role);
  }
  return baseUrl;
}

function localUnavailable(operacao: string): LocalServerIndisponivelError {
  const role = getDesktopConfig().role === "server" ? "server" : "terminal";
  return new LocalServerIndisponivelError(operacao, role);
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

function getServerBaseUrl(): string | null {
  return getBaseUrl(getLocalConnectionConfig());
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
  const baseUrl = requireLocalBaseUrl(`${domain}.${method}`);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const headers = await getAuthHeader();
    const res = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", ...headers },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `HTTP ${res.status}`);
    }
    reportDataSource({
      source: getDesktopConfig().role === "server" ? "local-server" : "local-terminal",
      domain,
      method,
      fallback: false,
    });
    return (await res.json()) as T;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw localUnavailable(`${domain}.${method}`);
  } finally {
    clearTimeout(timer);
  }
}

function mapFormaPagamentoValue(
  formas: Array<{ forma_pagamento: string; total: number }> ,
  chave: string,
): number {
  const found = formas.find((forma) => forma.forma_pagamento === chave);
  return found?.total ?? 0;
}

function mapCaixaResumoLocalToDomain(
  row: CaixaResumoLocal,
): import("../types").CaixaResumoDomain {
  return {
    caixa_id: row.remote_id ?? row.caixa_local_uuid,
    status: row.status,
    data_abertura: new Date(row.data_abertura_ms).toISOString(),
    data_fechamento: row.data_fechamento_ms
      ? new Date(row.data_fechamento_ms).toISOString()
      : null,
    valor_inicial: row.valor_inicial,
    qtd_vendas: row.qtd_vendas,
    total_vendas: row.total_vendido,
    total_dinheiro: mapFormaPagamentoValue(row.por_forma, "dinheiro"),
    total_pix: mapFormaPagamentoValue(row.por_forma, "pix"),
    total_debito: mapFormaPagamentoValue(row.por_forma, "debito"),
    total_credito: mapFormaPagamentoValue(row.por_forma, "credito"),
    total_boleto: mapFormaPagamentoValue(row.por_forma, "boleto"),
    total_ifood: mapFormaPagamentoValue(row.por_forma, "ifood"),
    total_fiado: mapFormaPagamentoValue(row.por_forma, "fiado"),
    total_outros:
      row.por_forma.reduce((sum, forma) => {
        const known = [
          "dinheiro",
          "pix",
          "debito",
          "credito",
          "boleto",
          "ifood",
          "fiado",
        ];
        return known.includes(forma.forma_pagamento)
          ? sum
          : sum + forma.total;
      }, 0) || 0,
    total_sangrias: row.total_sangrias,
    total_suprimentos: row.total_suprimentos,
    valor_esperado: row.valor_esperado_dinheiro,
    valor_informado: row.valor_informado,
    diferenca: row.diferenca ?? 0,
  };
}

type CaixaMovimentoLocalRow = {
  local_uuid: string;
  caixa_local_uuid: string;
  tipo: string;
  valor: number;
  motivo: string | null;
  operador_id: string | null;
  remote_id: string | null;
  created_at_ms: number;
};

function mapCaixaLocalToDomain(
  row: CaixaLocalAbertoRow,
  ownerId: string,
): import("../types").CaixaDomain {
  return {
    id: row.remote_id ?? row.local_uuid,
    owner_id: ownerId,
    usuario_id: ownerId,
    operador_id: row.operador_id,
    data_abertura: new Date(row.data_abertura_ms).toISOString(),
    data_fechamento: row.data_fechamento_ms
      ? new Date(row.data_fechamento_ms).toISOString()
      : null,
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
    total_sangrias: row.total_sangrias,
    total_suprimentos: row.total_suprimentos,
    valor_esperado: row.valor_esperado ?? 0,
    valor_informado: row.valor_informado,
    diferenca: row.diferenca ?? 0,
    status: row.status as import("../types").CaixaStatusDomain,
    observacao: row.observacao_abertura,
    observacao_fechamento: row.observacao_fechamento,
    created_at: new Date(row.data_abertura_ms).toISOString(),
    updated_at: row.data_fechamento_ms
      ? new Date(row.data_fechamento_ms).toISOString()
      : new Date(row.data_abertura_ms).toISOString(),
  };
}

function mapCaixaMovimentoLocalToDomain(
  row: CaixaMovimentoLocalRow,
): import("../types").CaixaMovimentoDomain {
  return {
    id: row.remote_id ?? row.local_uuid,
    caixa_id: row.remote_id ?? row.caixa_local_uuid,
    tipo: row.tipo as import("../types").CaixaMovimentoTipoDomain,
    valor: row.valor,
    motivo: row.motivo,
    venda_id: null,
    usuario_id: null,
    operador_id: row.operador_id,
    created_at: new Date(row.created_at_ms).toISOString(),
  };
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

/**
 * Leituras seguras: podem cair para cloud sem risco de divergência
 * (apenas dados de tela, sem mutar caixa/estoque/financeiro).
 */
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

async function tryDesktopFuncionariosList(
  input?: import("../types").FuncionariosListInput,
): Promise<import("../types").FuncionarioDomain[] | null> {
  if (!isDesktop()) return null;
  const rows = await loadDesktopFuncionariosAtivos();
  if (!rows || rows.length === 0) return null;
  const mapped = rows.map((row) => ({
    id: row.funcionario_id,
    nome: row.nome,
    login: row.login,
    role: row.role as "gerente" | "caixa",
    ativo: row.ativo,
    ultimo_acesso: null,
    created_at: new Date().toISOString(),
  }));
  if (input?.somente_ativos) {
    return mapped.filter((f) => f.ativo);
  }
  return mapped;
}

async function tryDesktopFuncionarioPin(
  funcionarioId: string,
  pin: string,
): Promise<import("../types").OperadorSessaoDomain | null> {
  if (!isDesktop()) return null;
  const row = await verifyDesktopFuncionarioPin(funcionarioId, pin);
  if (!row) return null;
  return {
    id: row.funcionario_id,
    nome: row.nome,
    login: row.login,
    role: row.role as "gerente" | "caixa",
  };
}

// ----------------------------------------------------------------------------
// Adapter
// ----------------------------------------------------------------------------

export const localTerminalAdapter: DataAdapter = {
  ...cloudAdapter,

  produtos: {
    ...cloudAdapter.produtos,
    listar: async () => {
      const base = getServerBaseUrl();
      if (base) {
        const local = await tryLocal<Awaited<ReturnType<DataAdapter["produtos"]["listar"]>>>(
          "produtos",
          "listar",
          "/api/produtos/list",
        );
        if (local !== null && local !== undefined) return local;
        throw localUnavailable("produtos.listar");
      }
      return cloudAdapter.produtos.listar();
    },

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

    async get(produtoId) {
      const local = await tryLocal<ProdutoComVariacoes[] | ProdutoComCategoria[]>(
        "produtos",
        "get",
        "/api/produtos/list",
      );
      if (local) {
        const found = local.find((produto) => produto.id === produtoId);
        return found ? ({ ...found, variacoes: [] } as ProdutoComVariacoes) : null;
      }
      if (getServerBaseUrl()) throw localUnavailable("produtos.get");
      return cloudAdapter.produtos.get(produtoId);
    },

    buscarPorCodigo: async (codigo: string) => {
      const base = getServerBaseUrl();
      const valor = codigo.trim();
      if (!valor) return null;
      if (base) {
        const res = await tryLocal<import("../types").ProdutoBuscaResult | null>(
          "produtos",
          "buscarPorCodigo",
          "/api/produtos/buscar",
          { codigo: valor },
        );
        if (res === null) throw localUnavailable("produtos.buscarPorCodigo");
        return res as import("../types").ProdutoBuscaResult | null;
      }
      return cloudAdapter.produtos.buscarPorCodigo(codigo);
    },

    buscarPorPlu: async (plu: string) => {
      const base = getServerBaseUrl();
      const valor = plu.trim();
      if (!valor) return null;
      if (base) {
        const res = await tryLocal<import("../types").ProdutoPluResult | null>(
          "produtos",
          "buscarPorPlu",
          "/api/produtos/buscar",
          { codigo: valor },
        );
        if (res === null) throw localUnavailable("produtos.buscarPorPlu");
        return res as import("../types").ProdutoPluResult | null;
      }
      return cloudAdapter.produtos.buscarPorPlu(plu);
    },
    criar: (input) => postLocal<Awaited<ReturnType<DataAdapter["produtos"]["criar"]>>>(
      "produtos",
      "criar",
      "/api/produtos/registrar",
      input,
    ),
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
     * CRÍTICO — baixa/entrada de estoque.
     * Em modo terminal local, NUNCA cai para cloud automaticamente.
     */
    registrarMovimento: async (
      input: RegistrarMovimentoEstoqueInput,
    ): Promise<RegistrarMovimentoEstoqueResult> => {
      requireLocalBaseUrl("estoque.registrarMovimento");
      const cfg = getLocalConnectionConfig();
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
      if (!local) {
        throw localUnavailable("estoque.registrarMovimento");
      }
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
    },
  },

  vendas: {
    ...cloudAdapter.vendas,
    /**
     * CRÍTICO — finalização de venda.
     * Em modo terminal local, NUNCA cai para cloud automaticamente.
     * Se o servidor local estiver indisponível, a venda é bloqueada
     * com mensagem clara — sem isso, parte das vendas iria para o
     * SQLite local e parte direto para Supabase, gerando split-brain.
     */
    finalizar: async (input: FinalizarVendaInput): Promise<string> => {
      requireLocalBaseUrl("vendas.finalizar");
      const cfg = getLocalConnectionConfig();
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
      if (!local) {
        throw localUnavailable("vendas.finalizar");
      }
      reportDataSource({
        source: "local-server",
        domain: "vendas",
        method: "finalizar",
        fallback: false,
      });
      return local.remote_id ?? local.venda_id;
    },

    /**
     * CRÍTICO — cancelamento de venda (estorna estoque + caixa).
     * Em modo terminal local, NUNCA cai para cloud automaticamente.
     */
    cancelar: async (input: CancelarVendaInput): Promise<CancelarVendaResumo> => {
      requireLocalBaseUrl("vendas.cancelar");
      const cfg = getLocalConnectionConfig();
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
      if (!local) {
        throw localUnavailable("vendas.cancelar");
      }
      reportDataSource({
        source: "local-server",
        domain: "vendas",
        method: "cancelar",
        fallback: false,
      });
      // Quando o servidor local já entregou para a nuvem, podemos buscar
      // o resumo detalhado de lá (mesma fonte de verdade). Caso contrário,
      // devolvemos o resumo mínimo do servidor local.
      if (local.outbox_status === "sent") {
        try {
          return await cloudAdapter.vendas.cancelar(input);
        } catch {
          /* fallback ao resumo mínimo abaixo — venda já foi cancelada no local */
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
    },
  },

  clientes: {
    ...cloudAdapter.clientes,
    criar: (input) =>
      postLocal<Awaited<ReturnType<DataAdapter["clientes"]["criar"]>>>(
        "clientes",
        "criar",
        "/api/clientes/registrar",
        input,
      ),
    async list(input) {
      const local = await tryLocal<Awaited<ReturnType<DataAdapter["clientes"]["list"]>>>(
        "clientes",
        "list",
        "/api/clientes/list",
        {
          status: input?.status ?? undefined,
          busca: input?.busca ?? undefined,
        },
      );
      if (local) return local;
      throw localUnavailable("clientes.list");
    },
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
    async get(clienteId) {
      const local = await tryLocal<Awaited<ReturnType<DataAdapter["clientes"]["get"]>>>(
        "clientes",
        "get",
        "/api/clientes/get",
        { cliente_id: clienteId },
      );
      if (local) return local;
      throw localUnavailable("clientes.get");
    },
    metricas: async () => new Map(),
    historico: async () => [],
    async checkDocumentoDuplicado(documento, ignoreId) {
      return tryLocal<Awaited<ReturnType<DataAdapter["clientes"]["checkDocumentoDuplicado"]>>>(
        "clientes",
        "checkDocumentoDuplicado",
        "/api/clientes/documento",
        { documento, ignore_id: ignoreId ?? undefined },
      );
    },
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
      const rows = await localTerminalAdapter.produtos.listar();
      return categoriasFromProdutos(rows);
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

  funcionarios: {
    ...cloudAdapter.funcionarios,
    async list(input) {
      try {
        const result = await cloudAdapter.funcionarios.list(input);
        if (isDesktop() && result.length > 0) {
          cacheDesktopFuncionarios(
            result.map((funcionario) => ({
              funcionario_id: funcionario.id,
              nome: funcionario.nome,
              login: funcionario.login,
              role: funcionario.role,
              ativo: funcionario.ativo,
              synced_at_ms: Date.now(),
            })),
          ).catch(() => {
            /* ignore cache errors */
          });
        }
        return result;
      } catch (error) {
        const cached = await tryDesktopFuncionariosList(input);
        if (cached) return cached;
        throw error;
      }
    },

    async validarPin(input) {
      try {
        const result = await cloudAdapter.funcionarios.validarPin(input);
        if (isDesktop()) {
          saveDesktopFuncionarioPin(
            result.id,
            result.nome,
            result.login,
            result.role,
            true,
            input.pin,
          ).catch(() => {
            /* ignore local cache save failures */
          });
        }
        return result;
      } catch (error) {
        const local = await tryDesktopFuncionarioPin(input.funcionario_id, input.pin);
        if (local) return local;
        throw error;
      }
    },
  },

  caixa: {
    ...cloudAdapter.caixa,

    async aberto(filtro) {
      return withFallback(
        "caixa",
        "aberto",
        async () => {
          const query = filtro?.operador_id
            ? { operador_id: filtro.operador_id }
            : undefined;
          const result = await tryLocal<CaixaLocalAbertoRow | null>(
            "caixa",
            "aberto",
            "/api/caixa/aberto",
            query,
          );
          if (!result) return null;
          const { data } = await supabase.auth.getUser();
          const ownerId = data.user?.id ?? "";
          return mapCaixaLocalToDomain(result, ownerId);
        },
        () => cloudAdapter.caixa.aberto(filtro),
      );
    },

    async resumo(caixaId) {
      return withFallback(
        "caixa",
        "resumo",
        async () => {
          const result = await tryLocal<CaixaResumoLocal | null>(
            "caixa",
            "resumo",
            "/api/caixa/resumo",
            { caixa_id: caixaId },
          );
          return result ? mapCaixaResumoLocalToDomain(result) : null;
        },
        () => cloudAdapter.caixa.resumo(caixaId),
      );
    },

    async historico(input) {
      return withFallback(
        "caixa",
        "historico",
        async () => {
          const result = await tryLocal<CaixaLocalAbertoRow[] | null>(
            "caixa",
            "historico",
            "/api/caixa/historico",
            {
              limit: input?.limit != null ? String(input.limit) : undefined,
            },
          );
          if (!result) return null;
          const { data } = await supabase.auth.getUser();
          const ownerId = data.user?.id ?? "";
          return result.map((row) => mapCaixaLocalToDomain(row, ownerId));
        },
        () => cloudAdapter.caixa.historico(input),
      );
    },

    async movimentos(caixaId) {
      return withFallback(
        "caixa",
        "movimentos",
        async () => {
          const result = await tryLocal<CaixaMovimentoLocalRow[] | null>(
            "caixa",
            "movimentos",
            "/api/caixa/movimentos",
            { caixa_id: caixaId },
          );
          if (!result) return null;
          return result.map(mapCaixaMovimentoLocalToDomain);
        },
        () => cloudAdapter.caixa.movimentos(caixaId),
      );
    },

    /**
     * CRÍTICO — abertura de caixa.
     * Em modo terminal local, NUNCA cai para cloud automaticamente.
     */
    abrir: async (input: AbrirCaixaInput): Promise<string> => {
      requireLocalBaseUrl("caixa.abrir");
      const cfg = getLocalConnectionConfig();
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
      if (!local) {
        throw localUnavailable("caixa.abrir");
      }
      reportDataSource({
        source: "local-server",
        domain: "caixa",
        method: "abrir",
        fallback: false,
      });
      return local.remote_id ?? local.caixa_id;
    },

    /**
     * CRÍTICO — sangria/suprimento.
     * Em modo terminal local, NUNCA cai para cloud automaticamente.
     */
    registrarMovimento: async (
      input: RegistrarMovimentoCaixaInput,
    ): Promise<string> => {
      requireLocalBaseUrl("caixa.registrarMovimento");
      const cfg = getLocalConnectionConfig();
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
      if (!local) {
        throw localUnavailable("caixa.registrarMovimento");
      }
      reportDataSource({
        source: "local-server",
        domain: "caixa",
        method: "registrarMovimento",
        fallback: false,
      });
      return local.remote_id ?? local.movimento_id;
    },

    /**
     * CRÍTICO — fechamento de caixa.
     * Em modo terminal local, NUNCA cai para cloud automaticamente.
     */
    fechar: async (input: FecharCaixaInput): Promise<FecharCaixaResult> => {
      requireLocalBaseUrl("caixa.fechar");
      const cfg = getLocalConnectionConfig();
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
      if (!local) {
        throw localUnavailable("caixa.fechar");
      }
      reportDataSource({
        source: "local-server",
        domain: "caixa",
        method: "fechar",
        fallback: false,
      });
      // Se o servidor local já entregou para a nuvem, tentamos buscar
      // o resumo definitivo (valor_esperado/diferença calculados no cloud).
      if (local.outbox_status === "sent" && local.remote_id) {
        try {
          return await cloudAdapter.caixa.fechar(input);
        } catch {
          /* fallback ao resumo mínimo — caixa já foi fechado no local */
        }
      }
      return {
        caixa_id: local.remote_id ?? input.caixa_id,
        valor_esperado: input.valor_informado,
        valor_informado: local.valor_informado,
        diferenca: 0,
        fechado_em: new Date().toISOString(),
      };
    },
  },
};
