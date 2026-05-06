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
  AdicionarProdutoCodigoInput,
  AdicionarProdutoCodigoResult,
  AlterarStatusClienteInput,
  AlterarStatusClienteResult,
  AlterarStatusFornecedorInput,
  AlterarStatusFornecedorResult,
  AlterarStatusFuncionarioInput,
  AlterarStatusFuncionarioResult,
  AlterarStatusProdutoInput,
  AlterarStatusProdutoResult,
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
  CriarCategoriaProdutoInput,
  CriarCategoriaProdutoResult,
  CriarClienteInput,
  CriarClienteResult,
  CriarFornecedorInput,
  CriarFornecedorResult,
  CriarFuncionarioInput,
  CriarFuncionarioResult,
  CriarLancamentoAvulsoInput,
  CriarLancamentoAvulsoResult,
  CriarProdutoInput,
  CriarProdutoResult,
  CriarProdutoVariacaoInput,
  CriarProdutoVariacaoResult,
  EditarClienteInput,
  EditarClienteResult,
  EditarFornecedorInput,
  EditarFornecedorResult,
  EditarFuncionarioInput,
  EditarFuncionarioResult,
  EditarLancamentoAvulsoInput,
  EditarLancamentoAvulsoResult,
  EditarProdutoInput,
  EditarProdutoResult,
  ExcluirClienteResult,
  ExcluirFornecedorResult,
  ExcluirFuncionarioResult,
  ExcluirLancamentoAvulsoResult,
  ExcluirProdutoCodigoResult,
  ExcluirProdutoResult,
  ExcluirProdutoVariacaoResult,
  ExcluirVendaCanceladaResult,
  FecharCaixaInput,
  FecharCaixaResult,
  FinalizarVendaInput,
  OperadorSessaoDomain,
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
  ResetarPinFuncionarioInput,
  ValidarPinOperadorInput,
  DesbloquearPinOperadorInput,
  DesbloquearPinOperadorResult,
  EditarCategoriaProdutoInput,
  EditarCategoriaProdutoResult,
  AlterarStatusCategoriaProdutoInput,
  AlterarStatusCategoriaProdutoResult,
  ExcluirCategoriaProdutoResult,
  CriarCategoriaFinanceiraInput,
  CriarCategoriaFinanceiraResult,
  EditarCategoriaFinanceiraInput,
  EditarCategoriaFinanceiraResult,
  AlterarStatusCategoriaFinanceiraInput,
  AlterarStatusCategoriaFinanceiraResult,
  ExcluirCategoriaFinanceiraResult,
  // Reads (Bloco 15)
  CaixaAbertoFiltro,
  CaixaDomain,
  CaixaMovimentoDomain,
  CaixaResumoDomain,
  CategoriaFinanceiraDomain,
  CategoriaProdutoDomain,
  CategoriasFinanceirasListInput,
  CategoriasProdutoListInput,
  ClienteDomain,
  ClienteHistoricoVendaDomain,
  ClienteLiteDomain,
  ClienteMetricasDomain,
  ClientesListInput,
  ClientesLiteListInput,
  EstoqueSaldoLinha,
  FornecedorDomain,
  FornecedoresListInput,
  FuncionarioDomain,
  FuncionariosListInput,
  LoteComSaldoDomain,
  LotesListInput,
  MovimentacaoEstoqueDomain,
  MovimentacoesListInput,
  ProdutoComVariacoes,
  ProdutosListInput,
} from "./types";
import type {
  CompraComFornecedorDomain,
  CompraDetalheDomain,
  CompraMetadadosInput,
  CompraStatusDomain,
  CriarCompraInput,
  DashboardData,
  FornecedorMetricaDomain,
  ReceberCompraInput,
  ReceberCompraItensInput,
  ReceberCompraItensResult,
  SaldosEstoqueLote,
  VendaDetalheDomain,
  VendaListItemDomain,
  VendaMetricasDomain,
  VendaMetricasPeriodoInput,
  VendaStatusHistoricoDomain,
  VendasListInput,
} from "./extra-types";

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
   *
   * @deprecated Bloco 15: prefira `list()` com filtros tipados. Mantido por
   * compat enquanto callers antigos não migram.
   */
  listar(): Promise<ProdutoComCategoria[]>;

  // ---------------------------- Reads (Bloco 15) ----------------------------
  /**
   * Lista produtos com filtros tipados. Hoje implementação cloud aplica os
   * filtros server-side (Supabase); amanhã a impl local pode aplicar local.
   */
  list(input?: ProdutosListInput): Promise<ProdutoComCategoria[]>;
  /** Busca por id, com variações já “joinadas”. Retorna `null` se não encontrar. */
  get(produtoId: string): Promise<ProdutoComVariacoes | null>;

  // ---------------------------- Writes ----------------------------

  /**
   * Cria um produto. **Idempotência:** envie `client_uuid` estável por
   * dialog aberto. Reenvio com mesmo UUID retorna o id existente sem
   * duplicar (cobre duplo clique e retry de rede).
   */
  criar(input: CriarProdutoInput): Promise<CriarProdutoResult>;

  /** Edita campos do produto. Não altera vínculos (códigos/variações/lotes). */
  editar(input: EditarProdutoInput): Promise<EditarProdutoResult>;

  /**
   * Soft delete: alterna entre `ativo` / `inativo` / `descontinuado`.
   * **Recomendado** sempre que houver vínculo histórico (vendas, compras,
   * movimentos de estoque). Preserva histórico.
   */
  alterarStatus(input: AlterarStatusProdutoInput): Promise<AlterarStatusProdutoResult>;

  /**
   * Hard delete. Permitido APENAS se o produto não tiver vendas, compras,
   * movimentos de estoque nem lotes vinculados — caso contrário a RPC aborta
   * com erro orientando a usar `alterarStatus('inativo')`. Garante zero
   * inconsistência histórica. Quando sem vínculos, remove em cascata os
   * `produto_codigos` e `produto_variacoes` órfãos.
   */
  excluir(produtoId: string): Promise<ExcluirProdutoResult>;

  // ---------------------------- Códigos auxiliares ----------------

  /**
   * Adiciona um código auxiliar (barras, QR, SKU, interno, alternativo).
   * **Idempotência:** envie `client_uuid` por chamada (1 UUID por click no
   * botão "adicionar código").
   */
  adicionarCodigo(input: AdicionarProdutoCodigoInput): Promise<AdicionarProdutoCodigoResult>;

  /** Remove um código auxiliar. Validação de tenant no banco. */
  excluirCodigo(codigoId: string): Promise<ExcluirProdutoCodigoResult>;

  // ---------------------------- Variações -------------------------

  /**
   * Cria uma variação de produto. **Idempotência** via `client_uuid`.
   */
  criarVariacao(input: CriarProdutoVariacaoInput): Promise<CriarProdutoVariacaoResult>;

  /**
   * Hard delete de variação. Bloqueado se houver venda/compra/movimento
   * com `variacao_id` apontando para ela — nesse caso oriente o usuário a
   * inativar o produto inteiro. Remove em cascata `produto_codigos` da
   * variação quando permitido.
   */
  excluirVariacao(variacaoId: string): Promise<ExcluirProdutoVariacaoResult>;

  // ---------------------------- Categoria -------------------------

  /**
   * Cria uma categoria de produto. **Idempotência** via `client_uuid`.
   * (CRUD completo de categoria virá em bloco próprio.)
   */
  criarCategoria(input: CriarCategoriaProdutoInput): Promise<CriarCategoriaProdutoResult>;
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

  // ---------------------------- Reads ----------------------------
  /** Lista vendas com cliente_nome resolvido. Limit default ~500. */
  list(input?: VendasListInput): Promise<VendaListItemDomain[]>;
  /** Detalhe completo de venda (itens, pagamentos, totais pagos). */
  detalhe(vendaId: string): Promise<VendaDetalheDomain | null>;
  /** Histórico de mudança de status. */
  historico(vendaId: string): Promise<VendaStatusHistoricoDomain[]>;
  /** Métricas agregadas por período (RPC `venda_metricas_periodo`). */
  metricasPeriodo(input: VendaMetricasPeriodoInput): Promise<VendaMetricasDomain>;
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

  /**
   * Reabre um caixa fechado para refazer o fechamento. Apenas dono ou
   * membros admin/owner. RPC `reabrir_caixa`.
   */
  reabrir(input: { caixa_id: string; motivo?: string | null }): Promise<unknown>;

  // ---------------------------- Reads (Bloco 15) ----------------------------
  /**
   * Caixa aberto do tenant. `operador_id` `null` = caixa do admin direto;
   * `qualquer: true` retorna o caixa aberto mais recente independente
   * de operador (usado pelo painel admin /caixa).
   */
  aberto(filtro: CaixaAbertoFiltro): Promise<CaixaDomain | null>;
  /** Resumo ao vivo (RPC `caixa_resumo`). */
  resumo(caixaId: string): Promise<CaixaResumoDomain | null>;
  /** Histórico de caixas, mais recentes primeiro. */
  historico(input?: { limit?: number }): Promise<CaixaDomain[]>;
  /** Movimentos de um caixa específico (cronológico). */
  movimentos(caixaId: string): Promise<CaixaMovimentoDomain[]>;
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
  criarLancamentoAvulso(input: CriarLancamentoAvulsoInput): Promise<CriarLancamentoAvulsoResult>;

  /**
   * Edita campos de um lançamento avulso. Bloqueado pelo banco para títulos
   * vinculados a venda/compra, cancelados, pagos ou recebidos. Não permite
   * reduzir valor abaixo do total já pago.
   *
   * **Idempotência:** mesmo `client_uuid` no MESMO lançamento retorna sem
   * reaplicar; UUID reusado em outro lançamento gera erro.
   */
  editarLancamentoAvulso(input: EditarLancamentoAvulsoInput): Promise<EditarLancamentoAvulsoResult>;

  /**
   * Exclui DEFINITIVAMENTE um lançamento avulso. Permitido apenas se não
   * vinculado a venda/compra, sem pagamentos registrados e em status
   * `pendente` ou `cancelado`. Para qualquer outro caso, use
   * `cancelarLancamento` (preserva histórico).
   */
  excluirLancamentoAvulso(lancamentoId: string): Promise<ExcluirLancamentoAvulsoResult>;
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

  // ---------------------------- Reads (Bloco 15) ----------------------------
  /**
   * Linhas mínimas para calcular saldo agregado por produto. Hoje retorna
   * tudo (típico = poucas centenas a poucos milhares por tenant) — quando
   * crescer, o adapter local pode calcular o saldo já agregado.
   */
  saldosLinhas(): Promise<EstoqueSaldoLinha[]>;
  /** Histórico de movimentações com produto "joinado". */
  movimentacoes(input?: MovimentacoesListInput): Promise<MovimentacaoEstoqueDomain[]>;
  /** Saldos em lote para validação rápida no PDV (RPC `saldos_estoque_lote`). */
  saldosLote(produtoIds: string[]): Promise<SaldosEstoqueLote>;
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
  alterarStatus(input: AlterarStatusClienteInput): Promise<AlterarStatusClienteResult>;

  /**
   * Hard delete. Permitido APENAS se o cliente não tiver vendas nem
   * lançamentos vinculados — caso contrário a RPC aborta com erro orientando
   * a usar `alterarStatus('inativo')`. Garante zero inconsistência histórica.
   */
  excluir(clienteId: string): Promise<ExcluirClienteResult>;

  // ---------------------------- Reads (Bloco 15) ----------------------------
  /** Lista completa para tela de gerenciamento. */
  list(input?: ClientesListInput): Promise<ClienteDomain[]>;
  /**
   * Lista resumida (id/nome/fantasia/documento), default só ativos.
   * Usada no PDV / selects de combo.
   */
  listLite(input?: ClientesLiteListInput): Promise<ClienteLiteDomain[]>;
  /** Busca por id (lança se não encontrar). */
  get(clienteId: string): Promise<ClienteDomain>;
  /** Métricas agregadas por cliente (RPC `cliente_metricas`). */
  metricas(): Promise<Map<string, ClienteMetricasDomain>>;
  /** Histórico de vendas de 1 cliente (mais recentes, limit ~50). */
  historico(clienteId: string): Promise<ClienteHistoricoVendaDomain[]>;
  /**
   * Busca duplicidade de documento. Retorna o cliente conflitante ou `null`.
   * `ignoreId` permite excluir o próprio em edição.
   */
  checkDocumentoDuplicado(
    documento: string,
    ignoreId?: string | null,
  ): Promise<ClienteDomain | null>;
}

