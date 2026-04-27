/**
 * Aplica um tema "claro forçado" em um clone de elemento para exportação PNG.
 *
 * Por que: a UI usa tema dark com oklch, gradientes, backdrop-filter, blur,
 * transparências e sombras que html-to-image/html2canvas não renderizam bem
 * (resultando em PNGs escuros, ilegíveis ou em branco). Aqui geramos uma
 * versão "print-friendly" do nó: fundo branco, texto preto, bordas sólidas,
 * sem efeitos visuais. O DOM original (visível ao usuário) NUNCA é alterado.
 */

const PRINT_BG = "#ffffff";
const PRINT_FG = "#0a0a0a";
const PRINT_MUTED = "#52525b";
const PRINT_BORDER = "#d4d4d8";
const PRINT_SUCCESS = "#15803d";
const PRINT_DANGER = "#b91c1c";
const PRINT_INFO = "#1d4ed8";
const PRINT_WARNING = "#a16207";

/**
 * Mapeia classes utilitárias semânticas (text-success, text-destructive…)
 * para cores sólidas legíveis em fundo branco. Mantemos o destaque sem
 * depender das variáveis CSS do tema.
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

/** Limpa propriedades que tipicamente quebram a captura. */
function stripVisualEffects(el: HTMLElement) {
  el.style.backdropFilter = "none";
  // Vendor prefix antigo (WebKit) — usar setProperty para evitar typings.
  el.style.setProperty("-webkit-backdrop-filter", "none");
  el.style.filter = "none";
  el.style.boxShadow = "none";
  el.style.textShadow = "none";
  el.style.opacity = "1";
  el.style.mixBlendMode = "normal";
  // Gradientes em background-image normalmente quebram a leitura → remove.
  const cs = getComputedStyle(el);
  if (cs.backgroundImage && cs.backgroundImage !== "none") {
    el.style.backgroundImage = "none";
  }
}

/**
 * Aplica o tema de impressão em todo o sub-DOM do clone.
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
    el.style.color = semantic ?? PRINT_FG;

    // Fundo: força transparente em quase tudo, exceto cabeçalhos de tabela
    // e badges/pills (que ganham um cinza muito leve para diferenciação).
    const cls = el.className?.toString() ?? "";
    if (tag === "THEAD" || tag === "TH") {
      el.style.background = "#f4f4f5";
    } else if (/\b(badge|chip|pill)\b/i.test(cls)) {
      el.style.background = "#f4f4f5";
      el.style.border = `1px solid ${PRINT_BORDER}`;
    } else {
      el.style.background = "transparent";
    }

    // Bordas sempre sólidas e cinza claro
    const cs = getComputedStyle(el);
    if (cs.borderTopWidth !== "0px") el.style.borderTopColor = PRINT_BORDER;
    if (cs.borderBottomWidth !== "0px") el.style.borderBottomColor = PRINT_BORDER;
    if (cs.borderLeftWidth !== "0px") el.style.borderLeftColor = PRINT_BORDER;
    if (cs.borderRightWidth !== "0px") el.style.borderRightColor = PRINT_BORDER;
  });
}

export const PRINT_THEME = {
  bg: PRINT_BG,
  fg: PRINT_FG,
  border: PRINT_BORDER,
};

/** Aguarda fontes carregarem + próximo paint. Evita PNG sem texto. */
export async function waitForRenderReady() {
  try {
    if (document.fonts && "ready" in document.fonts) {
      await document.fonts.ready;
    }
  } catch {
    // ignora
  }
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
