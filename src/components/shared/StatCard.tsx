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
  primary: "bg-primary/10 text-primary",
  success: "bg-success/10 text-success",
  warning: "bg-warning/15 text-warning-foreground",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-info/10 text-info",
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
        "group min-h-[120px] overflow-hidden rounded-2xl shadow-sm transition-all hover:shadow-md",
        clickable && "cursor-pointer hover:border-primary/40 hover:bg-card/80",
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
        <CardContent className="flex flex-1 flex-col justify-between p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <p className="truncate text-sm font-medium text-muted-foreground">{label}</p>
                {clickable && (
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
                )}
              </div>
              <p className="mt-2 text-2xl font-semibold tracking-tight text-foreground tabular-nums">
                {value}
              </p>
              <div className="mt-3 flex items-center gap-2 text-xs">
                {typeof change === "number" && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-medium",
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
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105",
                tones[iconTone],
              )}
            >
              <Icon className="h-5 w-5" />
            </div>
          </div>
        </CardContent>
      </Wrapper>
    </Card>
  );
}
