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
  AlterarStatusClienteInput,
  AlterarStatusClienteResult,
  AlterarStatusFornecedorInput,
  AlterarStatusFornecedorResult,
  AlterarStatusVendaInput,
  AlterarStatusVendaResult,
  AlterarVencimentoLancamentoInput,
  AlterarVencimentoLancamentoResult,
  CancelarLancamentoInput,
  CancelarLancamentoResult,
  CancelarVendaInput,
  CancelarVendaResumo,
  ConciliarIfoodIndividualInput,
  ConciliarIfoodLoteInput,
  CriarClienteInput,
  CriarClienteResult,
  CriarFornecedorInput,
  CriarFornecedorResult,
  CriarLancamentoAvulsoInput,
  CriarLancamentoAvulsoResult,
  EditarClienteInput,
  EditarClienteResult,
  EditarFornecedorInput,
  EditarFornecedorResult,
  EditarLancamentoAvulsoInput,
  EditarLancamentoAvulsoResult,
  ExcluirClienteResult,
  ExcluirFornecedorResult,
  ExcluirLancamentoAvulsoResult,
  ExcluirVendaCanceladaResult,
  FecharCaixaInput,
  FecharCaixaResult,
  FinalizarVendaInput,
  ProdutoBuscaResult,
  ProdutoComCategoria,
  ProdutoPluResult,
  ReabrirLancamentoResult,
  RegistrarMovimentoCaixaInput,
  RegistrarMovimentoEstoqueInput,
  RegistrarMovimentoEstoqueResult,
  RegistrarPagamentoLancamentoInput,
  RegistrarPagamentoLancamentoResult,
  RemoverPagamentoLancamentoResult,
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

/**
 * Operações de escrita do **Financeiro** (títulos a pagar/receber).
 *
 * Toda baixa, cancelamento, reabertura e edição de vencimento passa por
 * RPCs `SECURITY DEFINER` no banco — nunca por UPDATE/INSERT direto da UI.
 * Isso garante:
 *  - validação de tenant centralizada,
 *  - atomicidade (lock no título antes de mexer em pagamentos),
 *  - idempotência de baixa via `client_uuid`,
 *  - convergência automática de `valor_pago`/`status` (triggers do banco).
 */
export interface FinanceiroAdapter {
  /**
   * Registra um pagamento (parcial ou total) em um título.
   *
   * **Idempotência:** se `input.client_uuid` for enviado e já houver pagamento
   * com esse UUID, o backend retorna o id existente sem duplicar a baixa.
   * Triggers do banco recalculam `valor_pago`, `status` e `data_pagamento`
   * automaticamente; o status converge entre `pendente` ↔ `parcial` ↔
   * `pago`/`recebido` conforme o total acumulado.
   */
  registrarPagamento(
    input: RegistrarPagamentoLancamentoInput,
  ): Promise<RegistrarPagamentoLancamentoResult>;

  /**
   * Remove um pagamento existente. O banco segura o título com `FOR UPDATE`
   * para evitar corrida com outras baixas. Idempotente: se o pagamento já
   * não existe, retorna sem erro.
   */
  removerPagamento(pagamentoId: string): Promise<RemoverPagamentoLancamentoResult>;

  /**
   * Cancela um título (sem apagar histórico de pagamentos).
   * Idempotente em título já cancelado.
   */
  cancelarLancamento(input: CancelarLancamentoInput): Promise<CancelarLancamentoResult>;

  /**
   * Reabre um título cancelado, reavaliando o status pelo total já pago
   * (`pendente` / `parcial` / `pago` / `recebido`).
   */
  reabrirLancamento(lancamentoId: string): Promise<ReabrirLancamentoResult>;

  /**
   * Altera o vencimento de um título **pendente ou parcial**. Bloqueado para
   * títulos `pago`, `recebido` ou `cancelado` (validado no banco).
   */
  alterarVencimento(
    input: AlterarVencimentoLancamentoInput,
  ): Promise<AlterarVencimentoLancamentoResult>;

  /**
   * Concilia 1 lançamento iFood com o repasse efetivo.
   * RPC: `conciliar_ifood_lancamento` (já existente).
   */
  conciliarIfoodIndividual(input: ConciliarIfoodIndividualInput): Promise<unknown>;

  /**
   * Concilia múltiplos lançamentos iFood em um único repasse rateado.
   * RPC: `conciliar_ifood_lote` (já existente).
   */
  conciliarIfoodLote(input: ConciliarIfoodLoteInput): Promise<unknown>;

  /**
   * Cria um lançamento avulso (a pagar / a receber, sem venda).
   *
   * **Idempotência:** envie `client_uuid` estável por dialog aberto. Reenvio
   * com mesmo UUID retorna o id existente sem duplicar título.
   *
   * Vincular a venda/compra é bloqueado por aqui — esses fluxos têm RPCs
   * próprias.
   */
  criarLancamentoAvulso(
    input: CriarLancamentoAvulsoInput,
  ): Promise<CriarLancamentoAvulsoResult>;

