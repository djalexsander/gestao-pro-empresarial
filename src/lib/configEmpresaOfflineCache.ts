/**
 * Cache offline-first para as Configurações da Empresa.
 *
 * Como `configuracoes_empresa` é efetivamente um único registro por
 * owner_id (com 16 campos planos), não justifica criar tabela própria
 * + outbox no SQLite. Resolvemos com:
 *
 *  - Cache em localStorage por user_id (lido sincronamente, sem rede).
 *  - Fila de pendências (também em localStorage) com o último payload
 *    a ser persistido quando a conexão voltar.
 *
 * Estratégia de consistência: "last-write-wins" do próprio usuário.
 * Como só o admin/dono da empresa edita estes dados (e tipicamente em
 * um único terminal), conflitos cross-device são raríssimos.
 */
import type { ConfigEmpresaDomain, ConfigEmpresaInputDomain } from "@/integrations/data/extra-adapters";

const CACHE_KEY = "config_empresa_cache_v1";
const PENDING_KEY = "config_empresa_pending_v1";

type CacheMap = Record<string, ConfigEmpresaDomain>;
type PendingMap = Record<
  string,
  { input: Partial<ConfigEmpresaInputDomain> & { id?: string }; enqueuedAt: number }
>;

function canStorage() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readJson<T>(key: string, fallback: T): T {
  if (!canStorage()) return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  if (!canStorage()) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / parse — ignora */
  }
}

export function getCachedConfigEmpresa(userId: string | null | undefined): ConfigEmpresaDomain | null {
  if (!userId) return null;
  const all = readJson<CacheMap>(CACHE_KEY, {});
  return all[userId] ?? null;
}

export function setCachedConfigEmpresa(userId: string, cfg: ConfigEmpresaDomain | null) {
  if (!userId) return;
  const all = readJson<CacheMap>(CACHE_KEY, {});
  if (cfg === null) {
    delete all[userId];
  } else {
    all[userId] = cfg;
  }
  writeJson(CACHE_KEY, all);
}

/** Mescla `patch` na entrada cacheada e retorna a versão atualizada (sem persistir no servidor). */
export function mergeCachedConfigEmpresa(
  userId: string,
  patch: Partial<ConfigEmpresaInputDomain> & { id?: string },
): ConfigEmpresaDomain {
  const current = getCachedConfigEmpresa(userId);
  const merged: ConfigEmpresaDomain = {
    id: patch.id ?? current?.id ?? `local-${userId}`,
    razao_social: patch.razao_social ?? current?.razao_social ?? "Minha Empresa",
    nome_fantasia: patch.nome_fantasia ?? current?.nome_fantasia ?? null,
    cnpj: patch.cnpj ?? current?.cnpj ?? null,
    inscricao_estadual: patch.inscricao_estadual ?? current?.inscricao_estadual ?? null,
    inscricao_municipal: patch.inscricao_municipal ?? current?.inscricao_municipal ?? null,
    telefone: patch.telefone ?? current?.telefone ?? null,
    email: patch.email ?? current?.email ?? null,
    logradouro: patch.logradouro ?? current?.logradouro ?? null,
    numero: patch.numero ?? current?.numero ?? null,
    complemento: patch.complemento ?? current?.complemento ?? null,
    bairro: patch.bairro ?? current?.bairro ?? null,
    cidade: patch.cidade ?? current?.cidade ?? null,
    estado: patch.estado ?? current?.estado ?? null,
    cep: patch.cep ?? current?.cep ?? null,
    logo_url: patch.logo_url ?? current?.logo_url ?? null,
  };
  setCachedConfigEmpresa(userId, merged);
  return merged;
}

/** Marca um save como pendente (sobrescreve fila — último estado vence). */
export function enqueueConfigEmpresaPending(
  userId: string,
  input: Partial<ConfigEmpresaInputDomain> & { id?: string },
) {
  if (!userId) return;
  const all = readJson<PendingMap>(PENDING_KEY, {});
  all[userId] = { input, enqueuedAt: Date.now() };
  writeJson(PENDING_KEY, all);
}

export function getConfigEmpresaPending(
  userId: string,
): { input: Partial<ConfigEmpresaInputDomain> & { id?: string }; enqueuedAt: number } | null {
  if (!userId) return null;
  const all = readJson<PendingMap>(PENDING_KEY, {});
  return all[userId] ?? null;
}

export function clearConfigEmpresaPending(userId: string) {
  if (!userId) return;
  const all = readJson<PendingMap>(PENDING_KEY, {});
  delete all[userId];
  writeJson(PENDING_KEY, all);
}

export function hasConfigEmpresaPending(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return !!getConfigEmpresaPending(userId);
}

/** Heurística simples: trata erros de rede como "ficar offline". */
export function isNetworkLikeError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : (err as { message?: string })?.message ?? "";
  const m = msg.toLowerCase();
  return (
    m.includes("failed to fetch") ||
    m.includes("networkerror") ||
    m.includes("network error") ||
    m.includes("timeout") ||
    m.includes("load failed") ||
    m.includes("err_internet") ||
    m.includes("err_network")
  );
}
