/**
 * ============================================================================
 * Camada de Dados — Tipos compartilhados
 * ============================================================================
 *
 * Tipos de domínio independentes da fonte de dados (cloud, local-server,
 * local-terminal, hybrid). Os adapters implementam a interface `DataAdapter`
 * usando esses tipos. Hooks/componentes consomem APENAS estes tipos — nunca
 * tipos específicos do Supabase.
 *
 * Manter este arquivo livre de qualquer import de cliente concreto
 * (sem `@/integrations/supabase/...`).
 */

// -------------------- Códigos de produto --------------------

export type CodigoTipo = "codigo_barras" | "qr_code" | "sku" | "interno" | "alternativo";

export interface ProdutoBuscaResult {
  produto_id: string;
  sku: string;
  nome: string;
  codigo_barras: string | null;
  qr_code: string | null;
  codigo_interno: string | null;
  tipo_identificacao_principal: string;
  preco_venda: number;
  preco_custo: number;
  unidade: string;
  status: "ativo" | "inativo" | "descontinuado";
  categoria_id: string | null;
  categoria_nome: string | null;
  fonte: CodigoTipo;
  saldo_estoque: number;
}

// -------------------- PLU (balança) --------------------

export interface ProdutoPluResult {
  produto_id: string;
  sku: string;
  nome: string;
  unidade: string;
  preco_venda: number;
  vendido_por_peso: boolean;
  aceita_etiqueta_balanca: boolean;
  plu: string | null;
  status: "ativo" | "inativo" | "descontinuado";
}

// -------------------- Listagem de produtos --------------------

export type TipoIdentificacao = "sku" | "codigo_barras" | "qr_code" | "codigo_interno";

export type Produto = {
  id: string;
  sku: string;
  codigo_barras: string | null;
  qr_code: string | null;
  codigo_interno: string | null;
  tipo_identificacao_principal: TipoIdentificacao;
  observacao_tecnica: string | null;
  nome: string;
  descricao: string | null;
  marca: string | null;
  unidade: string;
  categoria_id: string | null;
  preco_custo: number;
  preco_venda: number;
  estoque_minimo: number;
  estoque_inicial: number;
  status: "ativo" | "inativo" | "descontinuado";
  ncm: string | null;
  created_at: string;
  updated_at: string;
};

export type ProdutoComCategoria = Produto & {
  categoria: { id: string; nome: string } | null;
};

// -------------------- Vendas (PDV) --------------------

export type FormaPagamento =
  | "dinheiro"
  | "pix"
  | "cartao_debito"
  | "cartao_credito"
  | "boleto"
  | "ifood"
  | "fiado"
  | "transferencia"
  | "cheque"
  | "outro";

export type StatusPagamento = "pago" | "pendente" | "parcial" | "cancelado";

/**
 * Item de uma venda enviado ao backend. Inclui campos de auditoria de balança
 * (etiqueta lida, PLU extraído, peso, etc.) — todos opcionais.
 */
export interface FinalizarVendaItem {
  produto_id: string;
  quantidade: number;
  preco_unitario: number;
  desconto: number;
  descricao?: string | null;
  vendido_por_peso?: boolean;
  preco_por_kg?: number | null;
  codigo_lido?: string | null;
  plu_extraido?: string | null;
  peso_extraido?: number | null;
  valor_extraido?: number | null;
  tipo_interpretacao?: "peso" | "valor" | "manual" | null;
}

export interface FinalizarVendaPagamento {
  forma_pagamento: FormaPagamento;
  valor: number;
  valor_recebido?: number | null;
  troco?: number | null;
  parcelas?: number | null;
  observacao?: string | null;
}

/**
 * Payload completo para finalizar uma venda no PDV.
 *
 * IDEMPOTÊNCIA: o campo `client_uuid` é a chave de idempotência. Deve ser
 * gerado pelo PDV no início do carrinho e mantido estável até a venda ser
 * finalizada/cancelada/limpa. Reenviar o mesmo `client_uuid` retorna o ID da
 * venda já criada, sem duplicar nada (venda, itens, baixa de estoque,
 * pagamentos, lançamento financeiro ou movimento de caixa).
 */
// -------------------- Caixa --------------------

export type CaixaStatusDomain = "aberto" | "fechado";

export interface AbrirCaixaInput {
  valor_inicial: number;
  observacao?: string | null;
  operador_id?: string | null;
  terminal_id?: string | null;
}

