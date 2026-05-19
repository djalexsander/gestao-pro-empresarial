import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FormSection } from "@/components/shared/FormSection";
import {
  useCreateFornecedor,
  useUpdateFornecedor,
  type Fornecedor,
  type FornecedorInput,
} from "@/hooks/useFornecedores";

const schema = z.object({
  tipo: z.enum(["PF", "PJ"]),
  razao_social: z.string().trim().min(2, "Nome / razão social obrigatório").max(200),
  nome_fantasia: z.string().trim().max(200).optional().or(z.literal("")),
  documento: z.string().trim().max(20).optional().or(z.literal("")),
  email: z.string().trim().email("E-mail inválido").max(200).optional().or(z.literal("")),
  telefone: z.string().trim().max(30).optional().or(z.literal("")),
});

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  fornecedor?: Fornecedor | null;
}

const empty = {
  tipo: "PJ" as "PF" | "PJ",
  razao_social: "",
  nome_fantasia: "",
  documento: "",
  inscricao_estadual: "",
  email: "",
  telefone: "",
  contato_nome: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  estado: "",
  observacoes: "",
  status: "ativo" as "ativo" | "inativo",
};

export function FornecedorDialog({ open, onOpenChange, fornecedor }: Props) {
  const isEdit = !!fornecedor;
  const create = useCreateFornecedor();
  const update = useUpdateFornecedor();
  const [form, setForm] = useState(empty);

  useEffect(() => {
    if (!open) return;
    if (fornecedor) {
      setForm({
        tipo: fornecedor.tipo,
        razao_social: fornecedor.razao_social,
        nome_fantasia: fornecedor.nome_fantasia ?? "",
        documento: fornecedor.documento ?? "",
        inscricao_estadual: fornecedor.inscricao_estadual ?? "",
        email: fornecedor.email ?? "",
        telefone: fornecedor.telefone ?? "",
        contato_nome: fornecedor.contato_nome ?? "",
        cep: fornecedor.cep ?? "",
        logradouro: fornecedor.logradouro ?? "",
        numero: fornecedor.numero ?? "",
        complemento: fornecedor.complemento ?? "",
        bairro: fornecedor.bairro ?? "",
        cidade: fornecedor.cidade ?? "",
        estado: fornecedor.estado ?? "",
        observacoes: fornecedor.observacoes ?? "",
        status: fornecedor.status,
      });
    } else {
      setForm(empty);
    }
  }, [open, fornecedor]);

  async function handleSubmit() {
    const parsed = schema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    const payload: FornecedorInput = {
      tipo: form.tipo,
      razao_social: form.razao_social.trim(),
      nome_fantasia: form.nome_fantasia.trim() || null,
      documento: form.documento.trim() || null,
      inscricao_estadual: form.inscricao_estadual.trim() || null,
      email: form.email.trim() || null,
      telefone: form.telefone.trim() || null,
      contato_nome: form.contato_nome.trim() || null,
      cep: form.cep.trim() || null,
      logradouro: form.logradouro.trim() || null,
      numero: form.numero.trim() || null,
      complemento: form.complemento.trim() || null,
      bairro: form.bairro.trim() || null,
      cidade: form.cidade.trim() || null,
      estado: form.estado.trim() || null,
      observacoes: form.observacoes.trim() || null,
      status: form.status,
    };
    try {
      if (isEdit && fornecedor) {
        await update.mutateAsync({ id: fornecedor.id, ...payload });
      } else {
        await create.mutateAsync(payload);
      }
      onOpenChange(false);
    } catch {/* toast no hook */}
  }

  const busy = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar fornecedor" : "Novo fornecedor"}</DialogTitle>
          <DialogDescription>
            Cadastre os dados do parceiro comercial. Apenas o nome é obrigatório.
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="dados">
          <TabsList>
            <TabsTrigger value="dados">Dados</TabsTrigger>
            <TabsTrigger value="endereco">Endereço</TabsTrigger>
            <TabsTrigger value="extra">Outros</TabsTrigger>
          </TabsList>

          <TabsContent value="dados" className="mt-4 space-y-6">
            <FormSection
              title="Identificação"
              subtitle="Como o fornecedor aparece nas listagens e relatórios."
              tone="operacional"
              divider={false}
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Tipo</Label>
                  <Select value={form.tipo} onValueChange={(v) => setForm({ ...form, tipo: v as "PF" | "PJ" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="PJ">Pessoa Jurídica</SelectItem>
                      <SelectItem value="PF">Pessoa Física</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Status</Label>
                  <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as "ativo" | "inativo" })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ativo">Ativo</SelectItem>
                      <SelectItem value="inativo">Inativo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{form.tipo === "PJ" ? "Razão social *" : "Nome completo *"}</Label>
                <Input value={form.razao_social} onChange={(e) => setForm({ ...form, razao_social: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Nome fantasia</Label>
                <Input value={form.nome_fantasia} onChange={(e) => setForm({ ...form, nome_fantasia: e.target.value })} />
              </div>
            </FormSection>

            <FormSection
              title="Documentos fiscais"
              subtitle="Usados em notas, livros fiscais e cadastros tributários."
              tone="fiscal"
            >
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>{form.tipo === "PJ" ? "CNPJ" : "CPF"}</Label>
                  <Input value={form.documento} onChange={(e) => setForm({ ...form, documento: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Inscrição estadual</Label>
                  <Input value={form.inscricao_estadual} onChange={(e) => setForm({ ...form, inscricao_estadual: e.target.value })} />
                </div>
              </div>
            </FormSection>

            <FormSection title="Contato" tone="operacional">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>E-mail</Label>
                  <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <Label>Telefone</Label>
                  <Input value={form.telefone} onChange={(e) => setForm({ ...form, telefone: e.target.value })} />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Pessoa de contato</Label>
                <Input value={form.contato_nome} onChange={(e) => setForm({ ...form, contato_nome: e.target.value })} />
              </div>
            </FormSection>
          </TabsContent>

          <TabsContent value="endereco" className="mt-4 space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>CEP</Label>
                <Input value={form.cep} onChange={(e) => setForm({ ...form, cep: e.target.value })} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Logradouro</Label>
                <Input value={form.logradouro} onChange={(e) => setForm({ ...form, logradouro: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Número</Label>
                <Input value={form.numero} onChange={(e) => setForm({ ...form, numero: e.target.value })} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Complemento</Label>
                <Input value={form.complemento} onChange={(e) => setForm({ ...form, complemento: e.target.value })} />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label>Bairro</Label>
                <Input value={form.bairro} onChange={(e) => setForm({ ...form, bairro: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Cidade</Label>
                <Input value={form.cidade} onChange={(e) => setForm({ ...form, cidade: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Estado</Label>
                <Input maxLength={2} value={form.estado} onChange={(e) => setForm({ ...form, estado: e.target.value.toUpperCase() })} />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="extra" className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Observações</Label>
              <Textarea rows={5} value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} maxLength={1000} />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={busy}>
            {busy ? "Salvando..." : isEdit ? "Salvar alterações" : "Cadastrar fornecedor"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
