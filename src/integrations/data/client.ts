/**
 * ============================================================================
 * dataClient — Ponto único de acesso a dados do app
 * ============================================================================
 *
 * Hooks e componentes devem importar daqui:
 *
 *   import { dataClient } from "@/integrations/data/client";
 *   const produto = await dataClient.produtos.buscarPorCodigo("789...");
 *
 * O modo de operação (`cloud` | `local-server` | `local-terminal` | `hybrid`)
 * é resolvido em `mode.ts`. Adicionar um novo modo significa:
 *   1. criar `adapters/<modo>.ts` implementando `DataAdapter`;
 *   2. registrá-lo no `switch` abaixo.
 *
 * Nenhum outro arquivo precisa ser tocado.
 */

import type { DataAdapter } from "./adapter";
import { cloudAdapter } from "./adapters/cloud";
import { getDataMode } from "./mode";

function resolveAdapter(): DataAdapter {
  const mode = getDataMode();
  switch (mode) {
    case "cloud":
      return cloudAdapter;
    case "local-server":
    case "local-terminal":
    case "hybrid":
      // Implementações futuras (Fases 3-5). Por enquanto cai no cloud
      // para não quebrar caso alguém ative a env var antes do tempo.
      // eslint-disable-next-line no-console
      console.warn(
        `[data] modo "${mode}" ainda não implementado — usando cloud adapter.`,
      );
      return cloudAdapter;
    default:
      return cloudAdapter;
  }
}

export const dataClient: DataAdapter = resolveAdapter();