export interface FecharCaixaInput {
  caixa_id: string;
  valor_informado: number;
  observacao?: string | null;
}

export interface FecharCaixaResult {
  caixa_id: string;
  valor_esperado: number;
  valor_informado: number;
  diferenca: number;
  fechado_em: string;
}

/**
 * Movimento operacional do caixa (sangria/suprimento).
 *
 * - **suprimento**: entrada operacional de dinheiro físico na gaveta.
 * - **sangria**: saída operacional de dinheiro físico da gaveta.
 *
 * Esses movimentos NÃO são receita nem despesa — não viram lançamento no
 * Financeiro. Eles existem apenas para o controle de caixa operacional.
 *
 * **Idempotência:** envie `client_uuid` estável (1 por modal aberto). Reenvio
 * com mesmo UUID retorna o id existente sem duplicar movimento.
 */
export interface RegistrarMovimentoCaixaInput {
  caixa_id: string;
  tipo: "sangria" | "suprimento";
  valor: number;
  motivo?: string | null;
  /** Chave de idempotência. Recomendado preencher SEMPRE. */
  client_uuid?: string | null;
}

export interface FinalizarVendaInput {
  cliente_id: string | null;
  subtotal: number;
  desconto: number;
  total: number;
  forma_pagamento: FormaPagamento;
  status_pagamento: StatusPagamento;
  valor_recebido: number | null;
  troco: number | null;
  observacao: string | null;
  itens: FinalizarVendaItem[];
  pagamentos?: FinalizarVendaPagamento[];
  gerar_financeiro?: boolean;
  operador_id?: string | null;
  terminal_id?: string | null;
  /** Chave de idempotência. Recomendado preencher SEMPRE no PDV. */
  client_uuid?: string | null;
}

// -------------------- Cancelar / Excluir venda --------------------

export interface CancelarVendaInput {
  venda_id: string;
  motivo?: string | null;
}

export interface ItemEstornado {
  produto_id: string;
  produto_nome: string;
  quantidade: number;
  saldo_anterior: number;
  saldo_posterior: number;
  valor_total: number;
}

export interface LancamentoCancelado {
  id: string;
  descricao: string;
  valor: number;
  valor_pago: number;
  tipo: string;
  status_anterior: string;
}

/**
 * Resultado consolidado do cancelamento de venda.
 *
 * O cancelamento é uma **operação composta transacional** que afeta:
 *  - `vendas`           → status = 'cancelada', status_pagamento = 'cancelado'
 *  - `estoque_movimentacoes` → grava 1 linha 'devolucao' por item (estorno)
 *  - `financeiro_lancamentos` → marca todos os lançamentos vinculados como
 *    'cancelado' (mantém histórico, NÃO apaga)
 *
 * NÃO toca em `caixa_movimentos` da venda original (o movimento de caixa do
 * dia continua refletindo o que aconteceu fisicamente — o estorno é tratado
 * como evento separado pelo fluxo de caixa).
 */
export interface CancelarVendaResumo {
  venda_id: string;
  numero: string;
  total: number;
  motivo: string | null;
  cancelado_em: string;
  qtd_itens_estornados: number;
  qtd_total_estornada: number;
  itens_estornados: ItemEstornado[];
  qtd_lancamentos_cancelados: number;
  total_lancamentos_cancelados: number;
  lancamentos_cancelados: LancamentoCancelado[];
}

/**
 * Resultado da exclusão definitiva de uma venda **já cancelada**.
 *
 * Regras (validadas no banco):
 *  - SOMENTE vendas com status='cancelada' podem ser excluídas.
 *  - Pagamentos da venda (`venda_pagamentos`) são removidos fisicamente.
 *  - Lançamentos financeiros têm `venda_id` desvinculado (mantém histórico
 *    como lançamento avulso cancelado).
 *  - Movimentos de estoque têm `venda_id` desvinculado (mantém histórico
 *    do estorno).
 *  - A linha de `vendas` é deletada (itens caem por cascade).
 */
export interface ExcluirVendaCanceladaResult {
  venda_id: string;
  numero: string;
  excluida_em: string;
}

// -------------------- Alterar status da venda --------------------