/**
 * Operações de escrita de **Fornecedor**. Mesma filosofia do `ClientesAdapter`,
 * com vínculos checados em `compras` e `financeiro_lancamentos`.
 */
export interface FornecedoresAdapter {
  criar(input: CriarFornecedorInput): Promise<CriarFornecedorResult>;
  editar(input: EditarFornecedorInput): Promise<EditarFornecedorResult>;
  alterarStatus(input: AlterarStatusFornecedorInput): Promise<AlterarStatusFornecedorResult>;
  /**
   * Hard delete. Bloqueado se houver compras ou lançamentos vinculados.
   * Quando bloqueado, oriente o usuário a inativar via `alterarStatus`.
   */
  excluir(fornecedorId: string): Promise<ExcluirFornecedorResult>;

  // ---------------------------- Reads (Bloco 15) ----------------------------
  list(input?: FornecedoresListInput): Promise<FornecedorDomain[]>;
  get(fornecedorId: string): Promise<FornecedorDomain>;
}

/**
 * Operações de escrita de **Funcionários (operadores PDV)**.
 *
 * Segurança do PIN:
 *  - O PIN nunca é hasheado no cliente.
 *  - O texto puro do PIN trafega via TLS direto para a RPC.
 *  - O hash bcrypt (`crypt + gen_salt('bf', 8)`) é gerado SOMENTE no banco.
 *  - O hash nunca volta para o cliente em hipótese alguma.
 *
 * Cenário multi-terminal: todas as RPCs usam `SELECT ... FOR UPDATE` em
 * editar/alterarStatus/excluir, serializando alterações concorrentes do
 * mesmo funcionário entre terminais diferentes.
 */
