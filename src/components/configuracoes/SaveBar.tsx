import { Button } from "@/components/ui/button";
import { toast } from "sonner";

/**
 * Botão "Salvar" padrão das abas de Configurações.
 * Apenas visual; as abas com ações próprias salvam individualmente.
 */
export function SaveBar({
  label = "Salvar alterações",
  hint: _hint,
}: {
  label?: string;
  hint?: string;
}) {
  return (
    <div className="flex justify-end pt-2">
      <Button onClick={() => toast.success("Alterações salvas")}>
        {label}
      </Button>
    </div>
  );
}
