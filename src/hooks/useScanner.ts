import { useEffect, useRef } from "react";

/**
 * Hook para escutar entrada de scanner físico USB (que se comporta como teclado).
 *
 * Características de scanner USB:
 * - Digita rapidamente uma sequência de caracteres
 * - Termina com Enter
 * - Tipicamente >= 4 chars com intervalo médio < 50ms entre teclas
 *
 * Este hook detecta esse padrão escutando keydown no document, ignorando
 * eventos vindos de inputs/textareas onde o usuário está digitando manualmente.
 *
 * @param onScan callback chamado com o código lido
 * @param options.minLength tamanho mínimo do código (default 3)
 * @param options.maxIntervalMs intervalo máximo médio entre teclas (default 50ms)
 * @param options.enabled habilita/desabilita o listener
 */
export interface UseScannerOptions {
  minLength?: number;
  maxIntervalMs?: number;
  enabled?: boolean;
  /** Quando true, captura mesmo quando o foco está num input (útil em telas de venda/estoque) */
  captureOnInputs?: boolean;
}

export function useScanner(
  onScan: (code: string) => void,
  options: UseScannerOptions = {},
) {
  const {
    minLength = 3,
    maxIntervalMs = 50,
    enabled = true,
    captureOnInputs = false,
  } = options;

  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    let buffer = "";
    let lastTime = 0;
    let intervals: number[] = [];

    function reset() {
      buffer = "";
      intervals = [];
      lastTime = 0;
    }

    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;

      if (!captureOnInputs && target) {
        const tag = target.tagName;
        const editable = (target as HTMLElement).isContentEditable;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || editable) {
          return;
        }
      }

      const now = performance.now();

      if (e.key === "Enter") {
        if (buffer.length >= minLength && intervals.length > 0) {
          const avg = intervals.reduce((a, b) => a + b, 0) / intervals.length;
          if (avg <= maxIntervalMs) {
            const code = buffer;
            reset();
            // Previne que o Enter dispare ações no UI atual
            e.preventDefault();
            onScanRef.current(code);
            return;
          }
        }
        reset();
        return;
      }

      // Apenas caracteres imprimíveis (1 char) — ignora Shift, Ctrl, etc.
      if (e.key.length !== 1) return;

      if (lastTime > 0) {
        intervals.push(now - lastTime);
      }
      lastTime = now;
      buffer += e.key;

      // Reseta após inatividade
      window.clearTimeout((handler as unknown as { _t?: number })._t);
      (handler as unknown as { _t?: number })._t = window.setTimeout(reset, 200);
    }

    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
      reset();
    };
  }, [enabled, minLength, maxIntervalMs, captureOnInputs]);
}