export interface FuncionariosAdapter {
  criar(input: CriarFuncionarioInput): Promise<CriarFuncionarioResult>;
  editar(input: EditarFuncionarioInput): Promise<EditarFuncionarioResult>;
  alterarStatus(input: AlterarStatusFuncionarioInput): Promise<AlterarStatusFuncionarioResult>;
  /**
   * Hard delete. Permitido APENAS sem caixas, movimentos de caixa ou
   * vendas vinculadas. Quando bloqueado, oriente o usuário a inativar via
   * `alterarStatus({ ativo: false })`. Bloqueia também excluir o último
   * gerente ativo.
   */
  excluir(funcionarioId: string): Promise<ExcluirFuncionarioResult>;
  /**
   * Reset de PIN. Reaproveita a RPC existente; PIN segue sendo hasheado
   * no banco. Sem `client_uuid` — reset é raramente repetido e o efeito
   * de "reescrever o mesmo hash" não causa dano.
   */
  resetarPin(input: ResetarPinFuncionarioInput): Promise<void>;
  /**
   * Validação de PIN para login do operador. Retorna a sessão sem o hash.
   * Falha de PIN errado é exception (`PIN incorreto`), não retorno vazio —
   * a UI já trata via toast.
   */
  validarPin(input: ValidarPinOperadorInput): Promise<OperadorSessaoDomain>;
  /**
   * Desbloqueia manualmente um operador antes do prazo (Bloco 11).
   * Use quando o gerente quiser liberar imediatamente após o operador
   * provar identidade. Server-side valida que o chamador é
   * owner/admin da empresa.
   */
  desbloquearPin(input: DesbloquearPinOperadorInput): Promise<DesbloquearPinOperadorResult>;

