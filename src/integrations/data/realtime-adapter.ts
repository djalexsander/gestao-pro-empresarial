/**
 * ============================================================================
 * RealtimeAdapter — contrato formal da fonte de eventos (Bloco 16)
 * ============================================================================
 *
 * Formaliza a camada de realtime do mesmo jeito que `DataAdapter` formalizou
 * reads/writes. O hook `useRealtimeSync` deixa de conhecer Supabase
 * diretamente: ele apenas obtém o adapter ativo via `realtimeClient` e chama
 * `start()`. A implementação concreta decide a fonte (Supabase Realtime hoje;
 * WebSocket LAN / EventEmitter local amanhã).
 *
 * Princípios:
 *  - O adapter NÃO conhece React Query nem queryKeys. Ele apenas traduz
 *    eventos da fonte em `DomainEvent` e publica no `invalidationBus`.
 *  - O adapter expõe `start()` que retorna um `stop()`, no mesmo formato que
 *    um effect React espera (`useEffect(() => adapter.start(), [])`).
 *  - O adapter pode opcionalmente expor `subscribeDomain(domain, handler)`
 *    como atalho para `invalidationBus.subscribe`, mas o caminho canônico
 *    de consumo continua sendo o bus + `useDomainInvalidation`.
 *  - Vários adapters podem coexistir (modo híbrido cloud + LAN). Cada um
 *    publica no mesmo bus com `source` diferente; consumidores que precisem
 *    evitar loop usam `event.source` para filtrar.
 */

import {
  invalidationBus,
  type DataDomain,
  type DomainEvent,
} from "./realtime";

/**
 * Função retornada por `start()` para encerrar a assinatura.
 * Compatível com o retorno de `useEffect`.
 */
export type RealtimeStop = () => void;

/**
 * Opções genéricas de inicialização. Cada implementação pode ignorar o que
 * não fizer sentido (ex.: o adapter LAN futuro pode usar `url`/`token`; o
 * adapter Supabase atual ignora — ele já tem a sessão).
 */
export interface RealtimeStartOptions {
  /** URL alvo (ex.: ws://servidor-local:7070). Ignorado pelo adapter cloud. */
  url?: string;
  /** Token/credencial específica da fonte. Ignorado pelo adapter cloud. */
  token?: string;
  /** Identificador deste terminal — usado para filtrar próprio eco em LAN. */
  terminalId?: string;
}

/**
 * Contrato que toda fonte de realtime deve implementar.
 */
export interface RealtimeAdapter {
  /** Identificador legível: "supabase" | "local-ws" | "local-emitter" | "polling". */
  readonly source: NonNullable<DomainEvent["source"]>;

  /**
   * Abre a conexão / assina os canais e começa a publicar no
   * `invalidationBus`. Retorna um `stop()` idempotente.
   */
  start(options?: RealtimeStartOptions): RealtimeStop;

  /**
   * Atalho opcional sobre o bus. Implementações não precisam reimplementar —
   * a default delega para `invalidationBus.subscribe`.
   */
  subscribeDomain?(
    domain: DataDomain,
    handler: (event: DomainEvent) => void,
  ): RealtimeStop;
}

/**
 * Helper compartilhado: roteia uma mudança vinda da fonte para os domínios
 * canônicos. Mantém o mapeamento tabela → domínio em UM lugar só, para que
 * adapters diferentes (cloud, LAN) usem exatamente as mesmas regras.
 *
 * Vários eventos podem vir de uma só tabela (ex.: `produtos` afeta
 * `produtos` E `estoque`). O helper publica todos.
 */
const TABLE_TO_DOMAIN: Record<string, DataDomain[]> = {
  vendas: ["vendas", "caixa"],
  venda_itens: ["vendas"],
  caixas: ["caixa", "terminais"],
  caixa_movimentos: ["caixa"],
  produtos: ["produtos", "estoque"],
  estoque_movimentacoes: ["estoque", "produtos", "lotes"],
  financeiro_lancamentos: ["financeiro"],
  terminais: ["terminais"],
  clientes: ["clientes"],
  fornecedores: ["fornecedores"],
  funcionarios: ["funcionarios"],
  categorias_produto: ["categorias_produto", "produtos"],
  categorias_financeiras: ["categorias_financeiras"],
  lotes_produto: ["lotes", "estoque"],
  empresa_membros: ["socios"],
  configuracoes_empresa: ["empresa"],
  empresa_modulos: ["modulos"],
  modulos: ["modulos"],
  planos: ["modulos"],
};


/** Tabelas que algum adapter precisa saber escutar. */
export function realtimeTables(): string[] {
  return Object.keys(TABLE_TO_DOMAIN);
}

/**
 * Publica no bus os domínios afetados por uma mudança em `table`. Adapters
 * usam isso para não duplicar a regra de roteamento.
 */
export function publishTableChange(
  table: string,
  op: DomainEvent["op"],
  source: DomainEvent["source"],
  id?: string,
): void {
  const domains = TABLE_TO_DOMAIN[table];
  if (!domains || domains.length === 0) return;
  for (const domain of domains) {
    invalidationBus.publish({ domain, op, id, source });
  }
}

/** Default `subscribeDomain` para implementações que não querem reescrevê-lo. */
export function defaultSubscribeDomain(
  domain: DataDomain,
  handler: (event: DomainEvent) => void,
): RealtimeStop {
  return invalidationBus.subscribe(domain, handler);
}
