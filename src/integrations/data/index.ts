/**
 * Barrel da camada de dados.
 * Hooks e componentes devem importar a partir daqui:
 *
 *   import { dataClient, type ProdutoBuscaResult } from "@/integrations/data";
 */
export { dataClient } from "./client";
export type { DataAdapter, ProdutosAdapter, VendasAdapter } from "./adapter";
export type {
  CodigoTipo,
  FinalizarVendaInput,
  FinalizarVendaItem,
  FinalizarVendaPagamento,
  FormaPagamento,
  Produto,
  ProdutoBuscaResult,
  ProdutoComCategoria,
  ProdutoPluResult,
  StatusPagamento,
  TipoIdentificacao,
} from "./types";
export { getDataMode, type DataMode } from "./mode";
