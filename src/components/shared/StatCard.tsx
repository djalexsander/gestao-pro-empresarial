import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: string;
  change?: number;
  trend?: "up" | "down";
  hint?: string;
  icon: LucideIcon;
  iconTone?: "primary" | "success" | "warning" | "danger" | "info";
  onClick?: () => void;
  className?: string;
}

const tones = {
  primary: "bg-primary/10 text-primary ring-1 ring-primary/15",
  success: "bg-success/10 text-success ring-1 ring-success/15",
  warning: "bg-warning/15 text-warning-foreground ring-1 ring-warning/20",
  danger: "bg-destructive/10 text-destructive ring-1 ring-destructive/15",
  info: "bg-info/10 text-info ring-1 ring-info/15",
};

export function StatCard({
  label,
  value,
  change,
  trend = "up",
  hint,
  icon: Icon,
  iconTone = "primary",
  onClick,
  className,
}: StatCardProps) {
  const positive = trend === "up";
  const clickable = !!onClick;
  const Wrapper = clickable ? "button" : "div";
  return (
    <Card
      className={cn(
        "group min-h-[108px] overflow-hidden shadow-sm transition-colors",
        clickable && "cursor-pointer hover:border-primary/35 hover:bg-muted/20",
        className,
      )}
    >
      <Wrapper
        type={clickable ? "button" : undefined}
        onClick={onClick}
        className={cn(
          "flex h-full w-full flex-col justify-between text-left",
          clickable && "focus-visible:outline-none",
        )}
      >
        <CardContent className="flex flex-1 flex-col justify-between p-4 sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-xs font-semibold uppercase text-muted-foreground">
                  {label}
                </p>
                {clickable && (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </div>
              <p className="mt-2 text-2xl font-semibold text-foreground tabular-nums">
                {value}
              </p>
              <div className="mt-2 flex items-center gap-2 text-xs">
                {typeof change === "number" && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold",
                      positive
                        ? "bg-success/10 text-success"
                        : "bg-destructive/10 text-destructive",
                    )}
                  >
                    {positive ? (
                      <ArrowUpRight className="h-3 w-3" />
                    ) : (
                      <ArrowDownRight className="h-3 w-3" />
                    )}
                    {Math.abs(change)}%
                  </span>
                )}
                {hint && <span className="text-muted-foreground">{hint}</span>}
              </div>
            </div>
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                tones[iconTone],
              )}
            >
              <Icon className="h-4 w-4" />
            </div>
          </div>
        </CardContent>
      </Wrapper>
    </Card>
  );
}
