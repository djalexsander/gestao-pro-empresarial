import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { Loader2 } from "lucide-react";
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
import {
  checkDocumentoDuplicado,
  useCreateCliente,
  useUpdateCliente,
  type Cliente,
  type ClienteInput,
  type PessoaTipo,
} from "@/hooks/useClientes";

const schema = z.object({
  tipo: z.enum(["PF", "PJ"]),
  nome: z.string().trim().min(2, "Informe o nome").max(200),
  nome_fantasia: z.string().trim().max(200).optional().or(z.literal("")),
  documento: z.string().trim().max(20).optional().or(z.literal("")),
  email: z
    .string()
    .trim()
    .email("E-mail inválido")
    .max(200)
    .optional()
    .or(z.literal("")),
  telefone: z.string().trim().max(30).optional().or(z.literal("")),
});

type Form = {
  tipo: PessoaTipo;
  nome: string;
  nome_fantasia: string;
  documento: string;
  inscricao_estadual: string;
  email: string;
  telefone: string;
  celular: string;
  cep: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  estado: string;
  observacoes: string;
  status: "ativo" | "inativo";
};

const empty: Form = {
  tipo: "PF",
  nome: "",
  nome_fantasia: "",
  documento: "",
  inscricao_estadual: "",
  email: "",
  telefone: "",
  celular: "",
  cep: "",
  logradouro: "",
  numero: "",
  complemento: "",
  bairro: "",
  cidade: "",
  estado: "",
  observacoes: "",
  status: "ativo",
};

type ClienteTab = "dados" | "endereco" | "extras";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  cliente?: Cliente | null;
  /** Quando true, mostra apenas dados essenciais e foca no fluxo rápido (PDV). */
  quickMode?: boolean;
  /** Pré-preenche o CPF/CNPJ ao abrir um novo cadastro (PF/PJ é inferido pelo nº de dígitos). */
  defaultDocumento?: string | null;
  /** Chamado após criar/editar com sucesso, com o cliente gravado. */
  onSaved?: (cliente: Cliente) => void;
}

function maskDoc(value: string, tipo: PessoaTipo) {
  const d = value.replace(/\D+/g, "").slice(0, tipo === "PF" ? 11 : 14);
  if (tipo === "PF") {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d)/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function maskPhone(value: string) {
  const d = value.replace(/\D+/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{4})(\d)/, "$1-$2");
  }
  return d.replace(/^(\d{2})(\d)/, "($1) $2").replace(/(\d{5})(\d)/, "$1-$2");
}

function maskCep(value: string) {
  return value
    .replace(/\D+/g, "")
    .slice(0, 8)
    .replace(/^(\d{5})(\d)/, "$1-$2");
}

function clienteToForm(cliente: Cliente): Form {
  return {
    tipo: cliente.tipo,
    nome: cliente.nome,
    nome_fantasia: cliente.nome_fantasia ?? "",
    documento: cliente.documento ? maskDoc(cliente.documento, cliente.tipo) : "",
    inscricao_estadual: cliente.inscricao_estadual ?? "",
    email: cliente.email ?? "",
    telefone: cliente.telefone ?? "",
    celular: cliente.celular ?? "",
    cep: cliente.cep ?? "",
    logradouro: cliente.logradouro ?? "",
    numero: cliente.numero ?? "",
    complemento: cliente.complemento ?? "",
    bairro: cliente.bairro ?? "",
    cidade: cliente.cidade ?? "",
    estado: cliente.estado ?? "",
    observacoes: cliente.observacoes ?? "",
    status: cliente.status,
  };
}

function newClienteForm(defaultDocumento?: string | null): Form {
  if (!defaultDocumento) return { ...empty };

  const digits = defaultDocumento.replace(/\D+/g, "");
  const tipo: PessoaTipo = digits.length > 11 ? "PJ" : "PF";
  return { ...empty, tipo, documento: maskDoc(digits, tipo) };
}

