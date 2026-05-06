/**
 * Envolve uma promise com timeout. Se exceder, rejeita com TimeoutError ou
 * resolve com o fallback fornecido. Útil pra evitar tela travada esperando
 * Supabase indefinidamente quando a internet está instável.
 */
export class TimeoutError extends Error {
  constructor(message = "timeout") {
    super(message);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "operation",
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const id = setTimeout(() => {
      reject(new TimeoutError(`${label} timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (v) => {
        clearTimeout(id);
        resolve(v);
      },
      (e) => {
        clearTimeout(id);
        reject(e);
      },
    );
  });
}

/**
 * Roda uma promise com timeout e cai num fallback se exceder ou falhar.
 * Loga no console pra auditoria, sem propagar erro pro UI.
 */
export async function withTimeoutFallback<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T | (() => T | Promise<T>),
  label = "operation",
): Promise<T> {
  try {
    return await withTimeout(promise, ms, label);
  } catch (err) {
    if (typeof console !== "undefined") {
      console.warn(`[withTimeoutFallback] ${label} -> usando fallback`, err);
    }
    return typeof fallback === "function"
      ? await (fallback as () => T | Promise<T>)()
      : fallback;
  }
}
