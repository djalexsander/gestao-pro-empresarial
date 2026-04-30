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
  ProdutosAdapter,
  VendasAdapter,
} from "./adapter";
export type {
  AbrirCaixaInput,
  CaixaStatusDomain,
  CodigoTipo,
  FecharCaixaInput,
  FecharCaixaResult,
  FinalizarVendaInput,
  FinalizarVendaItem,
  FinalizarVendaPagamento,
  FormaPagamento,
  Produto,
  ProdutoBuscaResult,
  ProdutoComCategoria,
  ProdutoPluResult,
  RegistrarMovimentoCaixaInput,
  StatusPagamento,
  TipoIdentificacao,
} from "./types";
export { getDataMode, type DataMode } from "./mode";
