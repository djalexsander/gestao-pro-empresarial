/**
 * ============================================================================
 * DataAdapter — Interface única de acesso a dados
 * ============================================================================
 *
 * Toda operação de dados que for migrada para esta camada DEVE passar pela
 * interface `DataAdapter`. Isso desacopla os hooks/componentes do Supabase
 * (ou de qualquer outra fonte futura).
 *
 * Implementações:
 *   - adapters/cloud.ts          → Supabase remoto (atual)
 *   - adapters/local.ts          → API local na LAN (futuro)
 *   - adapters/hybrid.ts         → local + sync com nuvem (futuro)
 *
 * Regra: a interface só cresce. Cada hook migrado adiciona seu método aqui,
 * e TODAS as implementações precisam fornecê-lo (TypeScript garante).
 */

import type {
  AbrirCaixaInput,
  AlterarStatusVendaInput,
  AlterarStatusVendaResult,
  CancelarVendaInput,
  CancelarVendaResumo,
  ExcluirVendaCanceladaResult,
  FecharCaixaInput,
  FecharCaixaResult,
  FinalizarVendaInput,
  ProdutoBuscaResult,
  ProdutoComCategoria,
  ProdutoPluResult,
  RegistrarMovimentoCaixaInput,
} from "./types";

export interface ProdutosAdapter {
  /**
   * Busca um produto por qualquer código (barras, QR, SKU, interno,
   * alternativo) dentro do tenant do usuário autenticado.
   */
  buscarPorCodigo(codigo: string): Promise<ProdutoBuscaResult | null>;

  /**
   * Busca um produto pelo PLU (código base usado pela balança).
   * Estratégia: tenta `plu` → `sku` → `codigo_interno`. Se nada bate,
   * tenta novamente sem zeros à esquerda (PLU 00123 = 123).
   */
  buscarPorPlu(plu: string): Promise<ProdutoPluResult | null>;

  /**
   * Lista todos os produtos do tenant, com a categoria já “joinada”,
   * ordenados por nome.
   */
  listar(): Promise<ProdutoComCategoria[]>;
}

export interface VendasAdapter {
  /**
   * Finaliza uma venda no PDV.
   *
   * **Idempotência:** se `input.client_uuid` for enviado e já houver uma
   * venda com esse UUID para o mesmo owner, o backend retorna o ID da venda
   * existente sem duplicar venda, itens, baixa de estoque, pagamentos,
   * lançamento financeiro ou movimento de caixa.
   *
   * Comportamento esperado do chamador (PDV):
   *  - Gerar `client_uuid` (crypto.randomUUID()) ao iniciar o carrinho.
   *  - Manter o mesmo UUID até a venda ser efetivada/cancelada/limpa.
   *  - Ao limpar/cancelar o carrinho, gerar um novo UUID para a próxima.
   *
   * Retorna o `venda_id` (string).
   */
  finalizar(input: FinalizarVendaInput): Promise<string>;

  /**
   * Cancela uma venda **não cancelada** e executa, em UMA transação no banco:
   *  - estorno de estoque (1 movimento `devolucao` por item),
   *  - marcação de TODOS os lançamentos financeiros vinculados como
   *    `cancelado` (mantém histórico, NÃO deleta),
   *  - mudança de `vendas.status` → `cancelada`.
   *
   * NÃO permite cancelar uma venda já cancelada. NÃO toca em
   * `caixa_movimentos` (o evento operacional do dia permanece registrado).
   */
  cancelar(input: CancelarVendaInput): Promise<CancelarVendaResumo>;

  /**
   * Exclui DEFINITIVAMENTE uma venda já cancelada.
   *
   * Diferença vs. `cancelar`:
   *  - `cancelar` → muda status, estorna estoque, cancela lançamentos.
   *    A venda continua visível no histórico.
   *  - `excluirCancelada` → APAGA a linha de `vendas` (e itens via cascade).
   *    Pré-requisito: status='cancelada'. Lançamentos e movimentos de estoque
   *    têm `venda_id` desvinculado (NULL) — o histórico de cada um fica
   *    preservado, mas perde a referência ao número da venda.
   *
   * Use com cautela: é um delete físico. RPC já valida no banco.
   */
  excluirCancelada(vendaId: string): Promise<ExcluirVendaCanceladaResult>;

  /**
   * Altera o status de uma venda **não cancelada**, refletindo a mudança em
   * todos os lançamentos financeiros vinculados de forma atômica e idempotente
   * por estado (a RPC sempre converge o lançamento ao estado-alvo, sem
   * acumular efeitos por chamadas repetidas).
   *
   * Reflexos garantidos pela RPC:
   *  - `vendas.status_pagamento` → atualizado.
   *  - `financeiro_lancamentos`  → status/`valor_pago`/`data_pagamento`
   *    convergidos para o novo estado.
   *  - `lancamento_pagamentos`   → criados (quitação) ou removidos (volta a
   *    pendente). Histórico de pagamentos é reconstruído conforme o estado.
   *
   * Restrições:
   *  - Vendas com `status='cancelada'` NÃO podem ser alteradas por aqui.
   *    Use `vendas.cancelar` para cancelamento real (com estorno de estoque).
   *  - `cancelado` aqui cancela apenas os LANÇAMENTOS, NÃO a venda nem o
   *    estoque — uso administrativo para limpar pendências.
   */
  alterarStatus(input: AlterarStatusVendaInput): Promise<AlterarStatusVendaResult>;
}

export interface CaixaAdapter {
  /**
   * Abre um novo caixa para o owner autenticado.
   *
   * **Concorrência:** o banco protege com índice único parcial — dois
   * terminais não conseguem abrir caixa simultâneo no mesmo terminal_id
   * nem dois caixas para o mesmo operador.
   *
   * Retorna o `caixa_id`.
   */
  abrir(input: AbrirCaixaInput): Promise<string>;

  /**
   * Fecha um caixa aberto, calcula diferença, gera lançamentos no Financeiro
   * para iFood/fiado/outros, e registra o movimento de fechamento.
   *
   * **Concorrência:** o banco usa `SELECT FOR UPDATE` para impedir
   * fechamento duplicado concorrente.
   *
   * Sangria e suprimento NÃO viram lançamento financeiro — são puramente
   * operacionais (movimento de gaveta).
   */
  fechar(input: FecharCaixaInput): Promise<FecharCaixaResult>;

  /**
   * Registra sangria (saída operacional) ou suprimento (entrada operacional).
   *
   * **Idempotência:** envie `client_uuid` estável por modal aberto. Reenvio
   * com mesmo UUID retorna o id existente sem duplicar movimento.
   */
  registrarMovimento(input: RegistrarMovimentoCaixaInput): Promise<string>;

  /**
   * Exclui um caixa (apenas se permitido pela RPC `excluir_caixa`).
   * Encaminhado direto para a função do banco — toda regra fica lá.
   */
  excluir(caixaId: string): Promise<unknown>;
}

export interface DataAdapter {
  produtos: ProdutosAdapter;
  vendas: VendasAdapter;
  caixa: CaixaAdapter;
  // Próximos a serem adicionados conforme a Fase 1 avança:
  // estoque: EstoqueAdapter;
  // realtime: RealtimeAdapter;
}
