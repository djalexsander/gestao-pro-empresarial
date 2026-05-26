import { Button } from "@/components/ui/button";
import { Save } from "lucide-react";
import { toast } from "sonner";

/**
 * Barra visual de "Salvar alterações" para abas de Configurações que ainda
 * não possuem um botão de salvar de nível superior. Sem lógica real — apenas
 * UI consistente. As mutações reais acontecem em diálogos/linhas internas.
 */
export function SaveBar({
  label = "Salvar alterações",
  hint,
}: {
  label?: string;
  hint?: string;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 mt-6 flex items-center justify-between gap-3 rounded-lg border border-border bg-card/95 px-4 py-3 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-card/80">
      <p className="text-xs text-muted-foreground">
        {hint ?? "As alterações são aplicadas imediatamente nesta seção."}
      </p>
      <Button
        onClick={() => toast.success("Alterações salvas")}
        className="gap-2"
      >
        <Save className="h-4 w-4" />
        {label}
      </Button>
    </div>
  );
}
