import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ShoppingBag, Store, Package, MessageCircle, QrCode, Settings, CheckCircle2, XCircle, Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useEmpresaAtual } from "@/hooks/useEmpresa";
import { useAuth } from "@/components/auth/AuthProvider";

type TipoIntegracao = "ifood" | "mercado_livre" | "shopee" | "whatsapp" | "pix";
type StatusIntegracao = "disconnected" | "configuring" | "connected" | "error" | "disabled";

interface Integracao {
  id: string;
  empresa_id: string;
  owner_id: string;
  tipo_integracao: TipoIntegracao;
  status: StatusIntegracao;
  nome_exibicao: string | null;
  configuracoes: Record<string, any>;
  ativo: boolean;
}

const TEMPLATE_WA_DEFAULT =
  "Olá {{cliente_nome}}, você possui uma cobrança em aberto no valor de R$ {{valor}}, com vencimento em {{vencimento}}. Para facilitar, segue o Pix copia e cola: {{pix_copia_cola}}";

const META: Record<TipoIntegracao, { titulo: string; descricao: string; Icon: typeof Store }> = {
  ifood: {
    titulo: "iFood",
    descricao: "Receber pedidos do iFood automaticamente no ERP.",
    Icon: ShoppingBag,
  },
  mercado_livre: {
    titulo: "Mercado Livre",
    descricao: "Importar vendas online, produtos e pedidos do Mercado Livre.",
    Icon: Store,
  },
  shopee: {
    titulo: "Shopee",
    descricao: "Receber vendas da Shopee automaticamente e atualizar estoque.",
    Icon: Package,
  },
  whatsapp: {
    titulo: "WhatsApp Cobranças",
    descricao: "Enviar mensagens automáticas para clientes com fiado em aberto.",
    Icon: MessageCircle,
  },
  pix: {
    titulo: "PIX Cobrança",
    descricao: "Gerar código Pix copia e cola para cobranças de fiado e contas a receber.",
    Icon: QrCode,
  },
};

const ORDEM: TipoIntegracao[] = ["ifood", "mercado_livre", "shopee", "whatsapp", "pix"];

