import { useEffect, useRef } from "react";

export interface HotkeyHandler {
  /** Tecla, ex: "F1", "F10", "Enter", "Escape", "Backspace", "p" */
  key: string;
  handler: (e: KeyboardEvent) => void;
  /** Permite o atalho mesmo com foco em INPUT/TEXTAREA/SELECT/contentEditable */
  allowInInputs?: boolean;
  /** Por padrão sempre dá preventDefault. Defina false para deixar passar. */
  preventDefault?: boolean;
  /** Exigir Ctrl (ou Meta no macOS). Default: false (ignora se Ctrl pressionado) */
  ctrl?: boolean;
  /** Exigir Shift. Default: false */
  shift?: boolean;
  /** Exigir Alt. Default: false */
  alt?: boolean;
}

export interface UseHotkeysOptions {
  enabled?: boolean;
}

/**
 * Hook global para mapear atalhos de teclado, com proteção contra disparo
 * acidental enquanto o usuário digita em campos de texto.
 *
 * Atalhos são CONTEXTUAIS: só ficam ativos enquanto o componente que chamou
 * o hook estiver montado. Ao desmontar, o listener é removido automaticamente.
 *
 * Por padrão, atalhos NÃO disparam quando o foco está em INPUT/TEXTAREA/SELECT
 * ou elemento contentEditable (configurável via `allowInInputs`).
 *
 * Suporta modificadores opcionais (ctrl/shift/alt). Quando `ctrl` é true,
 * aceita também a tecla Meta (Cmd no macOS).
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
      if (!e.key) return;
      const eventKey = e.key.toLowerCase();
      const inInput = isInInput(e.target);

      for (const hk of ref.current) {
        if (!hk?.key) continue;
        if (hk.key.toLowerCase() !== eventKey) continue;

        // Match exato de modificadores
        const wantCtrl = !!hk.ctrl;
        const wantShift = !!hk.shift;
        const wantAlt = !!hk.alt;
        const hasCtrl = e.ctrlKey || e.metaKey;
        if (wantCtrl !== hasCtrl) continue;
        if (wantShift !== e.shiftKey) continue;
        if (wantAlt !== e.altKey) continue;

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