/**
 * Status editáveis manualmente para uma venda **não cancelada**.
 *
 * - `pago`      → quita TODOS os lançamentos vinculados (cria
 *                 `lancamento_pagamentos` para o saldo restante de cada um).
 * - `pendente`  → zera pagamentos e volta lançamentos para `pendente`.
 * - `parcial`   → mantém pagamentos atuais; força status coerente.
 * - `vencido`   → derivado pelo vencimento; força `pendente` para que a
 *                 derivação atue.
 * - `cancelado` → marca lançamentos como `cancelado` (NÃO estorna estoque,
 *                 NÃO cancela a venda — para cancelamento real, use
 *                 `vendas.cancelar`).
 *
 * Vendas com `status='cancelada'` NÃO podem ter o status alterado por aqui.
 */
export type StatusVendaEditavelDomain = "pago" | "pendente" | "parcial" | "cancelado" | "vencido";

export interface AlterarStatusVendaInput {
  venda_id: string;
  novo_status: StatusVendaEditavelDomain;
  motivo?: string | null;
}

/**
 * Resultado consolidado da RPC `alterar_status_venda`.
 *
 * O backend retorna um JSON livre (`jsonb`); aqui normalizamos os campos
 * mais comuns. Campos extras seguem disponíveis em `raw`.
 */
export interface AlterarStatusVendaResult {
  venda_id: string;
  novo_status: StatusVendaEditavelDomain;
  qtd_lancamentos_alterados: number;
  raw: Record<string, unknown>;
}

// -------------------- Financeiro / Lançamentos --------------------

/**
 * Forma de pagamento aceita em **lancamento_pagamentos** (baixa de título).
 *
 * Refere-se ao enum `forma_pagamento` do banco. Compartilha valores com
 * `FormaPagamento` da venda, mas é declarada à parte para deixar explícito
 * que aqui é a forma da BAIXA (recebimento/pagamento), não da venda.
 */
export type FormaPagamentoLancamento = FormaPagamento;

/**
 * Registrar pagamento (parcial ou total) em um título.
 *
 * **Idempotência:** envie `client_uuid` estável (1 por modal aberto).
 * Reenvio com mesmo UUID retorna o pagamento existente sem duplicar.
 *
 * O banco garante via triggers:
 *  - `validar_pagamento_lancamento`: rejeita pagamento que ultrapasse o
 *    saldo do título e bloqueia pagamento em título `cancelado`.
 *  - `recalcular_lancamento_apos_pagamento`: recalcula `valor_pago`,
 *    `data_pagamento` (mais recente) e `status` (pendente/parcial/pago/recebido).
 */
export interface RegistrarPagamentoLancamentoInput {
  lancamento_id: string;
  valor: number;
  data_pagamento: string; // YYYY-MM-DD
  forma_pagamento?: FormaPagamentoLancamento | null;
  observacao?: string | null;
  /** Chave de idempotência. Recomendado preencher SEMPRE. */
  client_uuid?: string | null;
}

export interface RegistrarPagamentoLancamentoResult {
  pagamento_id: string;
  lancamento_id: string;
  /** `true` se a chamada não criou pagamento novo (mesma chave já existia). */
  idempotente: boolean;
}

export interface RemoverPagamentoLancamentoResult {
  removido: boolean;
  /** `true` se o pagamento já não existia (chamada idempotente). */
  idempotente?: boolean;
  lancamento_id?: string;
}

export interface CancelarLancamentoInput {
  lancamento_id: string;
  motivo?: string | null;
}

export interface CancelarLancamentoResult {
  lancamento_id: string;
  /** `true` se o título já estava cancelado. */
  idempotente: boolean;
}

export interface ReabrirLancamentoResult {
  lancamento_id: string;
  novo_status: "pendente" | "parcial" | "pago" | "recebido";
}

export interface AlterarVencimentoLancamentoInput {
  lancamento_id: string;
  /** YYYY-MM-DD */
  nova_data: string;
}

export interface AlterarVencimentoLancamentoResult {
  lancamento_id: string;
  data_vencimento: string;
}

// -------------------- Lançamento avulso (a pagar / a receber) --------------------

/**
 * Tipo do lançamento avulso. Não cobre `receita`/`despesa` (esses são tipos
 * derivados usados pelo DRE; lançamentos avulsos sempre nascem como
 * `pagar` ou `receber`).
 */
export type LancamentoAvulsoTipo = "receber" | "pagar";