  /**
   * Edita campos de um lançamento avulso. Bloqueado pelo banco para títulos
   * vinculados a venda/compra, cancelados, pagos ou recebidos. Não permite
   * reduzir valor abaixo do total já pago.
   *
   * **Idempotência:** mesmo `client_uuid` no MESMO lançamento retorna sem
   * reaplicar; UUID reusado em outro lançamento gera erro.
   */
  editarLancamentoAvulso(
    input: EditarLancamentoAvulsoInput,
  ): Promise<EditarLancamentoAvulsoResult>;

  /**
   * Exclui DEFINITIVAMENTE um lançamento avulso. Permitido apenas se não
   * vinculado a venda/compra, sem pagamentos registrados e em status
   * `pendente` ou `cancelado`. Para qualquer outro caso, use
   * `cancelarLancamento` (preserva histórico).
   */
  excluirLancamentoAvulso(
    lancamentoId: string,
  ): Promise<ExcluirLancamentoAvulsoResult>;
}

/**
 * Operações de escrita do **Estoque** (movimentações manuais avulsas).
 *
 * Movimentações automáticas (venda → baixa, compra → entrada, cancelamento →
 * devolução) NÃO passam por aqui — elas são geradas pelas RPCs de venda/
 * compra/cancelamento. Este adapter cobre **somente ajustes manuais**:
 * entrada manual, saída manual, ajuste de saldo, devolução avulsa,
 * transferência.
 *
 * Toda gravação passa por RPC `SECURITY DEFINER` no banco para garantir:
 *  - lock por produto (sem corrida entre terminais),
 *  - recálculo do saldo no servidor (cliente não dita o saldo),
 *  - bloqueio de saldo negativo,
 *  - idempotência por `client_uuid`.
 */
export interface EstoqueAdapter {
  /**
   * Registra uma movimentação manual de estoque.
   *
   * **Idempotência:** envie `client_uuid` estável (1 por modal aberto).
   * Reenvio com mesmo UUID retorna o movimento existente sem duplicar
   * entrada/saída.
   *
   * **Concorrência multi-terminal:** o banco usa `pg_advisory_xact_lock`
   * por `produto_id`, então duas movimentações simultâneas do mesmo item
   * em terminais diferentes são serializadas — cada uma vê o saldo já
   * atualizado pela anterior antes de gravar.
   */
  registrarMovimento(
    input: RegistrarMovimentoEstoqueInput,
  ): Promise<RegistrarMovimentoEstoqueResult>;
}

/**
 * Operações de escrita de **Cliente** (cadastro PF/PJ).
 *
 * Toda gravação passa por RPC `SECURITY DEFINER` no banco para garantir:
 *  - tenant resolvido pelo backend (sem confiar no payload),
 *  - normalização do documento (apenas dígitos),
 *  - idempotência de criação por `client_uuid`,
 *  - exclusão segura: hard delete só sem vínculos. Com vínculos
 *    (vendas ou lançamentos), a RPC bloqueia e sugere inativar.
 */
export interface ClientesAdapter {
  /**
   * Cria um cliente. **Idempotência:** envie `client_uuid` estável por dialog
   * aberto. Reenvio com mesmo UUID retorna o id existente sem duplicar.
   */
  criar(input: CriarClienteInput): Promise<CriarClienteResult>;

  /** Edita campos do cadastro. Não toca em status (use `alterarStatus`). */
  editar(input: EditarClienteInput): Promise<EditarClienteResult>;

  /**
   * Soft delete: alterna `ativo` ↔ `inativo`. **Recomendado** sempre que
   * houver vínculo histórico (vendas, lançamentos). Preserva auditoria.
   */
  alterarStatus(
    input: AlterarStatusClienteInput,
  ): Promise<AlterarStatusClienteResult>;

  /**
   * Hard delete. Permitido APENAS se o cliente não tiver vendas nem
   * lançamentos vinculados — caso contrário a RPC aborta com erro orientando
   * a usar `alterarStatus('inativo')`. Garante zero inconsistência histórica.
   */
  excluir(clienteId: string): Promise<ExcluirClienteResult>;
}

/**
 * Operações de escrita de **Fornecedor**. Mesma filosofia do `ClientesAdapter`,
 * com vínculos checados em `compras` e `financeiro_lancamentos`.
 */
export interface FornecedoresAdapter {
  criar(input: CriarFornecedorInput): Promise<CriarFornecedorResult>;
  editar(input: EditarFornecedorInput): Promise<EditarFornecedorResult>;
  alterarStatus(
    input: AlterarStatusFornecedorInput,
  ): Promise<AlterarStatusFornecedorResult>;
  /**
   * Hard delete. Bloqueado se houver compras ou lançamentos vinculados.
   * Quando bloqueado, oriente o usuário a inativar via `alterarStatus`.
   */
  excluir(fornecedorId: string): Promise<ExcluirFornecedorResult>;
}

export interface DataAdapter {
  produtos: ProdutosAdapter;
  vendas: VendasAdapter;
  caixa: CaixaAdapter;
  financeiro: FinanceiroAdapter;
  estoque: EstoqueAdapter;
  clientes: ClientesAdapter;
  fornecedores: FornecedoresAdapter;
  // Próximos a serem adicionados conforme a Fase 1 avança:
  // realtime: RealtimeAdapter;
}