export function IntegracoesTab() {
  const { empresaAtual } = useEmpresaAtual();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [editando, setEditando] = useState<TipoIntegracao | null>(null);

  const { data: integracoes = [], isLoading } = useQuery({
    queryKey: ["empresa_integracoes", empresaAtual?.id],
    enabled: !!empresaAtual?.id,
    queryFn: async (): Promise<Integracao[]> => {
      const { data, error } = await (supabase.from as any)("empresa_integracoes")
        .select("*")
        .eq("empresa_id", empresaAtual!.id);
      if (error) throw new Error(error.message);
      return (data ?? []) as Integracao[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (payload: Partial<Integracao> & { tipo_integracao: TipoIntegracao }) => {
      if (!empresaAtual || !user) throw new Error("Sem empresa ativa");
      const existente = integracoes.find((i) => i.tipo_integracao === payload.tipo_integracao);
      const row = {
        ...existente,
        ...payload,
        empresa_id: empresaAtual.id,
        owner_id: empresaAtual.owner_id,
      };
      const { error } = await (supabase.from as any)("empresa_integracoes").upsert(row, {
        onConflict: "empresa_id,tipo_integracao",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["empresa_integracoes"] });
      qc.invalidateQueries({ queryKey: ["integracao_pix"] });
      qc.invalidateQueries({ queryKey: ["integracao_whatsapp"] });
      toast.success("Integração atualizada");
      setEditando(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const integracaoEditando = useMemo(
    () => (editando ? integracoes.find((i) => i.tipo_integracao === editando) ?? null : null),
    [editando, integracoes],
  );

  if (!empresaAtual) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-muted-foreground">
          Selecione uma empresa para configurar integrações.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {ORDEM.map((tipo) => {
          const meta = META[tipo];
          const item = integracoes.find((i) => i.tipo_integracao === tipo);
          const status: StatusIntegracao = item?.status ?? "disconnected";
          return (
            <Card key={tipo} className="flex flex-col">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="rounded-md bg-primary/10 p-2 text-primary">
                      <meta.Icon className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-base">{meta.titulo}</CardTitle>
                  </div>
                  <StatusBadge status={status} />
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col justify-between gap-4">
                <p className="text-sm text-muted-foreground">{meta.descricao}</p>
                <Button variant="outline" size="sm" onClick={() => setEditando(tipo)} disabled={isLoading}>
                  <Settings className="mr-2 h-4 w-4" /> Configurar
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {editando && (
        <ConfigDialog
          tipo={editando}
          atual={integracaoEditando}
          open={!!editando}
          onOpenChange={(o) => !o && setEditando(null)}
          onSalvar={(payload) => upsert.mutate(payload)}
          salvando={upsert.isPending}
        />
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: StatusIntegracao }) {
  if (status === "connected")
    return (
      <Badge className="gap-1 bg-emerald-500 text-white hover:bg-emerald-600">
        <CheckCircle2 className="h-3 w-3" /> Conectado
      </Badge>
    );
  if (status === "configuring")
    return (
      <Badge variant="outline" className="gap-1">
        <Loader2 className="h-3 w-3 animate-spin" /> Em configuração
      </Badge>
    );
  if (status === "error")
    return (
      <Badge variant="destructive" className="gap-1">
        <XCircle className="h-3 w-3" /> Erro
      </Badge>
    );
  return <Badge variant="secondary">Desconectado</Badge>;
}

interface ConfigDialogProps {
  tipo: TipoIntegracao;
  atual: Integracao | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSalvar: (payload: Partial<Integracao> & { tipo_integracao: TipoIntegracao }) => void;
  salvando: boolean;
}

function ConfigDialog({ tipo, atual, open, onOpenChange, onSalvar, salvando }: ConfigDialogProps) {
  const meta = META[tipo];
  const cfg = atual?.configuracoes ?? {};

  // Pix
  const [pixChave, setPixChave] = useState<string>(cfg.chave ?? "");
  const [pixTipo, setPixTipo] = useState<string>(cfg.tipo_chave ?? "cnpj");
  const [pixNome, setPixNome] = useState<string>(cfg.nome_recebedor ?? "");
  const [pixCidade, setPixCidade] = useState<string>(cfg.cidade ?? "");

  // WhatsApp
  const [waAtivo, setWaAtivo] = useState<boolean>(atual?.ativo ?? false);
  const [waNumeroEmpresa, setWaNumeroEmpresa] = useState<string>(cfg.numero_empresa ?? "");
  const [waModoEnvio, setWaModoEnvio] = useState<string>(cfg.modo_envio ?? "manual");
  const [waTipoApi, setWaTipoApi] = useState<string>(cfg.tipo_api ?? "none");
  const [waDiasAntes, setWaDiasAntes] = useState<number>(cfg.dias_antes ?? 2);
  const [waDiasApos, setWaDiasApos] = useState<number>(cfg.dias_apos ?? 3);
  const [waMsgAntes, setWaMsgAntes] = useState<string>(cfg.msg_antes ?? TEMPLATE_WA_DEFAULT);
  const [waMsgVenc, setWaMsgVenc] = useState<string>(cfg.msg_vencimento ?? TEMPLATE_WA_DEFAULT);
  const [waMsgApos, setWaMsgApos] = useState<string>(cfg.msg_apos ?? TEMPLATE_WA_DEFAULT);

  // Marketplaces
  const [mktToken, setMktToken] = useState<string>(cfg.token ?? "");

  const handleSalvar = () => {
    if (tipo === "pix") {
      if (!pixChave || !pixNome || !pixCidade) {
        toast.error("Preencha chave, nome e cidade");
        return;
      }
      onSalvar({
        tipo_integracao: tipo,
        status: "connected",
        ativo: true,
        nome_exibicao: meta.titulo,
        configuracoes: { chave: pixChave, tipo_chave: pixTipo, nome_recebedor: pixNome, cidade: pixCidade },
      });
      return;
    }
    if (tipo === "whatsapp") {
      const numeroLimpo = waNumeroEmpresa.replace(/\D/g, "");
      if (waAtivo && !numeroLimpo) {
        toast.error("Informe o número de WhatsApp da empresa");
        return;
      }
      onSalvar({
        tipo_integracao: tipo,
        status: waAtivo ? "connected" : "disabled",
        ativo: waAtivo,
        nome_exibicao: meta.titulo,
        configuracoes: {
          numero_empresa: numeroLimpo,
          modo_envio: waModoEnvio,
          tipo_api: waTipoApi,
          dias_antes: waDiasAntes,
          dias_apos: waDiasApos,
          msg_antes: waMsgAntes,
          msg_vencimento: waMsgVenc,
          msg_apos: waMsgApos,
        },
      });
      return;
    }
    onSalvar({
      tipo_integracao: tipo,
      status: mktToken ? "configuring" : "disconnected",
      ativo: false,
      nome_exibicao: meta.titulo,
      configuracoes: { token: mktToken },
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <meta.Icon className="h-5 w-5" /> {meta.titulo}
          </DialogTitle>
          <DialogDescription>{meta.descricao}</DialogDescription>
        </DialogHeader>

        {tipo === "pix" && (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Tipo da chave</Label>
                <Select value={pixTipo} onValueChange={setPixTipo}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cpf">CPF</SelectItem>
                    <SelectItem value="cnpj">CNPJ</SelectItem>
                    <SelectItem value="email">E-mail</SelectItem>
                    <SelectItem value="telefone">Telefone</SelectItem>
                    <SelectItem value="aleatoria">Aleatória</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Chave Pix</Label>
                <Input value={pixChave} onChange={(e) => setPixChave(e.target.value)} placeholder="00.000.000/0000-00" />
              </div>
              <div className="space-y-1.5">
                <Label>Nome do recebedor</Label>
                <Input value={pixNome} onChange={(e) => setPixNome(e.target.value)} maxLength={25} />
              </div>
              <div className="space-y-1.5">
                <Label>Cidade</Label>
                <Input value={pixCidade} onChange={(e) => setPixCidade(e.target.value)} maxLength={15} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Estas informações são usadas para gerar o Pix copia e cola das contas a receber.
            </p>
          </div>
        )}

        {tipo === "whatsapp" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between rounded-md border p-3">
              <div>
                <p className="font-medium">Cobranças automáticas</p>
                <p className="text-xs text-muted-foreground">
                  Habilita o fluxo de cobrança via WhatsApp (envio manual nesta etapa).
                </p>
              </div>
              <Switch checked={waAtivo} onCheckedChange={setWaAtivo} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Dias antes do vencimento</Label>
                <Input type="number" min={0} max={30} value={waDiasAntes} onChange={(e) => setWaDiasAntes(Number(e.target.value))} />
              </div>
              <div className="space-y-1.5">
                <Label>Dias após vencimento (reenvio)</Label>
                <Input type="number" min={0} max={60} value={waDiasApos} onChange={(e) => setWaDiasApos(Number(e.target.value))} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Mensagem — antes do vencimento</Label>
              <Textarea rows={3} value={waMsgAntes} onChange={(e) => setWaMsgAntes(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Mensagem — no vencimento</Label>
              <Textarea rows={3} value={waMsgVenc} onChange={(e) => setWaMsgVenc(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Mensagem — após vencimento</Label>
              <Textarea rows={3} value={waMsgApos} onChange={(e) => setWaMsgApos(e.target.value)} />
            </div>
            <p className="text-xs text-muted-foreground">
              Variáveis suportadas: <code>{"{{cliente_nome}}"}</code>, <code>{"{{valor}}"}</code>,{" "}
              <code>{"{{vencimento}}"}</code>, <code>{"{{empresa_nome}}"}</code>,{" "}
              <code>{"{{pix_copia_cola}}"}</code>.
            </p>
          </div>
        )}

        {(tipo === "ifood" || tipo === "mercado_livre" || tipo === "shopee") && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
              A conexão oficial com {meta.titulo} será habilitada em breve. Você pode salvar um
              token/identificador para ativar a integração assim que disponível.
            </div>
            <div className="space-y-1.5">
              <Label>Token / Identificador</Label>
              <Input value={mktToken} onChange={(e) => setMktToken(e.target.value)} placeholder="opcional" />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSalvar} disabled={salvando}>
            {salvando ? "Salvando..." : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
