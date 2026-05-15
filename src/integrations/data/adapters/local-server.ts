/**
 * ============================================================================
 * local-server adapter — Servidor Local (esta MÁQUINA é o backend)
 * ============================================================================
 *
 * Etapa 2 (offline-first): em vez de delegar leituras direto ao cloudAdapter,
 * o adapter agora consome o backend HTTP local (Tauri/Axum em
 * `127.0.0.1:<port>`) para os domínios que já têm endpoint+SQLite no Rust:
 *
 *   - produtos.list             → GET /api/produtos/list
 *   - clientes.listLite         → GET /api/clientes/lite
 *   - fornecedores.list         → GET /api/fornecedores
 *   - estoque.saldosLinhas      → GET /api/estoque/saldos
 *   - estoque.movimentacoes     → GET /api/estoque/movimentacoes
 *   - funcionarios.list         → GET /api/relatorios/funcionarios-ativos
 *
 * Ordem de prioridade (NUNCA cloud primeiro):
 *
 *   1. SQLite local (servido pelo backend, header `x-gp-source: local-table*`)
 *   2. Servidor local foi à nuvem agora (header `x-gp-source: upstream`)
 *   3. cloudAdapter como fallback opcional — só quando o servidor local
 *      falha (down, sem upstream configurado, timeout, status != 200)
 *
 * Importante:
 *   - Nenhuma escrita é alterada nesta etapa (continua via cloudAdapter).
 *   - cloudAdapter NÃO é removido; é apenas o último recurso.
 *   - Se a chamada local falhar e a UI estiver offline, o fallback cloud
 *    também irá falhar — o `withTimeoutFallback` da camada superior
 *    continua protegendo a UI de travar.
 *   - Logs DEV: `[LOCAL_DB]`, `[LOCAL_SERVER]`, `[CLOUD_FALLBACK]`.
 */

import type { DataAdapter } from "../adapter";
import { cloudAdapter } from "./cloud";
import { reportDataSource } from "../source-telemetry";
import { getLocalServerStatus } from "@/integrations/desktop/tauriBridge";

const HTTP_TIMEOUT_MS = 4000;

// Cache da porta local — `getLocalServerStatus()` é uma chamada Tauri leve
// mas não precisamos invocá-la em toda leitura. Re-resolvemos quando o cache
// fica velho (5s) ou quando uma tentativa falha.
let cachedBaseUrl: { url: string; at: number } | null = null;
const BASE_URL_TTL_MS = 5_000;

async function resolveBaseUrl(): Promise<string | null> {
  const now = Date.now();
  if (cachedBaseUrl && now - cachedBaseUrl.at < BASE_URL_TTL_MS) {
    return cachedBaseUrl.url;
  }
  try {
    const st = await getLocalServerStatus();
    if (!st.running || !st.port) {
      cachedBaseUrl = null;
      return null;
    }
    const url = `http://127.0.0.1:${st.port}`;
    cachedBaseUrl = { url, at: now };
    return url;
  } catch {
    cachedBaseUrl = null;
    return null;
  }
}

function logSource(domain: string, method: string, source: string) {
  if (!import.meta.env.DEV) return;
  // Mapeia o `x-gp-source` do servidor para os 3 prefixos pedidos no plano:
  //   - local-db / local-table* → [LOCAL_DB]
  //   - upstream                → [LOCAL_SERVER] (servidor local foi à nuvem
  //                                buscar agora — ainda é "via servidor local")
  //   - cloud (fallback)        → [CLOUD_FALLBACK]
  const tag =
    source === "cloud-fallback"
      ? "[CLOUD_FALLBACK]"
      : source === "upstream"
        ? "[LOCAL_SERVER]"
        : "[LOCAL_DB]";
  // eslint-disable-next-line no-console
  console.debug(`${tag} ${domain}.${method} (origem=${source})`);
}

/**
 * Tenta consumir um endpoint do servidor local (mesma máquina). Retorna
 * `null` quando o servidor não está rodando ou a chamada falha — o caller
 * decide se aplica fallback cloud.
 */
