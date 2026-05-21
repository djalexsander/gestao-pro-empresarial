/**
 * Onda 0 — Painel collapsible "Auditoria deste relatório".
 *
 * Mostra fonte, filtros aplicados, total bruto x total usado, soma calculada
 * e divergências encontradas. NÃO entra na área de exportação.
 */

import { useState } from "react";
import { ChevronDown, ChevronRight, ShieldCheck, AlertTriangle } from "lucide-react";
import type { RelatorioAuditoria } from "@/lib/relatorios/audit";

interface Props {
  audit: RelatorioAuditoria | null | undefined;
  className?: string;
}

function fmtFiltroValue(v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

const MOTIVO_LABEL: Record<string, string> = {
  cancelado: "Cancelados",
  estornado: "Estornados",
  excluido: "Excluídos",
  inativo: "Inativos",
  rascunho: "Rascunhos",
  fora_do_filtro: "Fora do filtro",
  sem_empresa: "Sem empresa vinculada",
  outro: "Outros",
};

export function AuditoriaCard({ audit, className }: Props) {
  const [aberto, setAberto] = useState(false);

  if (!audit) return null;

  const semDados = audit.totalRegistros === 0 && audit.totalCalculado === 0;
  const temDivergencia = audit.divergencias.length > 0;
  const Icon = temDivergencia ? AlertTriangle : ShieldCheck;
  const iconClass = temDivergencia ? "text-amber-500" : "text-emerald-500";

  return (
    <div
      className={`mt-4 rounded-md border border-border bg-card/50 text-xs ${className ?? ""}`}
      data-auditoria-card
    >
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-muted/30 rounded-md"
        aria-expanded={aberto}
      >
        <span className="flex items-center gap-2">
          <Icon className={`h-3.5 w-3.5 ${iconClass}`} />
          <span className="font-medium text-foreground">
            Auditoria deste relatório
          </span>
          <span className="text-muted-foreground">
            · {audit.totalRegistros} registro(s) · R${" "}
            {audit.totalCalculado.toLocaleString("pt-BR", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
          {semDados && (
            <span className="text-muted-foreground italic">· sem dados</span>
          )}
          {temDivergencia && (
            <span className="text-amber-600">
              · {audit.divergencias.length} divergência(s)
            </span>
          )}
        </span>
        {aberto ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>

      {aberto && (
        <div className="border-t border-border px-3 py-2 space-y-2 text-muted-foreground">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
            <div>
              <span className="font-medium text-foreground">Relatório:</span>{" "}
              {audit.relatorio}
            </div>
            <div>
              <span className="font-medium text-foreground">Fonte:</span>{" "}
              {audit.fonte}
            </div>
            <div>
              <span className="font-medium text-foreground">Empresa (owner):</span>{" "}
              {audit.ownerId ?? "—"}
            </div>
            <div>
              <span className="font-medium text-foreground">Gerado em:</span>{" "}
              {new Date(audit.geradoEm).toLocaleString("pt-BR")}
            </div>
            <div>
              <span className="font-medium text-foreground">Registros lidos:</span>{" "}
              {audit.totalRegistrosLidos}
            </div>
            <div>
              <span className="font-medium text-foreground">Registros usados:</span>{" "}
              {audit.totalRegistros}
            </div>
          </div>

          {Object.keys(audit.filtros).length > 0 && (
            <div>
              <div className="font-medium text-foreground mb-0.5">Filtros</div>
              <ul className="space-y-0.5">
                {Object.entries(audit.filtros).map(([k, v]) => (
                  <li key={k}>
                    <span className="text-foreground/80">{k}:</span>{" "}
                    {fmtFiltroValue(v)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {audit.ignorados.length > 0 && (
            <div>
              <div className="font-medium text-foreground mb-0.5">
                Registros ignorados
              </div>
              <ul className="space-y-0.5">
                {audit.ignorados.map((i) => (
                  <li key={i.motivo}>
                    {MOTIVO_LABEL[i.motivo] ?? i.motivo}: {i.quantidade}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {audit.divergencias.length > 0 && (
            <div>
              <div className="font-medium text-amber-600 mb-0.5">
                Divergências
              </div>
              <ul className="space-y-0.5">
                {audit.divergencias.map((d, idx) => (
                  <li key={`${d.campo}-${idx}`}>
                    <span className="text-foreground/80">{d.campo}:</span>{" "}
                    esperado <strong>{fmtFiltroValue(d.esperado)}</strong>,
                    obtido <strong>{fmtFiltroValue(d.obtido)}</strong>
                    {d.detalhe ? ` — ${d.detalhe}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
