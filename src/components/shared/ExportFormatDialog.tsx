import { FileText, Image as ImageIcon, FileSpreadsheet } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { ExportFormato } from "@/lib/export-relatorio-card";

interface ExportFormatDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Nome do relatório a exibir no título do dialog. */
  titulo: string;
  /** Chamado ao escolher um formato; o dialog fecha automaticamente após. */
  onChoose: (formato: ExportFormato) => void;
  /** Desabilita os botões enquanto exporta. */
  loading?: boolean;
}

export function ExportFormatDialog({
  open,
  onOpenChange,
  titulo,
  onChoose,
  loading,
}: ExportFormatDialogProps) {
  function pick(f: ExportFormato) {
    onChoose(f);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] flex-col overflow-hidden sm:max-w-md">
        <DialogHeader className="shrink-0">
          <DialogTitle>Exportar relatório</DialogTitle>
          <DialogDescription>
            Escolha o formato para exportar &quot;{titulo}&quot;.
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-2 overflow-y-auto px-1 py-2 pr-2">
          <Button
            variant="outline"
            className="h-auto justify-start gap-3 px-4 py-3"
            disabled={loading}
            onClick={() => pick("pdf")}
          >
            <FileText className="h-5 w-5 text-destructive" />
            <div className="text-left">
              <div className="font-semibold">Exportar PDF</div>
              <div className="text-xs text-muted-foreground">
                Documento pronto para impressão com cabeçalho da empresa.
              </div>
            </div>
          </Button>

          <Button
            variant="outline"
            className="h-auto justify-start gap-3 px-4 py-3"
            disabled={loading}
            onClick={() => pick("png")}
          >
            <ImageIcon className="h-5 w-5 text-info" />
            <div className="text-left">
              <div className="font-semibold">Exportar PNG</div>
              <div className="text-xs text-muted-foreground">
                Imagem com tema escuro do sistema, ideal para compartilhar.
              </div>
            </div>
          </Button>

          <Button
            variant="outline"
            className="h-auto justify-start gap-3 px-4 py-3"
            disabled={loading}
            onClick={() => pick("csv")}
          >
            <FileSpreadsheet className="h-5 w-5 text-success" />
            <div className="text-left">
              <div className="font-semibold">Exportar CSV</div>
              <div className="text-xs text-muted-foreground">
                Planilha pronta para abrir no Excel (pt-BR).
              </div>
            </div>
          </Button>
        </div>

        <DialogFooter className="shrink-0 border-t border-border pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
