import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import type { AdminEmpresa, EmpresaPlano } from "@/hooks/useAdmin";
import { useUpsertEmpresa } from "@/hooks/useAdmin";

interface Props {
  empresa: AdminEmpresa | null;
  open: boolean;
  onClose: () => void;
}

const PLANOS: { value: EmpresaPlano; label: string }[] = [
  { value: "free", label: "Free — gratuito" },
  { value: "starter", label: "Starter" },
  { value: "pro", label: "Pro" },
  { value: "enterprise", label: "Enterprise" },
];

export function EmpresaDialog({ empresa, open, onClose }: Props) {
  const upsert = useUpsertEmpresa();

  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [telefone, setTelefone] = useState("");
  const [documento, setDocumento] = useState("");
  const [plano, setPlano] = useState<EmpresaPlano>("free");
  const [observacoes, setObservacoes] = useState("");

  useEffect(() => {
    if (empresa) {
      setNome(empresa.nome ?? "");
      setEmail(empresa.email ?? "");
      setTelefone(empresa.telefone ?? "");
      setDocumento(empresa.documento ?? "");
      setPlano(empresa.plano);
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
      plano,
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
            Atualize os dados cadastrais e o plano da empresa.
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
              <Label>Plano</Label>
              <Select value={plano} onValueChange={(v) => setPlano(v as EmpresaPlano)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PLANOS.map((p) => (
                    <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