/**
 * Criar um lançamento financeiro avulso (a pagar ou a receber, sem venda).
 *
 * **Idempotência:** envie `client_uuid` estável (1 por dialog aberto).
 * Reenvio com mesmo UUID retorna o lançamento existente sem duplicar
 * (cobre duplo clique no botão Salvar, Enter repetido e retry de rede).
 *
 * **Server-side garante:**
 *  - tipo restrito a `receber`/`pagar`,
 *  - validação de descrição/valor/vencimento obrigatórios,
 *  - status inicial sempre `pendente`,
 *  - vincular a venda/compra é **bloqueado por aqui** — esses fluxos têm
 *    suas próprias RPCs (`finalizar_venda_pdv`, etc.).
 */
export interface CriarLancamentoAvulsoInput {
  tipo: LancamentoAvulsoTipo;
  descricao: string;
  valor: number;
  data_vencimento: string; // YYYY-MM-DD
  data_emissao?: string | null; // YYYY-MM-DD; default = hoje
  categoria_id?: string | null;
  cliente_id?: string | null;
  fornecedor_id?: string | null;
  numero_documento?: string | null;
  forma_pagamento?: FormaPagamentoLancamento | null;
  observacoes?: string | null;
  /** Chave de idempotência. Recomendado preencher SEMPRE. */
  client_uuid?: string | null;
}

export interface CriarLancamentoAvulsoResult {
  lancamento_id: string;
  /** `true` se a chamada não criou lançamento novo (mesma chave já existia). */
  idempotente: boolean;
}

/**
 * Editar campos de um lançamento avulso.
 *
 * **Bloqueado pelo banco:**
 *  - lançamentos vinculados a venda/compra (use o fluxo da venda),
 *  - lançamentos `cancelado`, `pago` ou `recebido`,
 *  - reduzir `valor` abaixo do total já pago.
 *
 * **Idempotência:** envie `client_uuid` estável por dialog. Reenvio com mesmo
 * UUID em cima do MESMO lançamento retorna sem reaplicar. Reuso do UUID em
 * outro lançamento gera erro (proteção contra erro de programação).
 *
 * `tipo` (receber/pagar) NÃO pode ser alterado — para mudar tipo, exclua e
 * recrie.
 */
export interface EditarLancamentoAvulsoInput {
  lancamento_id: string;
  descricao: string;
  valor: number;
  data_vencimento: string; // YYYY-MM-DD
  data_emissao?: string | null;
  categoria_id?: string | null;
  cliente_id?: string | null;
  fornecedor_id?: string | null;
  numero_documento?: string | null;
  forma_pagamento?: FormaPagamentoLancamento | null;
  observacoes?: string | null;
  client_uuid?: string | null;
}

export interface EditarLancamentoAvulsoResult {
  lancamento_id: string;
  idempotente: boolean;
}

/**
 * Excluir DEFINITIVAMENTE um lançamento avulso.
 *
 * **Permitido apenas se:**
 *  - não vinculado a venda/compra,
 *  - sem nenhum pagamento registrado em `lancamento_pagamentos`,
 *  - status `pendente` ou `cancelado`.
 *
 * Para qualquer outro caso (já houve baixa), use `cancelarLancamento` —
 * preserva o histórico de pagamentos.
 */
export interface ExcluirLancamentoAvulsoResult {
  lancamento_id: string;
  excluido: boolean;
}

// -------------------- Estoque (movimentação manual) --------------------

/**
 * Tipo de movimentação manual de estoque.
 *
 * - `entrada`        → soma quantidade ao saldo.
 * - `saida`          → subtrai quantidade do saldo.
 * - `ajuste`         → soma quantidade (use sinal positivo para acertar p/cima;
 *                      no UI, valor negativo é convertido para `saida`).
 * - `devolucao`      → soma quantidade (devolução de cliente).
 * - `transferencia`  → subtrai quantidade (saída para outro depósito/loja).
 */
export type MovimentacaoEstoqueTipo =
  | "entrada"
  | "saida"
  | "ajuste"
  | "devolucao"
  | "transferencia";

export type MovimentacaoEstoqueOrigem =
  | "compra"
  | "venda"
  | "ajuste_manual"
  | "devolucao_cliente"
  | "devolucao_fornecedor"
  | "inventario"
  | "outro";

