// Helpers de intervalos de datas usados nos filtros do Financeiro.

export type PeriodoPreset =
  | "hoje"
  | "ontem"
  | "semana"
  | "mes"
  | "mes_anterior"
  | "personalizado";

export interface PeriodoRange {
  inicio: string; // YYYY-MM-DD
  fim: string; // YYYY-MM-DD
  inicioTs: string;
  fimTs: string;
  preset: PeriodoPreset;
}

export const PRESET_LABELS: Record<PeriodoPreset, string> = {
  hoje: "Hoje",
  ontem: "Ontem",
  semana: "Esta semana",
  mes: "Este mês",
  mes_anterior: "Mês anterior",
  personalizado: "Personalizado",
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function range(inicio: Date, fim: Date, preset: PeriodoPreset): PeriodoRange {
  const i = ymd(inicio);
  const f = ymd(fim);
  return {
    inicio: i,
    fim: f,
    inicioTs: `${i}T00:00:00`,
    fimTs: `${f}T23:59:59.999`,
    preset,
  };
}

export function computePeriodo(
  preset: PeriodoPreset,
  custom?: { inicio?: string; fim?: string },
): PeriodoRange {
  const today = new Date();
  switch (preset) {
    case "hoje":
      return range(today, today, "hoje");
    case "ontem": {
      const d = new Date(today);
      d.setDate(d.getDate() - 1);
      return range(d, d, "ontem");
    }
    case "semana": {
      // Semana iniciando no domingo
      const start = new Date(today);
      start.setDate(today.getDate() - today.getDay());
      return range(start, today, "semana");
    }
    case "mes": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return range(start, today, "mes");
    }
    case "mes_anterior": {
      const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const end = new Date(today.getFullYear(), today.getMonth(), 0);
      return range(start, end, "mes_anterior");
    }
    case "personalizado": {
      const i = custom?.inicio ? new Date(`${custom.inicio}T00:00:00`) : today;
      const f = custom?.fim ? new Date(`${custom.fim}T00:00:00`) : today;
      return range(i, f, "personalizado");
    }
  }
}

export function formatPeriodoBR(p: PeriodoRange): string {
  const fmt = (s: string) => {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  };
  if (p.inicio === p.fim) return fmt(p.inicio);
  return `${fmt(p.inicio)} → ${fmt(p.fim)}`;
}
