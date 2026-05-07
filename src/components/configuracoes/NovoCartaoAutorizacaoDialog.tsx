import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { useFuncionariosAtivos } from "@/hooks/useFuncionarios";
import { useCriarCartaoAutorizacao } from "@/hooks/useAutorizacoes";

function gerarCodigoSeguro(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint32Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr, (n) => alphabet[n % alphabet.length]).join("");
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCriado: (data: { codigo: string; rotulo: string }) => void;
}

export function NovoCartaoAutorizacaoDialog({ open, onOpenChange, onCriado }: Props) {
  const { data: funcionarios = [] } = useFuncionariosAtivos();
  const criar = useCriarCartaoAutorizacao();

  const [rotulo, setRotulo] = useState("");
  const [funcao, setFuncao] = useState("");
  const [vinculoTipo, setVinculoTipo] = useState<"funcionario" | "generico">("funcionario");
  const [funcionarioId, setFuncionarioId] = useState<string>("");

  function reset() {
    setRotulo(""); setFuncao(""); setVinculoTipo("funcionario"); setFuncionarioId("");
  }

  async function handleCriar() {
    if (!rotulo.trim()) { toast.error("Informe um rótulo"); return; }
    if (vinculoTipo === "funcionario" && !funcionarioId) {
      toast.error("Selecione o funcionário vinculado"); return;
    }
    const codigo = gerarCodigoSeguro();
    try {
      await criar.mutateAsync({
        rotulo: rotulo.trim(),
        codigo,
        funcao: funcao.trim() || null,
        funcionario_id: vinculoTipo === "funcionario" ? funcionarioId : null,
      });
      toast.success("Cartão criado. Imprima ou exporte agora — o código não será mostrado novamente.");
      onCriado({ codigo, rotulo: rotulo.trim() });
      reset();
      onOpenChange(false);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Novo cartão de autorização</DialogTitle>
          <DialogDescription>
            Cada cartão tem código único vinculado a um autorizador. O código completo só será exibido uma vez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label className="text-xs">Rótulo</Label>
            <Input value={rotulo} onChange={(e) => setRotulo(e.target.value)} placeholder="Ex: Cartão Gerente João" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Função / cargo (opcional)</Label>
            <Input value={funcao} onChange={(e) => setFuncao(e.target.value)} placeholder="Ex: Gerente de loja" className="mt-1" />
          </div>
          <div>
            <Label className="text-xs">Vínculo</Label>
            <Select value={vinculoTipo} onValueChange={(v) => setVinculoTipo(v as "funcionario" | "generico")}>
              <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="funcionario">Funcionário cadastrado</SelectItem>
                <SelectItem value="generico">Genérico (sem usuário específico)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {vinculoTipo === "funcionario" && (
            <div>
              <Label className="text-xs">Funcionário autorizador</Label>
              <Select value={funcionarioId} onValueChange={setFuncionarioId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Selecione..." /></SelectTrigger>
                <SelectContent>
                  {funcionarios.filter((f) => ["admin", "gerente"].includes(f.role)).map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.nome} ({f.role})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Apenas funcionários com cargo admin ou gerente podem autorizar.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleCriar} disabled={criar.isPending}>
            {criar.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <KeyRound className="mr-2 h-4 w-4" />}
            Gerar código e criar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
