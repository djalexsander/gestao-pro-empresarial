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
      if (getBaseUrl(cfg)) {
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
     * Leitura completa do cadastro de clientes. Lê do `clientes_local`
     * (payload completo armazenado pelo `ingest_clientes`). Filtros
     * `status` / `busca` são aplicados client-side sobre o resultado local.
     * Para o volume típico de Clientes (centenas a poucos milhares por
     * loja) isso é trivial e mantém a tela 100% disponível offline.
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
            // status vazio = todos os status; o filtro real é aplicado abaixo.
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
    listLancamentosCompleto: () =>
      withFallback(
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
      ),
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
      const cfg = getDesktopConfig().terminal;
      if (getBaseUrl(cfg)) {
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
      }
      const result = await cloudAdapter.caixa.abrir(input);
      reportDataSource({
        source: "cloud", domain: "caixa", method: "abrir", fallback: true,
      });
      return result;
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
      const cfg = getDesktopConfig().terminal;
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
      }
      const result = await cloudAdapter.caixa.fechar(input);
      reportDataSource({
        source: "cloud", domain: "caixa", method: "fechar", fallback: true,
      });
      return result;
    },
  },
};
