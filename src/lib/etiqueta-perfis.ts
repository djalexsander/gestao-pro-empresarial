/**
 * Transformações puras sobre a lista de perfis de bobina (criar, editar,
 * duplicar, excluir, definir padrão, selecionar ativo) + migração do
 * formato legado de etiqueta ("50x30" em `labelFormat`/`labelCustomFormats`).
 *
 * Deliberadamente sem I/O: não conhece `desktopConfigStore` nem Tauri. Quem
 * persiste é `integrations/desktop/printers.ts` (mesmo padrão já usado para
 * `labelPrinter`/`labelFormat`) — isso mantém esta lógica 100% testável com
 * objetos simples, e evita import circular com o config store.
 */

import { criarPerfil, gerarIdPerfil, type PerfilBobina } from "./etiqueta-layout";

export interface EstadoPerfis {
  labelProfiles: PerfilBobina[];
  labelProfileId: string | null;
}

export interface ConfigLegadaEtiqueta {
  labelFormat?: string | null;
  labelCustomFormats?: string[] | null;
}

function parseFormatoLegado(formato: string): { w: number; h: number } | null {
  const m = /^(\d{2,3})x(\d{2,3})$/i.exec(formato.trim());
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!(w > 0) || !(h > 0)) return null;
  return { w, h };
}

/** Cria um perfil 1-coluna a partir de um formato legado "WxH", preservando o comportamento anterior. */
function perfilDeFormatoLegado(formato: string, padrao: boolean): PerfilBobina | null {
  const dims = parseFormatoLegado(formato);
  if (!dims) return null;
  return criarPerfil({
    id: `legado-${dims.w}x${dims.h}`,
    nome: `Migrado ${dims.w}×${dims.h} mm`,
    larguraEtiquetaMm: dims.w,
    alturaEtiquetaMm: dims.h,
    colunas: 1,
    gapHorizontalMm: 0,
    gapVerticalMm: 0,
    margemEsquerdaMm: 0,
    margemDireitaMm: 0,
    margemSuperiorMm: 0,
    margemInferiorMm: 0,
    larguraMidiaMm: dims.w,
    padrao,
  });
}

/**
 * Garante que `labelProfiles`/`labelProfileId` existam, migrando a partir de
 * `labelFormat`/`labelCustomFormats` quando necessário. Idempotente: uma vez
 * que existe pelo menos um perfil, não mexe mais na lista (não ressuscita
 * perfis que o usuário excluiu, não sobrescreve edições).
 */
export function garantirPerfis(
  atual: { labelProfiles?: PerfilBobina[] | null; labelProfileId?: string | null },
  legado: ConfigLegadaEtiqueta,
): EstadoPerfis {
  const existentes = atual.labelProfiles ?? [];
  if (existentes.length > 0) {
    const ativoValido = existentes.some((p) => p.id === atual.labelProfileId);
    return {
      labelProfiles: existentes,
      labelProfileId: ativoValido
        ? atual.labelProfileId!
        : (obterPadrao({ labelProfiles: existentes, labelProfileId: null })?.id ??
          existentes[0].id),
    };
  }

  const perfis: PerfilBobina[] = [];
  const formatoPadrao = legado.labelFormat?.trim();
  const jaAdicionados = new Set<string>();

  if (formatoPadrao) {
    const perfil = perfilDeFormatoLegado(formatoPadrao, true);
    if (perfil) {
      perfis.push(perfil);
      jaAdicionados.add(perfil.id);
    }
  }

  for (const formato of legado.labelCustomFormats ?? []) {
    const perfil = perfilDeFormatoLegado(formato, false);
    if (perfil && !jaAdicionados.has(perfil.id)) {
      perfis.push(perfil);
      jaAdicionados.add(perfil.id);
    }
  }

  if (perfis.length === 0) {
    // Instalação nova, sem nenhum vestígio de config antiga: perfil padrão
    // 50x30 1-coluna — mesmo default que o app já usava.
    perfis.push(
      criarPerfil({
        id: "padrao-50x30",
        nome: "Padrão 50×30 mm",
        larguraMidiaMm: 50,
        padrao: true,
      }),
    );
  } else if (!perfis.some((p) => p.padrao)) {
    perfis[0].padrao = true;
  }

  const padrao = perfis.find((p) => p.padrao) ?? perfis[0];
  return { labelProfiles: perfis, labelProfileId: padrao.id };
}

