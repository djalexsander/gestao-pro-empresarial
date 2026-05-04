import { useState } from "react";
import { Filter, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  PRESET_LABELS,
  type PeriodoPreset,
  type PeriodoRange,
  computePeriodo,
  formatPeriodoBR,
} from "@/lib/dateRange";

const PRESETS: PeriodoPreset[] = [
  "hoje",
  "ontem",
  "semana",
  "mes",
  "mes_anterior",
  "personalizado",
];

export type FormaFiltro =
  | "todos"
  | "dinheiro"
  | "pix"
  | "credito"
  | "debito"
  | "fiado"
  | "ifood";

const FORMA_LABELS: Record<FormaFiltro, string> = {
  todos: "Todos",
  dinheiro: "Dinheiro",
  pix: "Pix",
  credito: "Cartão de crédito",
  debito: "Cartão de débito",
  fiado: "Fiado",
  ifood: "iFood",
};

export interface SecaoFiltroValue {
  preset: PeriodoPreset;
  custom?: { inicio?: string; fim?: string };
  forma?: FormaFiltro;
}

interface Props {
  value: SecaoFiltroValue;
  onChange: (v: SecaoFiltroValue) => void;
  showForma?: boolean;
}

export function SecaoFiltro({ value, onChange, showForma }: Props) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SecaoFiltroValue>(value);

  const periodo: PeriodoRange = computePeriodo(value.preset, value.custom);
  const periodoLabel = `${PRESET_LABELS[value.preset]} · ${formatPeriodoBR(periodo)}`;

  function apply() {
    onChange(draft);
    setOpen(false);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setDraft(value);
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="h-8 gap-1.5 px-2.5 text-xs">
          <Filter className="h-3.5 w-3.5" />
          Filtros
          <span className="hidden text-muted-foreground sm:inline">· {PRESET_LABELS[value.preset]}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,22rem)] space-y-3 p-3">
        <div>
          <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Período
          </Label>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            {PRESETS.map((p) => {
              const active = draft.preset === p;
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, preset: p }))}
                  className={cn(
                    "flex items-center justify-between rounded-md border px-2 py-1.5 text-xs transition-colors",
                    active
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:text-foreground",
                  )}
                >
                  {PRESET_LABELS[p]}
                  {active && <Check className="h-3 w-3" />}
                </button>
              );
            })}
          </div>
        </div>

        {draft.preset === "personalizado" && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-[11px]">Início</Label>
              <Input
                type="date"
                value={draft.custom?.inicio ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, custom: { ...d.custom, inicio: e.target.value } }))
                }
                className="h-8 text-xs"
              />
            </div>
            <div>
              <Label className="text-[11px]">Fim</Label>
              <Input
                type="date"
                value={draft.custom?.fim ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, custom: { ...d.custom, fim: e.target.value } }))
                }
                className="h-8 text-xs"
              />
            </div>
          </div>
        )}

        {showForma && (
          <div>
            <Label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Origem / forma
            </Label>
            <Select
              value={draft.forma ?? "todos"}
              onValueChange={(v) => setDraft((d) => ({ ...d, forma: v as FormaFiltro }))}
            >
              <SelectTrigger className="mt-2 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(FORMA_LABELS) as FormaFiltro[]).map((f) => (
                  <SelectItem key={f} value={f} className="text-xs">
                    {FORMA_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="flex items-center justify-between border-t pt-2">
          <span className="truncate text-[11px] text-muted-foreground" title={periodoLabel}>
            {periodoLabel}
          </span>
          <Button size="sm" className="h-7 px-3 text-xs" onClick={apply}>
            Aplicar
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
