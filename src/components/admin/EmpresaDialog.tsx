import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { AdminEmpresa } from "@/hooks/useAdmin";
import { useUpsertEmpresa } from "@/hooks/useAdmin";

interface Props {
  empresa: AdminEmpresa | null;
  open: boolean;
  onClose: () => void;
}

export function EmpresaDialog({ empresa, open, onClose }: Props) {
  const upsert = useUpsertEmpresa();

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [documento, setDocumento] = useState("");
  const [observacoes, setObservacoes] = useState("");

  useEffect(() => {
    if (empresa) {
      setNome(empresa.nome ?? "");
      setEmail(empresa.email ?? "");
      setTelefone(empresa.telefone ?? "");
      setDocumento(empresa.documento ?? "");
      setObservacoes(empresa.observacoes ?? "");
    }
  }, [empresa]);

  const submit = async () => {
    if (!empresa) return;
    if (!nome.trim()) return;
    await upsert.mutateAsync({
      id: empresa.id,
      nome: nome.trim(),
      email: email.trim() || null,
      telefone: telefone.trim() || null,
      documento: documento.trim() || null,
      observacoes: observacoes.trim() || null,
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar empresa</DialogTitle>
          <DialogDescription>
            Atualize os dados cadastrais. O plano é controlado pela assinatura comercial.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="nome">Nome da empresa *</Label>
            <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="telefone">Telefone</Label>
              <Input id="telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="doc">Documento (CNPJ/CPF)</Label>
              <Input id="doc" value={documento} onChange={(e) => setDocumento(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Plano efetivo</Label>
              <Input
                value={`${empresa?.plano_nome ?? "Free"}${empresa?.plano_gerenciado_assinatura ? " — gerenciado pela assinatura" : " — gratuito"}`}
                readOnly
              />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="obs">Observações internas</Label>
            <Textarea
              id="obs" rows={3}
              value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Notas visíveis apenas no painel master"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={submit} disabled={upsert.isPending || !nome.trim()}>
            {upsert.isPending ? "Salvando..." : "Salvar alterações"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
