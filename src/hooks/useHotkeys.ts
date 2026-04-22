import { useEffect, useRef } from "react";

export interface HotkeyHandler {
  /** Tecla, ex: "F1", "F10", "Enter", "Escape", "Backspace" */
  key: string;
  handler: (e: KeyboardEvent) => void;
  /** Permite o atalho mesmo com foco em INPUT/TEXTAREA/SELECT/contentEditable */
  allowInInputs?: boolean;
  /** Por padrão sempre dá preventDefault. Defina false para deixar passar. */
  preventDefault?: boolean;
}

export interface UseHotkeysOptions {
  enabled?: boolean;
}

/**
 * Hook global para mapear atalhos de teclado, com proteção contra disparo
 * acidental enquanto o usuário digita em campos de texto.
 *
 * Por padrão, atalhos NÃO disparam quando o foco está em INPUT/TEXTAREA/SELECT
 * ou elemento contentEditable (configurável via `allowInInputs`).
 *
 * Teclas como F1-F12, Escape e Backspace são tratadas como atalhos do app
 * com `preventDefault` automático.
 */
export function useHotkeys(
  hotkeys: HotkeyHandler[],
  { enabled = true }: UseHotkeysOptions = {},
) {
  const ref = useRef(hotkeys);
  ref.current = hotkeys;

  useEffect(() => {
    if (!enabled) return;

    function isInInput(target: EventTarget | null): boolean {
      const el = target as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (el.isContentEditable) return true;
      return false;
    }

    function handle(e: KeyboardEvent) {
      // Não interferir em combinações de modificadores do SO/navegador
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const inInput = isInInput(e.target);

      for (const hk of ref.current) {
        if (hk.key.toLowerCase() !== e.key.toLowerCase()) continue;
        if (inInput && !hk.allowInInputs) continue;
        if (hk.preventDefault !== false) e.preventDefault();
        hk.handler(e);
        return;
      }
    }

    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [enabled]);
}
