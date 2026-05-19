import { useEffect } from "react";

/**
 * Camada reutilizável de atalhos de teclado para modais (Dialog/Sheet).
 *
 * Comportamento (todos opt-out, seguros por padrão):
 *  - **Enter** em `<input>` simples avança para o próximo campo focável
 *    do modal. Se for o último, NÃO bloqueia o Enter — deixa o navegador
 *    submeter o form / acionar o botão default normalmente.
 *  - **Ctrl/Cmd+S** procura `[data-ctrl-save]` ou `button[type=submit]`
 *    dentro do modal e clica nele (se não estiver desabilitado).
 *  - **ESC** é tratado nativamente pelo Radix Dialog — não duplicamos.
 *
 * Opt-outs:
 *  - `data-no-keyboard-nav` em qualquer ancestral do input desativa tudo.
 *  - `data-no-enter-advance` em um input específico desativa só o Enter.
 *  - `textarea`, `[role=combobox]`, `[role=listbox]`, `[contenteditable]`,
 *    `select`, `button`, `[type=submit]`, `[type=button]` nunca são
 *    interceptados pelo Enter-advance.
 *  - `IME composing` (acentos/teclado asiático) nunca é interceptado.
 */
export function useModalKeyboardNavigation(
  containerRef: React.RefObject<HTMLElement | null>,
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled !== false;

  useEffect(() => {
    if (!enabled) return;
    const container = containerRef.current;
    if (!container) return;

    function isFormInput(el: Element | null): el is HTMLInputElement {
      if (!el || el.tagName !== "INPUT") return false;
      const input = el as HTMLInputElement;
      const t = (input.type || "text").toLowerCase();
      // tipos onde Enter "submit" é o comportamento natural — interceptar é seguro
      const allowed = [
        "text",
        "email",
        "number",
        "tel",
        "password",
        "search",
        "url",
        "date",
        "datetime-local",
        "month",
        "time",
        "week",
      ];
      return allowed.includes(t);
    }

    function isOptOut(el: Element | null): boolean {
      if (!el) return false;
      return !!(el as HTMLElement).closest?.("[data-no-keyboard-nav]");
    }

    function getFocusables(): HTMLElement[] {
      if (!container) return [];
      const sel = [
        "input:not([disabled]):not([type=hidden])",
        "select:not([disabled])",
        "textarea:not([disabled])",
        "button:not([disabled])",
        "[tabindex]:not([tabindex='-1'])",
      ].join(",");
      return Array.from(container.querySelectorAll<HTMLElement>(sel)).filter(
        (el) => !el.hasAttribute("data-no-keyboard-nav") && el.offsetParent !== null,
      );
    }

    function handleKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (isOptOut(target)) return;

      // Ctrl+S / Cmd+S → click save button
      if ((e.ctrlKey || e.metaKey) && (e.key === "s" || e.key === "S")) {
        const saveBtn = container?.querySelector<HTMLButtonElement>(
          "[data-ctrl-save]:not([disabled]), button[type='submit']:not([disabled])",
        );
        if (saveBtn) {
          e.preventDefault();
          saveBtn.click();
        }
        return;
      }

      // Enter advance
      if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // IME composing
        const ne = e as KeyboardEvent & { isComposing?: boolean };
        if (ne.isComposing || e.keyCode === 229) return;
        if (target.hasAttribute("data-no-enter-advance")) return;
        if (!isFormInput(target)) return; // textarea/select/button/combobox: ignora

        const focusables = getFocusables();
        const idx = focusables.indexOf(target);
        // próximo focável que seja input editável (pula botões intermediários)
        const next = focusables
          .slice(idx + 1)
          .find((el) => el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA");
        if (next) {
          e.preventDefault();
          next.focus();
          if (next.tagName === "INPUT") (next as HTMLInputElement).select?.();
        }
        // Se não houver próximo, NÃO faz preventDefault — deixa Enter submeter naturalmente.
      }
    }

    container.addEventListener("keydown", handleKeyDown);
    return () => container.removeEventListener("keydown", handleKeyDown);
  }, [containerRef, enabled]);
}