export function ClienteDialog({
  open,
  onOpenChange,
  cliente,
  quickMode,
  defaultDocumento,
  onSaved,
}: Props) {
  const isEdit = !!cliente;
  const create = useCreateCliente();
  const update = useUpdateCliente();
  const [form, setForm] = useState<Form>(empty);
  const [activeTab, setActiveTab] = useState<ClienteTab>("dados");
  const [docConflict, setDocConflict] = useState<string | null>(null);
  const [checkingDoc, setCheckingDoc] = useState(false);
  const wasOpenRef = useRef(false);
  const loadedClienteIdRef = useRef<string | null>(null);
  const isLoading = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      loadedClienteIdRef.current = null;
      setForm({ ...empty });
      setDocConflict(null);
      setCheckingDoc(false);
      setActiveTab("dados");
      return;
    }

    const openedNow = !wasOpenRef.current;
    const changedCliente = Boolean(cliente && loadedClienteIdRef.current !== cliente.id);

    if (openedNow || changedCliente) {
      const initialDocumento = openedNow ? defaultDocumento : null;
      setDocConflict(null);
      setCheckingDoc(false);
      setActiveTab("dados");
      setForm(cliente ? clienteToForm(cliente) : newClienteForm(initialDocumento));
      loadedClienteIdRef.current = cliente?.id ?? null;
    }

    wasOpenRef.current = true;
  }, [open, cliente, defaultDocumento]);

  function update_<K extends keyof Form>(k: K, v: Form[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function checkDoc(docMasked: string) {
    const digits = docMasked.replace(/\D+/g, "");
    if (!digits) {
      setDocConflict(null);
      return;
    }
    setCheckingDoc(true);
    try {
      const found = await checkDocumentoDuplicado(digits, cliente?.id);
      if (found) {
        setDocConflict(`Já existe um cliente com este documento: ${found.nome}`);
      } else {
        setDocConflict(null);
      }
    } catch {
      // silencioso — backend ainda valida
    } finally {
      setCheckingDoc(false);
    }
  }

  async function handleSave() {
    const parsed = schema.safeParse({
      tipo: form.tipo,
      nome: form.nome,
      nome_fantasia: form.nome_fantasia,
      documento: form.documento,
      email: form.email,
      telefone: form.telefone,
    });
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message ?? "Dados inválidos");
      return;
    }
    if (docConflict) {
      toast.error(docConflict);
      return;
    }
    const payload: ClienteInput = {
      tipo: form.tipo,
      nome: form.nome,
      nome_fantasia: form.nome_fantasia,
      documento: form.documento,
      inscricao_estadual: form.inscricao_estadual,
      email: form.email,
      telefone: form.telefone,
      celular: form.celular,
      cep: form.cep,
      logradouro: form.logradouro,
      numero: form.numero,
      complemento: form.complemento,
      bairro: form.bairro,
      cidade: form.cidade,
      estado: form.estado,
      observacoes: form.observacoes,
      status: form.status,
    };

    try {
      const saved = isEdit
        ? await update.mutateAsync({ ...payload, id: cliente!.id })
        : await create.mutateAsync(payload);
      onSaved?.(saved);
      onOpenChange(false);
    } catch {
      // toast já feito nos hooks
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Editar cliente" : "Novo cliente"}</DialogTitle>
          <DialogDescription>
            {quickMode
              ? "Cadastro rápido para usar agora na venda."
              : "Cadastre dados completos do cliente para histórico, fidelidade e cobrança."}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as ClienteTab)}>
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="dados">Dados</TabsTrigger>
            <TabsTrigger value="endereco">Endereço</TabsTrigger>
            <TabsTrigger value="extras">Extras</TabsTrigger>
          </TabsList>

          <TabsContent value="dados" className="space-y-3 pt-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Tipo</Label>
                <Select
                  value={form.tipo}
                  onValueChange={(v) => {
                    update_("tipo", v as PessoaTipo);
                    update_("documento", "");
                    setDocConflict(null);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PF">Pessoa Física (CPF)</SelectItem>
                    <SelectItem value="PJ">Pessoa Jurídica (CNPJ)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) =>
                    update_("status", v as "ativo" | "inativo")
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ativo">Ativo</SelectItem>
                    <SelectItem value="inativo">Inativo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>{form.tipo === "PF" ? "Nome completo *" : "Razão social *"}</Label>
              <Input
                value={form.nome}
                onChange={(e) => update_("nome", e.target.value)}
                placeholder={form.tipo === "PF" ? "Maria Silva" : "Empresa Exemplo LTDA"}
                autoFocus
              />
            </div>

            <div>
              <Label>
                {form.tipo === "PF" ? "Nome social / apelido" : "Nome fantasia"}
              </Label>
              <Input
                value={form.nome_fantasia}
                onChange={(e) => update_("nome_fantasia", e.target.value)}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>{form.tipo === "PF" ? "CPF" : "CNPJ"}</Label>
                <Input
                  value={form.documento}
                  onChange={(e) => {
                    const v = maskDoc(e.target.value, form.tipo);
                    update_("documento", v);
                    setDocConflict(null);
                  }}
                  onBlur={(e) => checkDoc(e.target.value)}
                  placeholder={form.tipo === "PF" ? "000.000.000-00" : "00.000.000/0000-00"}
                  className={docConflict ? "border-destructive focus-visible:ring-destructive" : ""}
                />
                {checkingDoc && (
                  <p className="mt-1 text-xs text-muted-foreground">Verificando duplicidade…</p>
                )}
                {docConflict && (
                  <p className="mt-1 text-xs text-destructive">{docConflict}</p>
                )}
              </div>
              <div>
                <Label>Inscrição estadual</Label>
                <Input
                  value={form.inscricao_estadual}
                  onChange={(e) => update_("inscricao_estadual", e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Telefone</Label>
                <Input
                  value={form.telefone}
                  onChange={(e) => update_("telefone", maskPhone(e.target.value))}
                  placeholder="(11) 1234-5678"
                />
              </div>
              <div>
                <Label>Celular</Label>
                <Input
                  value={form.celular}
                  onChange={(e) => update_("celular", maskPhone(e.target.value))}
                  placeholder="(11) 91234-5678"
                />
              </div>
            </div>

            <div>
              <Label>E-mail</Label>
              <Input
                type="email"
                value={form.email}
                onChange={(e) => update_("email", e.target.value)}
                placeholder="cliente@exemplo.com"
              />
            </div>
          </TabsContent>

          <TabsContent value="endereco" className="space-y-3 pt-3">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>CEP</Label>
                <Input
                  value={form.cep}
                  onChange={(e) => update_("cep", maskCep(e.target.value))}
                  placeholder="00000-000"
                />
              </div>
              <div className="col-span-2">
                <Label>Logradouro</Label>
                <Input
                  value={form.logradouro}
                  onChange={(e) => update_("logradouro", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label>Número</Label>
                <Input
                  value={form.numero}
                  onChange={(e) => update_("numero", e.target.value)}
                />
              </div>
              <div>
                <Label>Complemento</Label>
                <Input
                  value={form.complemento}
                  onChange={(e) => update_("complemento", e.target.value)}
                />
              </div>
              <div>
                <Label>Bairro</Label>
                <Input
                  value={form.bairro}
                  onChange={(e) => update_("bairro", e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-[1fr_120px] gap-3">
              <div>
                <Label>Cidade</Label>
                <Input
                  value={form.cidade}
                  onChange={(e) => update_("cidade", e.target.value)}
                />
              </div>
              <div>
                <Label>Estado</Label>
                <Input
                  value={form.estado}
                  onChange={(e) => update_("estado", e.target.value.toUpperCase().slice(0, 2))}
                  maxLength={2}
                  placeholder="UF"
                />
              </div>
            </div>
          </TabsContent>

          <TabsContent value="extras" className="space-y-3 pt-3">
            <div>
              <Label>Observações internas</Label>
              <Textarea
                value={form.observacoes}
                onChange={(e) => update_("observacoes", e.target.value)}
                rows={5}
                placeholder="Forma de pagamento preferida, restrições, anotações…"
              />
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
            Cancelar
          </Button>
          <Button onClick={handleSave} disabled={isLoading || !!docConflict}>
            {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
            {isEdit ? "Salvar alterações" : "Cadastrar cliente"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
