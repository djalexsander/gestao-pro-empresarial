import { Bell, AlertTriangle, AlertCircle, Info, CheckCircle2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useNotificacoes, type NotificacaoSeveridade } from "@/hooks/useNotificacoes";
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
  const [open, setOpen] = useState(false);

  const total = notifs.length;
  const btnSize = size === "md" ? "h-10 w-10" : "h-9 w-9";
  const iconSize = size === "md" ? "h-5 w-5" : "h-[18px] w-[18px]";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className={cn("relative", btnSize)}>
          <Bell className={iconSize} />
          {total > 0 && (
            <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground ring-2 ring-background">
              {total > 9 ? "9+" : total}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <h3 className="text-sm font-semibold">Notificações</h3>
            <p className="text-xs text-muted-foreground">
              {total === 0 ? "Tudo em dia" : `${total} ${total === 1 ? "alerta" : "alertas"}`}
            </p>
          </div>
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
                  <li key={n.id}>
                    <Link
                      to={n.rota as "/"}
                      onClick={() => setOpen(false)}
                      className="flex gap-3 px-4 py-3 transition-colors hover:bg-muted/50"
                    >
                      <Icon className={cn("mt-0.5 h-4 w-4 flex-shrink-0", severityColor[n.severidade])} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{n.titulo}</p>
                        <p className="line-clamp-2 text-xs text-muted-foreground">
                          {n.descricao}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
