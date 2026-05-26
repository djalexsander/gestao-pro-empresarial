import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Botão "Salvar" padrão das abas de Configurações — mesmo estilo do botão
 * da aba Balança: alinhado à direita no fim da página, sem barra sticky.
 * Apenas visual (toast de sucesso).
 */
export function SaveBar({ label = "Salvar alterações" }: { label?: string }) {
  return (
    <div className="flex justify-end pt-2">
      <Button onClick={() => toast.success("Alterações salvas")}>
        {label}
      </Button>
    </div>
  );
}
