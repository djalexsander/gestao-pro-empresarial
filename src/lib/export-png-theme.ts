/**
 * Tema de exportação PNG — modo DARK sólido.
 *
 * Por que: a UI usa dark com oklch, gradientes, backdrop-filter, blur,
 * transparências e sombras que html-to-image/html2canvas não renderizam bem
 * (resultando em PNGs pretos, vazios ou ilegíveis). Aqui geramos uma versão
 * "print dark" do nó: fundo escuro sólido, texto branco, bordas sólidas,
 * SEM efeitos visuais. O DOM original (visível ao usuário) NUNCA é alterado.
 *
 * Mantemos o visual escuro (preferência do usuário) — apenas removemos os
 * efeitos incompatíveis e substituímos cores translúcidas/oklch por sólidos.
 */

const PRINT_BG = "#0f172a";          // slate-900 — fundo do wrapper
const PRINT_SURFACE = "#111827";     // gray-900 — cards / superfícies
const PRINT_SURFACE_ALT = "#1f2937"; // gray-800 — cabeçalhos de tabela / badges
const PRINT_FG = "#ffffff";
const PRINT_MUTED = "#cbd5e1";       // slate-300 — texto secundário
const PRINT_BORDER = "#334155";      // slate-700 — bordas sólidas
const PRINT_SUCCESS = "#4ade80";     // green-400
const PRINT_DANGER = "#f87171";      // red-400
const PRINT_INFO = "#60a5fa";        // blue-400
const PRINT_WARNING = "#facc15";     // yellow-400

/**
 * Mapeia classes utilitárias semânticas para cores legíveis em fundo escuro.
 */
function mapSemanticColor(el: HTMLElement): string | null {
  const cls = el.className?.toString() ?? "";
  if (/\btext-success\b/.test(cls)) return PRINT_SUCCESS;
  if (/\btext-destructive\b/.test(cls)) return PRINT_DANGER;
  if (/\btext-info\b/.test(cls)) return PRINT_INFO;
  if (/\btext-warning(-foreground)?\b/.test(cls)) return PRINT_WARNING;
  if (/\btext-muted-foreground\b/.test(cls)) return PRINT_MUTED;
  return null;
}

/** Remove propriedades que tipicamente quebram a captura. */
function stripVisualEffects(el: HTMLElement) {
  el.style.setProperty("backdrop-filter", "none", "important");
  el.style.setProperty("-webkit-backdrop-filter", "none", "important");
  el.style.setProperty("filter", "none", "important");
  el.style.setProperty("box-shadow", "none", "important");
  el.style.setProperty("text-shadow", "none", "important");
  el.style.setProperty("opacity", "1", "important");
  el.style.setProperty("mix-blend-mode", "normal", "important");
  // Gradientes em background-image normalmente quebram a leitura → remove.
  const cs = getComputedStyle(el);
  if (cs.backgroundImage && cs.backgroundImage !== "none") {
    el.style.setProperty("background-image", "none", "important");
  }
}

/**
 * Aplica o tema dark de impressão em todo o sub-DOM do clone.
 * Chamado APÓS appendChild para que getComputedStyle funcione.
 */
export function applyPrintTheme(root: HTMLElement) {
  root.style.background = PRINT_BG;
  root.style.color = PRINT_FG;

  const all = root.querySelectorAll<HTMLElement>("*");
  all.forEach((el) => {
    const tag = el.tagName;
    // Não tocar em elementos de mídia
    if (tag === "IMG" || tag === "SVG" || tag === "CANVAS") return;

    stripVisualEffects(el);

    const semantic = mapSemanticColor(el);
    el.style.setProperty("color", semantic ?? PRINT_FG, "important");

    // Garante que nada esteja escondido por overflow durante a captura
    const cs = getComputedStyle(el);
    if (cs.overflow === "hidden" || cs.overflowX === "hidden" || cs.overflowY === "hidden") {
      el.style.setProperty("overflow", "visible", "important");
    }

    // Fundos: sólidos por tipo de elemento
    const cls = el.className?.toString() ?? "";
    if (tag === "THEAD" || tag === "TH") {
      el.style.setProperty("background", PRINT_SURFACE_ALT, "important");
    } else if (/\b(badge|chip|pill)\b/i.test(cls)) {
      el.style.setProperty("background", PRINT_SURFACE_ALT, "important");
      el.style.setProperty("border", `1px solid ${PRINT_BORDER}`, "important");
    } else if (/\bcard\b/i.test(cls)) {
      el.style.setProperty("background", PRINT_SURFACE, "important");
      el.style.setProperty("border", `1px solid ${PRINT_BORDER}`, "important");
    } else {
      // Demais elementos: transparente para herdar o fundo do wrapper.
      el.style.setProperty("background", "transparent", "important");
    }

    // Bordas sempre sólidas e cinza-azulado
    if (cs.borderTopWidth !== "0px") el.style.setProperty("border-top-color", PRINT_BORDER, "important");
    if (cs.borderBottomWidth !== "0px") el.style.setProperty("border-bottom-color", PRINT_BORDER, "important");
    if (cs.borderLeftWidth !== "0px") el.style.setProperty("border-left-color", PRINT_BORDER, "important");
    if (cs.borderRightWidth !== "0px") el.style.setProperty("border-right-color", PRINT_BORDER, "important");
  });
}

export const PRINT_THEME = {
  bg: PRINT_BG,
  surface: PRINT_SURFACE,
  surfaceAlt: PRINT_SURFACE_ALT,
  fg: PRINT_FG,
  muted: PRINT_MUTED,
  border: PRINT_BORDER,
};

/** Aguarda fontes carregarem + dois frames para garantir paint completo. */
export async function waitForRenderReady() {
  try {
    if (document.fonts && "ready" in document.fonts) {
      await document.fonts.ready;
    }
  } catch {
    // ignora
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => setTimeout(resolve, 100));
}
