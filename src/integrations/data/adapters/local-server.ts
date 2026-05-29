/**
 * ============================================================================
 * local-server adapter — Servidor Local (mesma máquina que roda o backend)
 * ============================================================================
 *
 * Nesta etapa incremental:
 *  - A fonte de dados continua sendo Lovable Cloud (Supabase).
 *  - O adapter delega ao `cloudAdapter`, mas marca a origem como
 *    "local-server" para refletir a arquitetura: esta máquina é o servidor
 *    local da loja, e seus terminais consomem dados ATRAVÉS dela.
 *  - Para os domínios escolhidos (produtos.list / estoque.* / clientes.listLite),
 *    o adapter reporta `source: "local-server"` na telemetria.
 *
 * Próxima etapa: trocar o cloudAdapter por um cliente Postgres local quando
 * o banco local estiver instalado. A interface não muda.
 */

import type { DataAdapter } from "../adapter";
import { cloudAdapter } from "./cloud";
import { reportDataSource } from "../source-telemetry";

const LOCAL_READ_DOMAINS = ["produtos", "estoque", "clientes"] as const;

function wrapRead<TFn extends (...args: any[]) => Promise<any>>(
  domain: string,
  method: string,
  fn: TFn,
): TFn {
  return (async (...args: Parameters<TFn>) => {
    const result = await fn(...args);
    reportDataSource({
      source: "local-server",
      domain,
      method,
      fallback: false,
    });
    return result;
  }) as TFn;
}

// Compõe o adapter: 100% delegação ao cloud, com instrumentação nas leituras
// dos domínios "provados" nesta etapa.
export const localServerAdapter: DataAdapter = {
  ...cloudAdapter,
  produtos: {
    ...cloudAdapter.produtos,
    listar: wrapRead("produtos", "listar", cloudAdapter.produtos.listar.bind(cloudAdapter.produtos)),
    list: wrapRead("produtos", "list", cloudAdapter.produtos.list.bind(cloudAdapter.produtos)),
    buscarPorCodigo: wrapRead(
      "produtos",
      "buscarPorCodigo",
      cloudAdapter.produtos.buscarPorCodigo.bind(cloudAdapter.produtos),
    ),
    buscarPorPlu: wrapRead(
      "produtos",
      "buscarPorPlu",
      cloudAdapter.produtos.buscarPorPlu.bind(cloudAdapter.produtos),
    ),
  },
  estoque: {
    ...cloudAdapter.estoque,
    saldosLinhas: wrapRead(
      "estoque",
      "saldosLinhas",
      cloudAdapter.estoque.saldosLinhas.bind(cloudAdapter.estoque),
    ),
    movimentacoes: wrapRead(
      "estoque",
      "movimentacoes",
      cloudAdapter.estoque.movimentacoes.bind(cloudAdapter.estoque),
    ),
  },
  clientes: {
    ...cloudAdapter.clientes,
    listLite: wrapRead(
      "clientes",
      "listLite",
      cloudAdapter.clientes.listLite.bind(cloudAdapter.clientes),
    ),
  },
};

export { LOCAL_READ_DOMAINS };