/**
 * Registrar uma movimentação manual de estoque.
 *
 * **Idempotência:** envie `client_uuid` estável (1 por modal aberto).
 * Reenvio com mesmo UUID retorna o movimento existente sem duplicar
 * baixa/entrada de estoque.
 *
 * **Server-side garante:**
 *  - lock advisory por produto (`pg_advisory_xact_lock`) → serializa
 *    movimentações concorrentes do mesmo item entre vários terminais.
 *  - recálculo de `saldo_anterior`/`saldo_posterior` no banco a partir do
 *    histórico (não confia no que o cliente enviou).
 *  - bloqueia saída/transferência que deixaria o estoque negativo.
 */
export interface RegistrarMovimentoEstoqueInput {
  produto_id: string;
  variacao_id?: string | null;
  tipo: MovimentacaoEstoqueTipo;
  /** Sempre positivo. Sinal vem do `tipo`. */
  quantidade: number;
  custo_unitario?: number | null;
  observacoes?: string | null;
  origem?: MovimentacaoEstoqueOrigem | null;
  /** Chave de idempotência. Recomendado preencher SEMPRE. */
  client_uuid?: string | null;
}

export interface RegistrarMovimentoEstoqueResult {
  movimento_id: string;
  /** `true` se a chamada não criou movimento novo (mesma chave já existia). */
  idempotente: boolean;
  saldo_anterior: number;
  saldo_posterior: number;
}

// -------------------- Conciliação iFood --------------------

export interface ConciliarIfoodIndividualInput {
  lancamento_id: string;
  data_repasse: string; // YYYY-MM-DD
  valor_repasse: number;
  numero_repasse?: string | null;
  observacao?: string | null;
}

export interface ConciliarIfoodLoteInput {
  lancamento_ids: string[];
  data_repasse: string;
  valor_repasse_total: number;
  numero_repasse?: string | null;
  observacao?: string | null;
}

// -------------------- Cliente / Fornecedor (cadastros) --------------------

export type PessoaTipoDomain = "PF" | "PJ";
export type CadastroStatusDomain = "ativo" | "inativo";

/**
 * Campos compartilhados pelo formulário de cliente. Todas as strings vazias
 * podem chegar como `null` — a RPC normaliza com `NULLIF(trim(...), '')`.
 */
export interface CriarClienteInput {
  tipo: PessoaTipoDomain;
  nome: string;
  nome_fantasia?: string | null;
  documento?: string | null;
  inscricao_estadual?: string | null;
  email?: string | null;
  telefone?: string | null;
  celular?: string | null;
  data_nascimento?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  observacoes?: string | null;
  status?: CadastroStatusDomain;
  /** Idempotência. Recomendado preencher por dialog aberto. */
  client_uuid?: string | null;
}

export interface CriarClienteResult {
  cliente_id: string;
  idempotente: boolean;
}

export interface EditarClienteInput extends CriarClienteInput {
  cliente_id: string;
}

export interface EditarClienteResult {
  cliente_id: string;
}

export interface AlterarStatusClienteInput {
  cliente_id: string;
  status: CadastroStatusDomain;
}

export interface AlterarStatusClienteResult {
  cliente_id: string;
  status: CadastroStatusDomain;
}

export interface ExcluirClienteResult {
  cliente_id: string;
  excluido: boolean;
}

export interface CriarFornecedorInput {
  tipo: PessoaTipoDomain;
  razao_social: string;
  nome_fantasia?: string | null;
  documento?: string | null;
  inscricao_estadual?: string | null;
  email?: string | null;
  telefone?: string | null;
  contato_nome?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  estado?: string | null;
  observacoes?: string | null;
  status?: CadastroStatusDomain;
  client_uuid?: string | null;
}

export interface CriarFornecedorResult {
  fornecedor_id: string;
  idempotente: boolean;
}

export interface EditarFornecedorInput extends CriarFornecedorInput {
  fornecedor_id: string;
}

export interface EditarFornecedorResult {
  fornecedor_id: string;
}

export interface AlterarStatusFornecedorInput {
  fornecedor_id: string;
  status: CadastroStatusDomain;
}

export interface AlterarStatusFornecedorResult {
  fornecedor_id: string;
  status: CadastroStatusDomain;
}

export interface ExcluirFornecedorResult {
  fornecedor_id: string;
  excluido: boolean;
}

// -------------------- Produto / Códigos / Variações / Categoria --------------