  // ---------------------------- Reads (Bloco 15) ----------------------------
  /** Lista funcionários do tenant. RPC `funcionarios_listar`. */
  list(input?: FuncionariosListInput): Promise<FuncionarioDomain[]>;
}

/**
 * Operações de escrita de **categorias de produto** (Bloco 12).
 *
 * - `criar` continua disponível por `produtos.criarCategoria` (alias) para
 *   compatibilidade com `useCreateCategoria`. Novas chamadas devem usar
 *   este namespace.
 * - Exclusão é **bloqueada** se houver produtos vinculados ou
 *   subcategorias filhas — orienta a inativar.
 */
export interface CategoriasProdutoAdapter {
  editar(input: EditarCategoriaProdutoInput): Promise<EditarCategoriaProdutoResult>;
  alterarStatus(
    input: AlterarStatusCategoriaProdutoInput,
  ): Promise<AlterarStatusCategoriaProdutoResult>;
  /** Hard delete bloqueado por vínculos (produtos, subcategorias). */
  excluir(categoriaId: string): Promise<ExcluirCategoriaProdutoResult>;

  // ---------------------------- Reads (Bloco 15) ----------------------------
  /** Default: somente ativas. Para tela de gerenciamento, passar `incluir_inativas: true`. */
  list(input?: CategoriasProdutoListInput): Promise<CategoriaProdutoDomain[]>;
}