export function listarPerfis(estado: EstadoPerfis): PerfilBobina[] {
  return estado.labelProfiles;
}

export function obterPerfil(estado: EstadoPerfis, id: string): PerfilBobina | null {
  return estado.labelProfiles.find((p) => p.id === id) ?? null;
}

export function obterPadrao(estado: EstadoPerfis): PerfilBobina | null {
  return estado.labelProfiles.find((p) => p.padrao) ?? estado.labelProfiles[0] ?? null;
}

/** Perfil ativo deste terminal: o selecionado, com fallback pro padrão e pro primeiro da lista. */
export function obterAtivo(estado: EstadoPerfis): PerfilBobina | null {
  if (estado.labelProfileId) {
    const selecionado = obterPerfil(estado, estado.labelProfileId);
    if (selecionado) return selecionado;
  }
  return obterPadrao(estado);
}

/** Cria (sem id) ou atualiza (com id existente) um perfil na lista. */
export function upsertPerfil(estado: EstadoPerfis, perfil: PerfilBobina): EstadoPerfis {
  const existe = estado.labelProfiles.some((p) => p.id === perfil.id);
  const atualizado: PerfilBobina = { ...perfil, atualizadoEm: Date.now() };
  let labelProfiles: PerfilBobina[];
  if (existe) {
    labelProfiles = estado.labelProfiles.map((p) => (p.id === perfil.id ? atualizado : p));
  } else {
    labelProfiles = [...estado.labelProfiles, atualizado];
  }
  // Garante exclusividade do padrão.
  if (atualizado.padrao) {
    labelProfiles = labelProfiles.map((p) =>
      p.id === atualizado.id ? p : { ...p, padrao: false },
    );
  }
  return {
    labelProfiles,
    labelProfileId: estado.labelProfileId ?? atualizado.id,
  };
}

export function duplicarPerfil(
  estado: EstadoPerfis,
  id: string,
): { estado: EstadoPerfis; novo: PerfilBobina | null } {
  const original = obterPerfil(estado, id);
  if (!original) return { estado, novo: null };
  const agora = Date.now();
  const novo: PerfilBobina = {
    ...original,
    id: gerarIdPerfil(),
    nome: `${original.nome} (cópia)`,
    padrao: false,
    criadoEm: agora,
    atualizadoEm: agora,
  };
  return {
    estado: { ...estado, labelProfiles: [...estado.labelProfiles, novo] },
    novo,
  };
}

export interface ResultadoRemocao {
  estado: EstadoPerfis;
  ok: boolean;
  mensagem?: string;
}

export function removerPerfil(estado: EstadoPerfis, id: string): ResultadoRemocao {
  if (estado.labelProfiles.length <= 1) {
    return { estado, ok: false, mensagem: "Não é possível excluir o único perfil existente." };
  }
  if (!estado.labelProfiles.some((p) => p.id === id)) {
    return { estado, ok: false, mensagem: "Perfil não encontrado." };
  }
  const restantes = estado.labelProfiles.filter((p) => p.id !== id);
  const removidoEraPadrao = estado.labelProfiles.find((p) => p.id === id)?.padrao ?? false;
  const labelProfiles =
    removidoEraPadrao && !restantes.some((p) => p.padrao)
      ? restantes.map((p, i) => (i === 0 ? { ...p, padrao: true } : p))
      : restantes;
  const labelProfileId =
    estado.labelProfileId === id
      ? (obterPadrao({ labelProfiles, labelProfileId: null })?.id ?? null)
      : estado.labelProfileId;
  return { estado: { labelProfiles, labelProfileId }, ok: true };
}

export function definirPadrao(estado: EstadoPerfis, id: string): EstadoPerfis {
  if (!estado.labelProfiles.some((p) => p.id === id)) return estado;
  return {
    ...estado,
    labelProfiles: estado.labelProfiles.map((p) => ({ ...p, padrao: p.id === id })),
  };
}

export function selecionarAtivo(estado: EstadoPerfis, id: string): EstadoPerfis {
  if (!estado.labelProfiles.some((p) => p.id === id)) return estado;
  return { ...estado, labelProfileId: id };
}
