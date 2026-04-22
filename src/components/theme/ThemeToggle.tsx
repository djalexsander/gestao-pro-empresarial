import { Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme } from "./ThemeProvider";
import { cn } from "@/lib/utils";

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-10 w-10"
          aria-label="Alternar tema"
        >
          <Sun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel>Tema</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <ThemeItem
          label="Claro"
          icon={<Sun className="h-4 w-4" />}
          active={theme === "light"}
          onClick={() => setTheme("light")}
        />
        <ThemeItem
          label="Escuro"
          icon={<Moon className="h-4 w-4" />}
          active={theme === "dark"}
          onClick={() => setTheme("dark")}
        />
        <ThemeItem
          label="Sistema"
          icon={<Monitor className="h-4 w-4" />}
          active={theme === "system"}
          onClick={() => setTheme("system")}
          hint={resolvedTheme === "dark" ? "escuro" : "claro"}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ThemeItem({
  label,
  icon,
  active,
  onClick,
  hint,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  hint?: string;
}) {
  return (
    <DropdownMenuItem
      onClick={onClick}
      className={cn("gap-2", active && "bg-accent text-accent-foreground")}
    >
      {icon}
      <span className="flex-1">{label}</span>
      {hint && <span className="text-xs text-muted-foreground">({hint})</span>}
    </DropdownMenuItem>
  );
}
