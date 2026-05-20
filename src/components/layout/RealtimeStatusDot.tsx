import { useLocalRealtimeStatus } from "@/components/realtime/LocalRealtimeProvider";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Indicador discreto (bolinha 6px) do realtime local.
 * Verde=connected, âmbar=reconnecting/connecting, cinza=disconnected/idle.
 */
export function RealtimeStatusDot() {
  const status = useLocalRealtimeStatus();

  const color =
    status === "connected"
      ? "bg-emerald-500"
      : status === "connecting" || status === "reconnecting"
        ? "bg-amber-500 animate-pulse"
        : "bg-muted-foreground/40";

  const label =
    status === "connected"
      ? "Realtime local: conectado"
      : status === "connecting"
        ? "Realtime local: conectando…"
        : status === "reconnecting"
          ? "Realtime local: reconectando…"
          : status === "disconnected"
            ? "Realtime local: desconectado"
            : "Realtime local: inativo";

  if (status === "idle") return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={`inline-block h-1.5 w-1.5 rounded-full ${color}`}
            aria-label={label}
          />
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
