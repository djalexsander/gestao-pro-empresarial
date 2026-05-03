import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Circle,
  ClipboardCheck,
  RotateCcw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * Checklist de Piloto Comercial.
 *
 * Lista verificável (persistida em localStorage) que o implantador percorre
 * em campo. Não muda nenhum fluxo de negócio: é puramente UX/operacional para
 * critérios de aceite do piloto.
 */

interface Item {
  id: string;
  label: string;
  hint?: string;
  critico?: boolean;
}

interface Grupo {
  titulo: string;
  itens: Item[];
}

const GRUPOS: Grupo[] = [
  {
    titulo: "Instalação",
    itens: [
      { id: "inst-srv", label: "Servidor instalado e papel definido", critico: true },
      { id: "inst-term", label: "Terminais instalados e papel definido", critico: true },
      { id: "inst-fw", label: "Firewall liberou a porta na rede privada" },
      { id: "inst-ip", label: "IP da rede local fixado/conhecido" },
    ],
  },
  {
    titulo: "Pareamento",
    itens: [
      { id: "par-test", label: "Cada terminal passou no teste de conexão", critico: true },
      { id: "par-id", label: "Identidade do servidor confere em todos", critico: true },
      { id: "par-list", label: "Terminais aparecem na lista do servidor" },
    ],
  },
  {
    titulo: "Operação online",
    itens: [
      { id: "op-venda", label: "Venda concluída no terminal", critico: true },
      { id: "op-caixa", label: "Abertura/fechamento de caixa OK", critico: true },
      { id: "op-canc", label: "Cancelamento de venda processou" },
      { id: "op-fin", label: "Lançamento financeiro manual gravou" },
    ],
  },
  {
    titulo: "Operação offline → retorno",
    itens: [
      { id: "off-venda", label: "Venda offline gravou localmente", critico: true },
      { id: "off-caixa", label: "Caixa offline gravou localmente" },
      { id: "off-fin", label: "Financeiro offline gravou localmente" },
      { id: "off-drain", label: "Filas drenaram após retorno da rede", critico: true },
      { id: "off-noerr", label: "Nenhuma fila ficou em estado de erro persistente" },
    ],
  },
  {
    titulo: "Backup, restauração e updater",
    itens: [
      { id: "bk-auto", label: "Backup automático rodou nas últimas 24h", critico: true },
      { id: "bk-export", label: "Backup exportado para mídia externa" },
      { id: "bk-restore", label: "Restauração testada em ambiente de teste" },
      { id: "up-check", label: "Updater verifica versão sem erro", critico: true },
      { id: "up-install", label: "Instalação de nova versão validada" },
    ],
  },
  {
    titulo: "Aceite final",
    itens: [
      { id: "ac-stab", label: "8h de operação contínua sem erro crítico", critico: true },
      { id: "ac-supp", label: "Equipe local treinada para operação básica" },
      { id: "ac-doc", label: "Dados de suporte (versão, server id, hostname) registrados" },
    ],
  },
];

const STORAGE_KEY = "gestao-pro:piloto-checklist:v1";

function loadState(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export function PilotoChecklist() {
  const [marcados, setMarcados] = useState<Record<string, boolean>>(() =>
    loadState(),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(marcados));
    } catch {
      /* ignore */
    }
  }, [marcados]);

  const todos = useMemo(() => GRUPOS.flatMap((g) => g.itens), []);
  const total = todos.length;
  const feitos = todos.filter((i) => marcados[i.id]).length;
  const criticos = todos.filter((i) => i.critico);
  const criticosFeitos = criticos.filter((i) => marcados[i.id]).length;
  const aceito = criticosFeitos === criticos.length && feitos === total;

  function toggle(id: string) {
    setMarcados((m) => ({ ...m, [id]: !m[id] }));
  }

  function reset() {
    setMarcados({});
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2">
          <ClipboardCheck className="h-5 w-5" />
          Checklist de piloto comercial
        </CardTitle>
        <div className="flex items-center gap-2">
          {aceito ? (
            <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30">
              Piloto aceito
            </Badge>
          ) : (
            <Badge variant="outline">
              {feitos}/{total} • críticos {criticosFeitos}/{criticos.length}
            </Badge>
          )}
          <Button size="sm" variant="ghost" onClick={reset}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Resetar
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <Progress value={(feitos / total) * 100} />

        <div className="grid gap-4 md:grid-cols-2">
          {GRUPOS.map((g) => (
            <div key={g.titulo} className="rounded-lg border bg-card/40 p-3">
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {g.titulo}
              </div>
              <ul className="space-y-1.5">
                {g.itens.map((it) => {
                  const ok = !!marcados[it.id];
                  return (
                    <li key={it.id}>
                      <button
                        type="button"
                        onClick={() => toggle(it.id)}
                        className="flex w-full items-start gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted/40"
                      >
                        {ok ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                        ) : (
                          <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="flex-1">
                          <span
                            className={
                              ok ? "line-through text-muted-foreground" : ""
                            }
                          >
                            {it.label}
                          </span>
                          {it.critico && (
                            <Badge
                              variant="outline"
                              className="ml-2 align-middle text-[9px]"
                            >
                              crítico
                            </Badge>
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground">
          O checklist fica salvo neste navegador. Marque os itens à medida que
          forem validados em campo. O piloto é considerado{" "}
          <strong>aceito</strong> quando todos os itens críticos estiverem
          marcados.
        </p>
      </CardContent>
    </Card>
  );
}