export type ProdutoStatusDomain = "ativo" | "inativo" | "descontinuado";

// -------------------- Categorias de produto --------------------

export interface CriarCategoriaProdutoInput {
  nome: string;
  parent_id?: string | null;
  descricao?: string | null;
  client_uuid?: string | null;
}

export interface CriarCategoriaProdutoResult {
  categoria_id: string;
  idempotente: boolean;
}

export interface EditarCategoriaProdutoInput {
  categoria_id: string;
  nome: string;
  parent_id?: string | null;
  descricao?: string | null;
}

export interface EditarCategoriaProdutoResult {
  categoria_id: string;
}

export interface AlterarStatusCategoriaProdutoInput {
  categoria_id: string;
  ativo: boolean;
}

export interface AlterarStatusCategoriaProdutoResult {
  categoria_id: string;
  ativo: boolean;
  idempotente: boolean;
}

export interface ExcluirCategoriaProdutoResult {
  categoria_id: string;
  excluido: boolean;
}

// -------------------- Categorias financeiras --------------------

export type CategoriaFinanceiraTipoDomain = "receita" | "despesa";

export interface CriarCategoriaFinanceiraInput {
  nome: string;
  tipo: CategoriaFinanceiraTipoDomain;
  parent_id?: string | null;
  cor?: string | null;
  client_uuid?: string | null;
}

export interface CriarCategoriaFinanceiraResult {
  categoria_id: string;
  idempotente: boolean;
}

export interface EditarCategoriaFinanceiraInput {
  categoria_id: string;
  nome: string;
  /** O `tipo` (receita/despesa) NÃO pode ser alterado — preserva relatórios. */
  parent_id?: string | null;
  cor?: string | null;
}

export interface EditarCategoriaFinanceiraResult {
  categoria_id: string;
}

export interface AlterarStatusCategoriaFinanceiraInput {
  categoria_id: string;
  ativo: boolean;
}

export interface AlterarStatusCategoriaFinanceiraResult {
  categoria_id: string;
  ativo: boolean;
  idempotente: boolean;
}

export interface ExcluirCategoriaFinanceiraResult {
  categoria_id: string;
  excluido: boolean;
}

export interface CriarProdutoInput {
  sku: string;
  nome: string;
  unidade: string;
  preco_custo: number;
  preco_venda: number;
  estoque_minimo: number;
  status: ProdutoStatusDomain;
  tipo_identificacao_principal?: TipoIdentificacao;
  codigo_barras?: string | null;
  qr_code?: string | null;
  codigo_interno?: string | null;
  observacao_tecnica?: string | null;
  descricao?: string | null;
  marca?: string | null;
  categoria_id?: string | null;
  estoque_inicial?: number;
  ncm?: string | null;
  vendido_por_peso?: boolean;
  plu?: string | null;
  aceita_etiqueta_balanca?: boolean;
  casas_decimais_quantidade?: number;
  client_uuid?: string | null;
}

export interface CriarProdutoResult {
  produto_id: string;
  idempotente: boolean;
}

export interface EditarProdutoInput extends CriarProdutoInput {
  produto_id: string;
}

export interface EditarProdutoResult {
  produto_id: string;
}

export interface AlterarStatusProdutoInput {
  produto_id: string;
  status: ProdutoStatusDomain;
}

export interface AlterarStatusProdutoResult {
  produto_id: string;
  status: ProdutoStatusDomain;
}

export interface ExcluirProdutoResult {
  produto_id: string;
  excluido: boolean;
}

// ---- Códigos auxiliares ----

export interface AdicionarProdutoCodigoInput {
  produto_id: string;
  tipo_codigo: CodigoTipo;
  valor_codigo: string;
  variacao_id?: string | null;
  observacao?: string | null;
  client_uuid?: string | null;
}

export interface AdicionarProdutoCodigoResult {
  codigo_id: string;
  idempotente: boolean;
}

export interface ExcluirProdutoCodigoResult {
  codigo_id: string;
  excluido: boolean;
}

// ---- Variações ----

export interface CriarProdutoVariacaoInput {
  produto_id: string;
  sku: string;
  nome: string;
  atributos?: Record<string, string>;
  preco_custo?: number | null;
  preco_venda?: number | null;
  codigo_barras?: string | null;
  client_uuid?: string | null;
}

