import { useEffect, useId, useRef } from "react";

export interface HotkeyHandler {
  /** Tecla, ex: "F1", "F10", "Enter", "Escape", "Backspace", "p" */
  key: string;
  handler: (e: KeyboardEvent) => void;
  /** Permite o atalho mesmo com foco em INPUT/TEXTAREA/SELECT/contentEditable */
  allowInInputs?: boolean;
  /** Por padrão sempre dá preventDefault. Defina false para deixar passar. */
  preventDefault?: boolean;
  /** Exigir Ctrl (ou Meta no macOS). Default: false */
  ctrl?: boolean;
  /** Exigir Shift. Default: false */
  shift?: boolean;
  /** Exigir Alt. Default: false */
  alt?: boolean;
}

export interface UseHotkeysOptions {
  enabled?: boolean;
  /**
   * Escopo do atalho. Telas modais devem usar "modal" (ou outro nome próprio)
   * para que seus atalhos tenham prioridade sobre o escopo "page" subjacente.
   *
   * Regras:
   * - "global"   → sempre processado, baixa prioridade (ex.: atalhos universais).
   * - "page"     → tela principal (PDV, Clientes, etc.). Suspenso quando há modal ativo.
   * - "modal"    → diálogo/tela sobreposta. Tem prioridade absoluta enquanto montado.
   *                Bloqueia escopos "page" e "global" para evitar conflitos.
   *
   * Mais de um modal empilhado: o último a montar vence (stack LIFO).
   */
  scope?: "global" | "page" | "modal";
}

// =====================================================================
// Stack de escopos ativos. Cada tela contextual registra/desregistra seu
// id ao montar/desmontar. Apenas o escopo no topo do stack "modal" é
// considerado ativo; se não houver modal, escopos "page" são processados.
//
// Esta arquitetura é independente do ambiente (browser ou WebView do
// Tauri): toda a lógica vive em JS e usa apenas o evento `keydown`
// padrão do DOM, que se comporta de forma idêntica em ambos.
// =====================================================================

type ActiveEntry = { id: string; scope: "global" | "page" | "modal" };

const activeStack: ActiveEntry[] = [];

function pushScope(entry: ActiveEntry) {
  activeStack.push(entry);
}

function removeScope(id: string) {
  const idx = activeStack.findIndex((e) => e.id === id);
  if (idx >= 0) activeStack.splice(idx, 1);
}

/**
 * Retorna true se este id pode processar eventos agora, dado o stack atual.
 * - Modais: só o último modal montado processa.
 * - Páginas: só processam quando NÃO há modal ativo.
 * - Globais: sempre processam (mas com prioridade mais baixa que modais).
 */
function canHandle(id: string, scope: "global" | "page" | "modal") {
  const topModal = [...activeStack].reverse().find((e) => e.scope === "modal");
  if (scope === "modal") return topModal?.id === id;
  if (scope === "page") return !topModal;
  return true; // global
}

/**
 * Hook contextual de atalhos de teclado.
 *
 * Cada tela registra seus próprios atalhos via este hook. Ao desmontar,
 * o cleanup remove o escopo do stack — não há listeners órfãos nem
 * configuração global compartilhada.
 *
 * Quando uma tela "modal" abre (ex.: dialog de Venda Concluída), os
 * atalhos da página subjacente (PDV) ficam suspensos automaticamente,
 * mesmo que ambos os hooks estejam montados. Isso permite reaproveitar
 * teclas (Enter, Esc, V) com semântica diferente por tela, exatamente
 * como em softwares desktop profissionais.
 *
 * Compatível com empacotamento desktop via Tauri: usa apenas o evento
 * `keydown` da WebView, sem APIs específicas de browser. F-keys e
 * combinações com Ctrl recebem `preventDefault` para evitar
 * comportamentos default (ex.: F5 = refresh, Ctrl+P = print do browser),
 * o que também é o comportamento esperado no app desktop.
 */
export function useHotkeys(
  hotkeys: HotkeyHandler[],
  { enabled = true, scope = "page" }: UseHotkeysOptions = {},
) {
  const ref = useRef(hotkeys);
  ref.current = hotkeys;
  const id = useId();

  useEffect(() => {
    if (!enabled) return;

    pushScope({ id, scope });

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
      if (!canHandle(id, scope)) return;

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
    return () => {
      document.removeEventListener("keydown", handle);
      removeScope(id);
    };
  }, [enabled, id, scope]);
}
