/**
 * Barrel da camada de dados.
 * Hooks e componentes devem importar a partir daqui:
 *
 *   import { dataClient, type ProdutoBuscaResult } from "@/integrations/data";
 */
export { dataClient } from "./client";
export type { DataAdapter, ProdutosAdapter } from "./adapter";
export type { CodigoTipo, ProdutoBuscaResult } from "./types";
export { getDataMode, type DataMode } from "./mode";
