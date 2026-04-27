import { Bell, AlertTriangle, AlertCircle, Info, CheckCircle2, Check, X, CheckCheck } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useNotificacoes,
  useMarcarNotificacaoLida,
  useExcluirNotificacao,
  useMarcarTodasLidas,
  type NotificacaoSeveridade,
} from "@/hooks/useNotificacoes";
import { cn } from "@/lib/utils";
import { useState } from "react";

const severityIcon: Record<NotificacaoSeveridade, React.ComponentType<{ className?: string }>> = {
  danger: AlertCircle,
  warning: AlertTriangle,
  info: Info,
};

const severityColor: Record<NotificacaoSeveridade, string> = {
  danger: "text-destructive",
  warning: "text-amber-500",
  info: "text-primary",
};

export function NotificationsBell({ size = "sm" }: { size?: "sm" | "md" }) {
  const { data: notifs = [], isLoading } = useNotificacoes();
  const marcarLida = useMarcarNotificacaoLida();
  const excluir = useExcluirNotificacao();
  const marcarTodas = useMarcarTodasLidas();
  const [open, setOpen] = useState(false);

  const total = notifs.length;
  const naoLidas = notifs.filter((n) => !n.read).length;
  const btnSize = size === "md" ? "h-10 w-10" : "h-9 w-9";
  const iconSize = size === "md" ? "h-5 w-5" : "h-[18px] w-[18px]";

  function handleMarcarTodas() {
    const chaves = notifs.filter((n) => !n.read).map((n) => n.id);
    if (chaves.length > 0) marcarTodas.mutate(chaves);
  }

  return (
    <TooltipProvider delayDuration={200}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="icon" className={cn("relative", btnSize)}>
            <Bell className={iconSize} />
            {naoLidas > 0 && (
              <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground ring-2 ring-background">
                {naoLidas > 9 ? "9+" : naoLidas}
              </span>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[380px] p-0">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold">Notificações</h3>
              <p className="text-xs text-muted-foreground">
                {total === 0
                  ? "Tudo em dia"
                  : naoLidas === 0
                    ? `${total} ${total === 1 ? "lida" : "lidas"}`
                    : `${naoLidas} não ${naoLidas === 1 ? "lida" : "lidas"} · ${total} no total`}
              </p>
            </div>
            {naoLidas > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={handleMarcarTodas}
                disabled={marcarTodas.isPending}
              >
                <CheckCheck className="h-3.5 w-3.5" />
                Marcar todas
              </Button>
            )}
          </div>

          <ScrollArea className="max-h-[420px]">
            {isLoading ? (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Carregando…
              </div>
            ) : total === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
                <CheckCircle2 className="h-8 w-8 text-emerald-500" />
                <p className="text-sm font-medium">Nenhuma notificação</p>
                <p className="text-xs text-muted-foreground">
                  Seu negócio está em ordem.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {notifs.map((n) => {
                  const Icon = severityIcon[n.severidade];
                  return (
                    <li
                      key={n.id}
                      className={cn(
                        "group relative transition-colors",
                        n.read ? "bg-transparent opacity-60" : "bg-muted/30",
                      )}
                    >
                      <Link
                        to={n.rota as "/"}
                        onClick={() => {
                          if (!n.read) marcarLida.mutate(n.id);
                          setOpen(false);
                        }}
                        className="flex gap-3 px-4 py-3 pr-20 hover:bg-muted/50"
                      >
                        <div className="relative mt-0.5 flex-shrink-0">
                          <Icon className={cn("h-4 w-4", severityColor[n.severidade])} />
                          {!n.read && (
                            <span className="absolute -left-1.5 top-1/2 h-1.5 w-1.5 -translate-y-1/2 rounded-full bg-primary" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cn("truncate text-sm", n.read ? "font-normal" : "font-semibold")}>
                            {n.titulo}
                          </p>
                          <p className="line-clamp-2 text-xs text-muted-foreground">
                            {n.descricao}
                          </p>
                        </div>
                      </Link>

                      {/* Ações: marcar lida / excluir */}
                      <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        {!n.read && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  marcarLida.mutate(n.id);
                                }}
                                disabled={marcarLida.isPending}
                              >
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Marcar como lida</TooltipContent>
                          </Tooltip>
                        )}
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                excluir.mutate(n.id);
                              }}
                              disabled={excluir.isPending}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>Excluir notificação</TooltipContent>
                        </Tooltip>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </TooltipProvider>
  );
}