/**
 * Operações de escrita de **categorias financeiras** (Bloco 12).
 *
 * - `tipo` (receita/despesa) é imutável após criação para preservar
 *   relatórios históricos.
 * - Permissão server-side: owner ou membro `owner`/`admin` da empresa.
 * - Exclusão bloqueada se houver lançamentos ou subcategorias.
 * - Idempotência via `client_uuid` em `criar`.
 */
export interface CategoriasFinanceirasAdapter {
  criar(input: CriarCategoriaFinanceiraInput): Promise<CriarCategoriaFinanceiraResult>;
  editar(input: EditarCategoriaFinanceiraInput): Promise<EditarCategoriaFinanceiraResult>;
  alterarStatus(
    input: AlterarStatusCategoriaFinanceiraInput,
  ): Promise<AlterarStatusCategoriaFinanceiraResult>;
  excluir(categoriaId: string): Promise<ExcluirCategoriaFinanceiraResult>;

  // ---------------------------- Reads (Bloco 15) ----------------------------
  /** Filtro opcional por tipo (receita/despesa) e por incluir inativas. */
  list(input?: CategoriasFinanceirasListInput): Promise<CategoriaFinanceiraDomain[]>;
}

/**
 * Lotes de produto — Bloco 14.
 * - `criar` idempotente via `client_uuid`.
 * - `editar` bloqueia mudar `produto_id` (sempre) e `variacao_id`/`quantidade_inicial` se houver vínculos.
 * - `ajustarQuantidade` é a ÚNICA forma segura de mexer em saldo após movimento — gera estoque_movimentacao tipo `ajuste`.
 * - `excluir` é hard delete; bloqueia se houver qualquer vínculo (movimentação/compra/venda).
 */
export interface LotesAdapter {
  criar(input: import("./types").CriarLoteProdutoInput): Promise<import("./types").CriarLoteProdutoResult>;
  editar(input: import("./types").EditarLoteProdutoInput): Promise<import("./types").EditarLoteProdutoResult>;
  ajustarQuantidade(
    input: import("./types").AjustarQuantidadeLoteInput,
  ): Promise<import("./types").AjustarQuantidadeLoteResult>;
  excluir(loteId: string): Promise<import("./types").ExcluirLoteProdutoResult>;

  // ---------------------------- Reads (Bloco 15) ----------------------------
  /** Leitura via view `lotes_produto_com_saldo`. */
  list(input?: LotesListInput): Promise<LoteComSaldoDomain[]>;
}

/**
 * Compras — listagem, criação, recebimento (parcial/total) e métricas.
 * Toda escrita complexa pode passar por RPC (recebimento). Para criação
 * o adapter cloud faz INSERT direto em `compras` + `compra_itens`.
 */
export interface ComprasAdapter {
  list(input?: { limit?: number }): Promise<CompraComFornecedorDomain[]>;
  get(compraId: string): Promise<CompraDetalheDomain | null>;
  criar(input: CriarCompraInput): Promise<CompraComFornecedorDomain>;
  atualizarStatus(input: { id: string; status: CompraStatusDomain }): Promise<void>;
  atualizarMetadados(input: CompraMetadadosInput): Promise<void>;
  receber(input: ReceberCompraInput): Promise<unknown>;
  receberItens(input: ReceberCompraItensInput): Promise<ReceberCompraItensResult>;
  excluir(compraId: string): Promise<void>;
  fornecedorMetricas(): Promise<Map<string, FornecedorMetricaDomain>>;
}

/** Dashboard agregado — uma única chamada que monta todos os KPIs. */
export interface DashboardAdapter {
  carregar(): Promise<DashboardData>;
}

export interface DataAdapter {
  produtos: ProdutosAdapter;
  vendas: VendasAdapter;
  caixa: CaixaAdapter;
  financeiro: FinanceiroAdapter;
  estoque: EstoqueAdapter;
  clientes: ClientesAdapter;
  fornecedores: FornecedoresAdapter;
  funcionarios: FuncionariosAdapter;
  categoriasProduto: CategoriasProdutoAdapter;
  categoriasFinanceiras: CategoriasFinanceirasAdapter;
  lotes: LotesAdapter;
  compras: ComprasAdapter;
  dashboard: DashboardAdapter;
  // realtime: RealtimeAdapter;
}
