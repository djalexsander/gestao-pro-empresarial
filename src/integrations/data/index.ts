/**
 * Barrel da camada de dados.
 * Hooks e componentes devem importar a partir daqui:
 *
 *   import { dataClient, type ProdutoBuscaResult } from "@/integrations/data";
 */
export { dataClient } from "./client";
export type {
  CaixaAdapter,
  DataAdapter,
  FinanceiroAdapter,
  ProdutosAdapter,
  VendasAdapter,
} from "./adapter";
export type {
  AbrirCaixaInput,
  AlterarStatusVendaInput,
  AlterarStatusVendaResult,
  AlterarVencimentoLancamentoInput,
  AlterarVencimentoLancamentoResult,
  CaixaStatusDomain,
  CancelarLancamentoInput,
  CancelarLancamentoResult,
  CancelarVendaInput,
  CancelarVendaResumo,
  CodigoTipo,
  ConciliarIfoodIndividualInput,
  ConciliarIfoodLoteInput,
  ExcluirVendaCanceladaResult,
  FecharCaixaInput,
  FecharCaixaResult,
  FinalizarVendaInput,
  FinalizarVendaItem,
  FinalizarVendaPagamento,
  FormaPagamento,
  FormaPagamentoLancamento,
  ItemEstornado,
  LancamentoCancelado,
  Produto,
  ProdutoBuscaResult,
  ProdutoComCategoria,
  ProdutoPluResult,
  ReabrirLancamentoResult,
  RegistrarMovimentoCaixaInput,
  RegistrarPagamentoLancamentoInput,
  RegistrarPagamentoLancamentoResult,
  RemoverPagamentoLancamentoResult,
  StatusPagamento,
  StatusVendaEditavelDomain,
  TipoIdentificacao,
} from "./types";
export { getDataMode, type DataMode } from "./mode";
