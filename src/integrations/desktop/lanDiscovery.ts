/**
 * ============================================================================
 * Descoberta de servidores Gestão Pro na LAN
 * ============================================================================
 *
 * Estratégia leve client-side: sondamos /health em IPs candidatos da rede
 * local (pequena janela de hosts). Útil para o wizard "Procurar servidores".
 *
 * Sem mDNS porque o ambiente do browser não expõe; o Tauri pode no futuro
 * complementar via comando nativo. Por enquanto funciona "bom o bastante".
 */

import {
  fetchServerInfo,
  pingServidorLocal,
  type ServerInfoPayload,
  type ServerConnInfo,
} from "./serverConnection";
import type { TerminalConexaoConfig } from "./types";

export interface ServidorEncontrado {
  host: string;
  porta: number;
  baseUrl: string;
  latenciaMs: number | null;
  serverName: string | null;
  serverId: string | null;
  serverVersion: string | null;
  hostname: string | null;
  info: ServerInfoPayload | null;
}

/**
 * Portas usadas pelo backend local em diferentes builds. Mantemos curto
 * para não estourar tempo da varredura.
 */
const PORTAS_PADRAO = [7400, 8420, 3333];

/** Tenta inferir prefixos /24 a partir do host atual quando possível. */
function inferirPrefixos(): string[] {
  const prefixos = new Set<string>();
  // Heurística: se o app é servido por hostname com IP, usamos o /24 dele.
  const loc =
    typeof window !== "undefined" ? window.location.hostname : "";
  const m = loc.match(/^(\d+\.\d+\.\d+)\.\d+$/);
  if (m) prefixos.add(m[1]);
  // Faixas comuns de roteadores domésticos / pequenos comércios.
  prefixos.add("192.168.0");
  prefixos.add("192.168.1");
  prefixos.add("192.168.15"); // padrão Vivo/Intelbras
  prefixos.add("10.0.0");
  return Array.from(prefixos);
}

async function probe(
  host: string,
  porta: number,
): Promise<ServidorEncontrado | null> {
  const cfg: TerminalConexaoConfig = {
    host,
    porta,
    terminalId: "discovery",
    terminalNome: "discovery",
  };
  const c: ServerConnInfo = await pingServidorLocal(cfg);
  if (c.status !== "online") return null;
  const info = await fetchServerInfo(cfg);
  return {
    host,
    porta,
    baseUrl: c.baseUrl ?? `http://${host}:${porta}`,
    latenciaMs: c.latenciaMs,
    serverName: c.serverName ?? info?.server_name ?? null,
    serverId: c.serverId ?? info?.server_id ?? null,
    serverVersion: c.serverVersion ?? info?.version ?? null,
    hostname: info?.hostname ?? null,
    info,
  };
}

/**
 * Varre IPs da LAN em paralelo. Limita concorrência para não travar a aba.
 * Aceita um sinal de cancelamento e callback de progresso.
 */
export async function descobrirServidoresLan(opts?: {
  prefixos?: string[];
  portas?: number[];
  /** Quantos IPs do /24 testar a partir do .1 (default 30). */
  intervalo?: number;
  /** Concorrência máxima. */
  paralelismo?: number;
  signal?: AbortSignal;
  onProgresso?: (pct: number) => void;
  onEncontrado?: (s: ServidorEncontrado) => void;
}): Promise<ServidorEncontrado[]> {
  const prefixos = opts?.prefixos ?? inferirPrefixos();
  const portas = opts?.portas ?? PORTAS_PADRAO;
  const intervalo = opts?.intervalo ?? 30;
  const paralelismo = opts?.paralelismo ?? 16;

  // Monta a lista de alvos.
  const alvos: Array<{ host: string; porta: number }> = [];
  // Sempre tenta loopback primeiro.
  for (const porta of portas) alvos.push({ host: "127.0.0.1", porta });
  for (const prefixo of prefixos) {
    for (let i = 1; i <= intervalo; i++) {
      for (const porta of portas) {
        alvos.push({ host: `${prefixo}.${i}`, porta });
      }
    }
  }

  const encontrados: ServidorEncontrado[] = [];
  const dedup = new Set<string>();
  let feitos = 0;

  // Worker pool simples.
  let cursor = 0;
  async function worker() {
    while (true) {
      if (opts?.signal?.aborted) return;
      const idx = cursor++;
      if (idx >= alvos.length) return;
      const { host, porta } = alvos[idx];
      const r = await probe(host, porta);
      feitos++;
      opts?.onProgresso?.(Math.min(100, Math.round((feitos / alvos.length) * 100)));
      if (r && r.serverId && !dedup.has(r.serverId)) {
        dedup.add(r.serverId);
        encontrados.push(r);
        opts?.onEncontrado?.(r);
      } else if (r && !r.serverId) {
        const key = `${r.host}:${r.porta}`;
        if (!dedup.has(key)) {
          dedup.add(key);
          encontrados.push(r);
          opts?.onEncontrado?.(r);
        }
      }
    }
  }

  await Promise.all(
    Array.from({ length: paralelismo }, () => worker()),
  );
  return encontrados;
}