export interface CriarProdutoVariacaoResult {
  variacao_id: string;
  idempotente: boolean;
}

export interface ExcluirProdutoVariacaoResult {
  variacao_id: string;
  excluido: boolean;
}

// -------------------- Funcionários (operadores PDV) --------------

export type FuncionarioRoleDomain = "gerente" | "caixa";

/**
 * Sessão devolvida ao validar PIN do operador. NUNCA contém o hash.
 */
export interface OperadorSessaoDomain {
  id: string;
  nome: string;
  login: string;
  role: FuncionarioRoleDomain;
}

/**
 * Criar funcionário com PIN.
 *
 * **PIN: nunca é hasheado no cliente.** O texto puro vai pela conexão TLS
 * direto para a RPC, que aplica `crypt(pin, gen_salt('bf', 8))` no banco.
 * O cliente nunca vê — nem deve persistir — o hash.
 *
 * **Idempotência:** envie `client_uuid` estável (1 por dialog). Reenvio com
 * mesmo UUID retorna o mesmo `funcionario_id` sem duplicar nem trocar PIN.
 */
export interface CriarFuncionarioInput {
  nome: string;
  login: string;
  /** 4 a 8 dígitos numéricos. Validado server-side. */
  pin: string;
  role: FuncionarioRoleDomain;
  client_uuid?: string | null;
}

export interface CriarFuncionarioResult {
  funcionario_id: string;
  idempotente: boolean;
}

/**
 * Editar nome / login / role. **NÃO altera PIN** — para isso use
 * `resetarPin`. Isso evita que uma chamada de "editar dados" reaplique o
 * mesmo PIN antigo passado por engano.
 */
export interface EditarFuncionarioInput {
  funcionario_id: string;
  nome: string;
  login: string;
  role: FuncionarioRoleDomain;
}

export interface EditarFuncionarioResult {
  funcionario_id: string;
}

export interface AlterarStatusFuncionarioInput {
  funcionario_id: string;
  ativo: boolean;
}

export interface AlterarStatusFuncionarioResult {
  funcionario_id: string;
  ativo: boolean;
  idempotente: boolean;
}

/**
 * Hard delete. Permitido APENAS se o funcionário não tem caixa, movimento
 * de caixa, nem venda como operador. Caso contrário a RPC aborta com
 * `23503` orientando a inativar.
 */
export interface ExcluirFuncionarioResult {
  funcionario_id: string;
  excluido: boolean;
}

/**
 * Reset de PIN. PIN segue sendo enviado em texto e hasheado no banco.
 */
export interface ResetarPinFuncionarioInput {
  funcionario_id: string;
  pin: string;
}

/**
 * Input de validação de PIN.
 *
 * **Bloco 11 — Rate limit / lockout:**
 *   - Toda tentativa (válida ou não) é registrada em `funcionario_tentativas_pin`
 *     server-side (auditoria + base para rate limit).
 *   - 5 falhas em 10 min => operador é bloqueado por 15 min.
 *   - Mesmo no bloqueio o PIN NÃO é comparado — a RPC recusa antes.
 *   - Mensagens de erro (lançadas como exception, capturadas no toast da UI):
 *       * `"PIN incorreto. N tentativa(s) restante(s)."`  (ERRCODE P0001)
 *       * `"Operador temporariamente bloqueado. Tente novamente em N segundo(s)."` (ERRCODE P0003)
 *       * `"Muitas tentativas inválidas. Operador bloqueado por N segundo(s)."`    (ERRCODE P0003)
 *
 * Os campos `terminal_id`, `ip_address` e `user_agent` são opcionais e
 * usados apenas para o log de auditoria — NÃO afetam a regra de bloqueio,
 * que é por funcionário (e não por terminal). Isso é proposital: trocar
 * de terminal não deve permitir continuar tentando PIN do mesmo operador.
 */
export interface ValidarPinOperadorInput {
  funcionario_id: string;
  pin: string;
  terminal_id?: string | null;
  ip_address?: string | null;
  user_agent?: string | null;
}

/**
 * Desbloqueio manual de PIN por gerente/admin (Bloco 11).
 * Permitido apenas para owner ou membro com papel `owner`/`admin` da empresa.
 */
export interface DesbloquearPinOperadorInput {
  funcionario_id: string;
}

export interface DesbloquearPinOperadorResult {
  funcionario_id: string;
  desbloqueado: boolean;
}
