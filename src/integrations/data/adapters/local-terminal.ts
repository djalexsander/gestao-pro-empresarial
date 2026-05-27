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
  getBaseUrl,
  registrarMovCaixaLocal,
  registrarMovimentoLocal,
  registrarVendaLocal,
} from "@/integrations/desktop/serverConnection";
import type {
  AbrirCaixaInput,
  FecharCaixaInput,
  FecharCaixaResult,
  RegistrarMovimentoCaixaInput,
} from "../types";

const HTTP_TIMEOUT_MS = 4000;

/**
 * Mensagem padronizada exibida ao operador quando o servidor local cai
 * e a operação crítica é bloqueada. Evita split-brain silencioso.
 */
const MSG_LOCAL_INDISPONIVEL =
  "Servidor local indisponível. Esta operação não será enviada direto para a nuvem para evitar divergência de caixa/estoque. Reconecte ao servidor local ou altere o modo de operação nas configurações.";

class LocalServerIndisponivelError extends Error {
  code = "LOCAL_SERVER_INDISPONIVEL" as const;
  constructor(public operacao: string) {
    super(MSG_LOCAL_INDISPONIVEL);
    this.name = "LocalServerIndisponivelError";
  }
}

/**
 * Garante que o terminal tem servidor local configurado antes de tentar
 * uma operação crítica. Caso contrário, bloqueia com mensagem clara.
 */
function requireLocalBaseUrl(operacao: string): string {
  const cfg = getDesktopConfig().terminal;
  const baseUrl = getBaseUrl(cfg);
  if (!baseUrl) {
    // Telemetria: registra a tentativa bloqueada (origem = local-terminal,
    // sem fallback — para o operador ver o badge correto).
    reportDataSource({
      source: "local-terminal",
      domain: "guard",
      method: operacao,
      fallback: false,
    });
    throw new LocalServerIndisponivelError(operacao);
  }
  return baseUrl;
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

// ----------------------------------------------------------------------------
// Adapter
// ----------------------------------------------------------------------------

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
      const cfg = getDesktopConfig().terminal;
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
        throw new LocalServerIndisponivelError("estoque.registrarMovimento");
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
      const cfg = getDesktopConfig().terminal;
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
        throw new LocalServerIndisponivelError("vendas.finalizar");
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
      const cfg = getDesktopConfig().terminal;
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
        throw new LocalServerIndisponivelError("vendas.cancelar");
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

  caixa: {
    ...cloudAdapter.caixa,
    /**
     * CRÍTICO — abertura de caixa.
     * Em modo terminal local, NUNCA cai para cloud automaticamente.
     */
    abrir: async (input: AbrirCaixaInput): Promise<string> => {
      requireLocalBaseUrl("caixa.abrir");
      const cfg = getDesktopConfig().terminal;
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
        throw new LocalServerIndisponivelError("caixa.abrir");
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
      const cfg = getDesktopConfig().terminal;
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
        throw new LocalServerIndisponivelError("caixa.registrarMovimento");
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
      const cfg = getDesktopConfig().terminal;
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
        throw new LocalServerIndisponivelError("caixa.fechar");
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