async function tryLocal<T>(
  domain: string,
  method: string,
  path: string,
  query?: Record<string, string | undefined>,
): Promise<T | null> {
  const baseUrl = await resolveBaseUrl();
  if (!baseUrl) return null;

  const url = new URL(`${baseUrl}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v != null && v !== "") url.searchParams.set(k, v);
    }
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
      cache: "no-store",
    });
    clearTimeout(timer);
    if (!res.ok) {
      // Servidor respondeu mas com erro → invalida cache de baseUrl.
      cachedBaseUrl = null;
      return null;
    }
    const json = (await res.json()) as unknown;
    // Servidor pode envelopar em `{ data }` ou devolver o array direto.
    const payload = (json && typeof json === "object" && "data" in (json as Record<string, unknown>)
      ? (json as Record<string, unknown>).data
      : json) as T;
    const sourceHdr = res.headers.get("x-gp-source") ?? "local-db";
    logSource(domain, method, sourceHdr);
    reportDataSource({
      source: "local-server",
      domain,
      method,
      fallback: false,
    });
    return payload;
  } catch {
    clearTimeout(timer);
    // Timeout / network error → próxima leitura re-resolve a porta.
    cachedBaseUrl = null;
    return null;
  }
}

async function withCloudFallback<T>(
  domain: string,
  method: string,
  localFetcher: () => Promise<T | null>,
  cloudFetcher: () => Promise<T>,
): Promise<T> {
  const local = await localFetcher();
  if (local !== null && local !== undefined) return local;
  // Servidor local indisponível ou falhou → último recurso é a nuvem.
  // NÃO trava a UI: se a nuvem também estiver fora, propaga o erro pra
  // camada superior (que já tem withTimeoutFallback).
  const result = await cloudFetcher();
  logSource(domain, method, "cloud-fallback");
  reportDataSource({ source: "cloud", domain, method, fallback: true });
  return result;
}

// ----------------------------------------------------------------------------
// Adapter
// ----------------------------------------------------------------------------

export const localServerAdapter: DataAdapter = {
  ...cloudAdapter,

  produtos: {
    ...cloudAdapter.produtos,
    list: (input) =>
      withCloudFallback(
        "produtos",
        "list",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["produtos"]["list"]>>>(
            "produtos",
            "list",
            "/api/produtos/list",
            {
              status: input?.status ?? undefined,
              categoria_id: input?.categoria_id ?? undefined,
              busca: input?.busca ?? undefined,
            },
          ),
        () => cloudAdapter.produtos.list(input),
      ),
  },

  clientes: {
    ...cloudAdapter.clientes,
    listLite: (input) =>
      withCloudFallback(
        "clientes",
        "listLite",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["clientes"]["listLite"]>>>(
            "clientes",
            "listLite",
            "/api/clientes/lite",
            {
              status:
                input && "status" in input
                  ? (input.status ?? undefined)
                  : "ativo",
            },
          ),
        () => cloudAdapter.clientes.listLite(input),
      ),
  },

  fornecedores: {
    ...cloudAdapter.fornecedores,
    list: (input) =>
      withCloudFallback(
        "fornecedores",
        "list",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["fornecedores"]["list"]>>>(
            "fornecedores",
            "list",
            "/api/fornecedores",
            {
              status: input?.status ?? undefined,
              busca: input?.busca ?? undefined,
            },
          ),
        () => cloudAdapter.fornecedores.list(input),
      ),
  },

  funcionarios: {
    ...cloudAdapter.funcionarios,
    list: (input) =>
      withCloudFallback(
        "funcionarios",
        "list",
        async () => {
          const rows = await tryLocal<
            Awaited<ReturnType<DataAdapter["funcionarios"]["list"]>>
          >(
            "funcionarios",
            "list",
            "/api/relatorios/funcionarios-ativos",
          );
          if (!rows) return null;
          // O endpoint local devolve apenas ativos. Se o caller pediu
          // todos (somente_ativos != true), fallback pra cloud para
          // garantir paridade de dados.
          if (input?.somente_ativos === false) return null;
          return rows;
        },
        () => cloudAdapter.funcionarios.list(input),
      ),
    /**
     * Sub-etapa 4.1: o servidor LOCAL é a fonte primária de validação de
     * PIN. Mesmo online, validamos pelo SQLite local — assim a regra é
     * idêntica ao modo offline e os terminais LAN compartilham o mesmo
     * verificador. Cloud só entra como fallback quando o servidor local
     * ainda não tem verificador para esse operador (`notReady`).
     */
    validarPin: async (input) => {
      const baseUrl = await resolveBaseUrl();
      if (baseUrl) {
        const r = await validarPinServidor(
          // O servidor local responde em 127.0.0.1 — `validarPinServidor`
          // resolve a URL pelo cfg do terminal, mas no modo "servidor"
          // não temos um cfg de terminal LAN. Usamos um cfg sintético
          // com o baseUrl que já resolvemos.
          { url: baseUrl, kind: "url" } as never,
          input.funcionario_id,
          input.pin,
        );
        if (r.kind === "ok") {
          if (r.data.autorizado && r.data.funcionario) {
            // eslint-disable-next-line no-console
            console.debug("[OFFLINE_AUTH] PIN validado no servidor local");
            return {
              id: r.data.funcionario.id,
              nome: r.data.funcionario.nome,
              login: r.data.funcionario.login,
              role: r.data.funcionario.role,
            };
          }
          // eslint-disable-next-line no-console
          console.warn("[OFFLINE_AUTH] PIN recusado no servidor local");
          throw new Error(r.data.motivo ?? "PIN inválido.");
        }
        // eslint-disable-next-line no-console
        console.debug(
          `[OFFLINE_AUTH] fallback cloud online — servidor local ${r.kind}`,
        );
      }
      return cloudAdapter.funcionarios.validarPin(input);
    },
  },

  estoque: {
    ...cloudAdapter.estoque,
    saldosLinhas: () =>
      withCloudFallback(
        "estoque",
        "saldosLinhas",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["estoque"]["saldosLinhas"]>>>(
            "estoque",
            "saldosLinhas",
            "/api/estoque/saldos",
          ),
        () => cloudAdapter.estoque.saldosLinhas(),
      ),
    movimentacoes: (input) =>
      withCloudFallback(
        "estoque",
        "movimentacoes",
        () =>
          tryLocal<Awaited<ReturnType<DataAdapter["estoque"]["movimentacoes"]>>>(
            "estoque",
            "movimentacoes",
            "/api/estoque/movimentacoes",
            {
              produto_id: input?.produto_id ?? undefined,
              limit: input?.limit != null ? String(input.limit) : undefined,
            },
          ),
        () => cloudAdapter.estoque.movimentacoes(input),
      ),
  },
};

// Mantido para compat com imports antigos / testes.
export const LOCAL_READ_DOMAINS = [
  "produtos",
  "clientes",
  "fornecedores",
  "funcionarios",
  "estoque",
] as const;
