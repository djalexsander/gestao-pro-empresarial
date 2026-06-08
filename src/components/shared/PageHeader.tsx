import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  actions?: ReactNode;
  filters?: ReactNode;
}

export function PageHeader({ title, description, actions, filters }: PageHeaderProps) {
  return (
    <div className="border-b border-border/80 pb-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[1.7rem] font-semibold leading-tight text-foreground">
            {title}
          </h1>
          {description && (
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex shrink-0 flex-wrap items-center justify-start gap-2 sm:justify-end">
            {actions}
          </div>
        )}
      </div>
      {filters && (
        <div className="mt-4 rounded-lg border border-border/70 bg-muted/20 p-3">
          {filters}
        </div>
      )}
    </div>
  );
}
