import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2, XCircle, Loader2, Wifi, WifiOff, RefreshCw, Trash2, Copy,
  Plug, PlugZap, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";

type Tipo = "ifood" | "mercado_livre" | "shopee";

interface FieldDef {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
  hint?: string;
}

const TITULO: Record<Tipo, string> = {
  ifood: "iFood",
  mercado_livre: "Mercado Livre",
  shopee: "Shopee",
};

const DESCRICAO: Record<Tipo, string> = {
  ifood: "Importar pedidos, atualizar estoque e sincronizar vendas automaticamente.",
  mercado_livre: "Importar pedidos, produtos, clientes e sincronizar estoque e preços.",
  shopee: "Importar pedidos, sincronizar produtos, estoque e atualizar status de envio.",
};

const CAMPOS: Record<Tipo, FieldDef[]> = {
  ifood: [
    { key: "client_id", label: "Client ID", placeholder: "uuid do app no iFood" },
    { key: "client_secret", label: "Client Secret", secret: true },
    { key: "merchant_id", label: "Merchant ID / Store ID", placeholder: "id da loja no iFood" },
    { key: "codigo_loja", label: "Código da loja", placeholder: "código interno opcional" },
  ],
  mercado_livre: [
    { key: "app_id", label: "App ID", placeholder: "ID do aplicativo no ML" },
    { key: "client_secret", label: "Client Secret", secret: true },
    { key: "access_token", label: "Access Token", secret: true },
    { key: "refresh_token", label: "Refresh Token", secret: true },
    { key: "seller_id", label: "Seller ID", placeholder: "ID do vendedor" },
  ],
  shopee: [
    { key: "partner_id", label: "Partner ID" },
    { key: "partner_key", label: "Partner Key", secret: true },
    { key: "shop_id", label: "Shop ID" },
    { key: "access_token", label: "Access Token", secret: true },
    { key: "refresh_token", label: "Refresh Token", secret: true },
  ],
};

interface Props {
  tipo: Tipo;
  empresaId: string;
  atual: any | null;
  onSalvar: (payload: any) => void;
  salvando: boolean;
}

export function MarketplaceConfigForm({ tipo, empresaId, atual, onSalvar, salvando }: Props) {
  const cfg = atual?.configuracoes ?? {};

  const [ativo, setAtivo] = useState<boolean>(atual?.ativo ?? false);
  const [ambiente, setAmbiente] = useState<string>(cfg.ambiente ?? "sandbox");
  const [webhookUrl, setWebhookUrl] = useState<string>(cfg.webhook_url ?? "");
  const [campos, setCampos] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of CAMPOS[tipo]) init[f.key] = cfg[f.key] ?? "";
    return init;
  });

  const [testando, setTestando] = useState(false);
  const [sincronizando, setSincronizando] = useState(false);

  const status = atual?.status ?? "disconnected";
  const sync = cfg.sync ?? {};

  const camposPreenchidos = useMemo(
    () => CAMPOS[tipo].filter((f) => !f.secret || f.key === "client_secret" || f.key === "partner_key" || f.key === "client_secret")
      .every((f) => (campos[f.key] ?? "").trim().length > 0),
    [campos, tipo],
  );

  const setCampo = (k: string, v: string) => setCampos((p) => ({ ...p, [k]: v }));

  const buildPayload = (novoStatus?: string, syncPatch?: any) => ({
    tipo_integracao: tipo,
    status: novoStatus ?? status,
    ativo,
    nome_exibicao: TITULO[tipo],
    configuracoes: {
      ...cfg,
      ambiente,
      webhook_url: webhookUrl,
      ...campos,
      sync: { ...sync, ...syncPatch },
    },
  });

  const handleConectar = () => {
    if (!camposPreenchidos) {
      toast.error("Preencha as credenciais obrigatórias");
      return;
    }
    onSalvar(buildPayload("configuring"));
    toast.info("Credenciais salvas. Use 'Testar conexão' para validar.");
  };

  const handleTestar = async () => {
    if (!camposPreenchidos) {
      toast.error("Preencha as credenciais antes de testar");
      return;
    }
    setTestando(true);
    try {
      // Placeholder: integração real ocorrerá em Fase 2 via edge function
      await new Promise((r) => setTimeout(r, 800));
      onSalvar(buildPayload("connected", { ultimo_teste_em: new Date().toISOString() }));
      toast.success("Credenciais aceitas (modo simulado)");
    } catch (e: any) {
      onSalvar(buildPayload("error"));
      toast.error(e?.message ?? "Falha no teste");
    } finally {
      setTestando(false);
    }
  };

  const handleSincronizar = async () => {
    setSincronizando(true);
    try {
      await new Promise((r) => setTimeout(r, 600));
      onSalvar(buildPayload(status === "connected" ? "connected" : "configuring", {
        ultimo_sync_em: new Date().toISOString(),
        pedidos_importados: (sync.pedidos_importados ?? 0),
        erros: sync.erros ?? 0,
        fila: 0,
      }));
      toast.success("Fila de sincronização processada (simulado)");
    } finally {
      setSincronizando(false);
    }
  };

  const handleDesconectar = () => {
    if (!confirm("Desconectar a integração? Os tokens serão removidos.")) return;
    const limpos: Record<string, string> = {};
    for (const f of CAMPOS[tipo]) limpos[f.key] = "";
    setCampos(limpos);
    onSalvar({
      tipo_integracao: tipo,
      status: "disconnected",
      ativo: false,
      nome_exibicao: TITULO[tipo],
      configuracoes: { ambiente, webhook_url: webhookUrl, sync: {} },
    });
  };

  const handleRenovarToken = async () => {
    setTestando(true);
    try {
      await new Promise((r) => setTimeout(r, 600));
      toast.success("Renovação de token agendada (Fase 2 — backend OAuth)");
    } finally {
      setTestando(false);
    }
  };

  const handleLimparFila = () =>
    onSalvar(buildPayload(status, { fila: 0, ultimo_sync_em: new Date().toISOString() }));

  const handleReprocessar = () =>
    onSalvar(buildPayload(status, { erros: 0, fila: 0, ultimo_sync_em: new Date().toISOString() }));

  const copyWebhook = () => {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    toast.success("URL copiada");
  };

  return (
    <div className="space-y-4">
      {/* Status header */}
      <div className="flex items-center justify-between rounded-md border bg-muted/30 p-3">
        <div className="space-y-0.5">
          <p className="text-sm font-medium">{DESCRICAO[tipo]}</p>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <StatusBadge status={status} />
            <span>•</span>
            <span>Ambiente: {ambiente === "production" ? "Produção" : "Sandbox/Teste"}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={ativo} onCheckedChange={setAtivo} />
          <span className="text-xs">{ativo ? "Ativa" : "Inativa"}</span>
        </div>
      </div>

      <Tabs defaultValue="credenciais" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="credenciais">Credenciais</TabsTrigger>
          <TabsTrigger value="sincronizacao">Sincronização</TabsTrigger>
          <TabsTrigger value="webhook">Webhook</TabsTrigger>
        </TabsList>

        {/* Credenciais */}
        <TabsContent value="credenciais" className="space-y-3 pt-3">
          <div className="space-y-1.5">
            <Label>Ambiente</Label>
            <Select value={ambiente} onValueChange={setAmbiente}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="sandbox">Sandbox / Homologação</SelectItem>
                <SelectItem value="production">Produção</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Separator />

          <div className="grid gap-3 sm:grid-cols-2">
            {CAMPOS[tipo].map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label>{f.label}</Label>
                <Input
                  type={f.secret ? "password" : "text"}
                  value={campos[f.key]}
                  onChange={(e) => setCampo(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  autoComplete="off"
                />
                {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
              </div>
            ))}
          </div>

          <div className="rounded-md border bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
            <AlertTriangle className="mr-1 inline h-3.5 w-3.5" />
            Credenciais são salvas criptografadas no backend. Nunca compartilhe estes
            campos. A automação completa (importar pedidos / atualizar estoque) será
            ativada na Fase 2 via backend dedicado.
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleConectar} disabled={salvando} size="sm">
              <Plug className="mr-2 h-4 w-4" /> Salvar credenciais
            </Button>
            <Button onClick={handleTestar} disabled={testando || salvando} size="sm" variant="outline">
              {testando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <PlugZap className="mr-2 h-4 w-4" />}
              Testar conexão
            </Button>
            {(tipo === "mercado_livre" || tipo === "shopee") && (
              <Button onClick={handleRenovarToken} disabled={testando} size="sm" variant="outline">
                <RefreshCw className="mr-2 h-4 w-4" /> Renovar token
              </Button>
            )}
            {status !== "disconnected" && (
              <Button onClick={handleDesconectar} size="sm" variant="ghost" className="text-destructive">
                <Trash2 className="mr-2 h-4 w-4" /> Desconectar
              </Button>
            )}
          </div>
        </TabsContent>

        {/* Sincronização */}
        <TabsContent value="sincronizacao" className="space-y-3 pt-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <InfoCard label="Última sincronização" value={fmtData(sync.ultimo_sync_em)} />
            <InfoCard label="Pedidos importados" value={String(sync.pedidos_importados ?? 0)} />
            <InfoCard label="Erros" value={String(sync.erros ?? 0)} tone={sync.erros ? "danger" : "default"} />
            <InfoCard label="Fila pendente" value={String(sync.fila ?? 0)} />
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={handleSincronizar} disabled={sincronizando || status === "disconnected"} size="sm">
              {sincronizando ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
              Sincronizar agora
            </Button>
            <Button onClick={handleLimparFila} size="sm" variant="outline" disabled={status === "disconnected"}>
              Limpar fila
            </Button>
            <Button onClick={handleReprocessar} size="sm" variant="outline" disabled={status === "disconnected"}>
              Reprocessar falhas
            </Button>
          </div>

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            Logs detalhados (data/hora, ação, resposta da API e usuário) ficarão
            disponíveis em <strong>Auditoria → Integrações</strong> após a Fase 2.
          </div>
        </TabsContent>

        {/* Webhook */}
        <TabsContent value="webhook" className="space-y-3 pt-3">
          <div className="space-y-1.5">
            <Label>URL do Webhook</Label>
            <div className="flex gap-2">
              <Input
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder={`https://seu-dominio/api/public/webhooks/${tipo}`}
              />
              <Button type="button" variant="outline" size="icon" onClick={copyWebhook} title="Copiar URL">
                <Copy className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Cole esta URL no painel do {TITULO[tipo]} para receber eventos
              (novos pedidos, mudança de status, atualizações de estoque).
            </p>
          </div>

          <Separator />

          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground space-y-1">
            <p className="font-medium text-foreground">Como configurar:</p>
            <ol className="ml-4 list-decimal space-y-0.5">
              <li>Acesse o painel de desenvolvedor do {TITULO[tipo]}.</li>
              <li>Crie um aplicativo / token de integração.</li>
              <li>Copie as credenciais para a aba "Credenciais".</li>
              <li>Cadastre a URL do webhook acima no painel do provedor.</li>
              <li>Clique em "Testar conexão" para validar.</li>
            </ol>
          </div>

          <div className="flex justify-end">
            <Button onClick={() => onSalvar(buildPayload(status))} size="sm" disabled={salvando}>
              Salvar webhook
            </Button>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function fmtData(iso?: string) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("pt-BR"); } catch { return "—"; }
}

function StatusBadge({ status }: { status: string }) {
  if (status === "connected")
    return <Badge className="gap-1 bg-emerald-500 text-white hover:bg-emerald-600"><Wifi className="h-3 w-3" /> Conectado</Badge>;
  if (status === "configuring")
    return <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Aguardando autenticação</Badge>;
  if (status === "error")
    return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Erro de sincronização</Badge>;
  if (status === "token_invalid")
    return <Badge variant="destructive" className="gap-1"><XCircle className="h-3 w-3" /> Token inválido</Badge>;
  return <Badge variant="secondary" className="gap-1"><WifiOff className="h-3 w-3" /> Desconectado</Badge>;
}

function InfoCard({ label, value, tone }: { label: string; value: string; tone?: "default" | "danger" }) {
  return (
    <div className={`rounded-md border p-3 ${tone === "danger" ? "border-destructive/50" : ""}`}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-base font-semibold ${tone === "danger" ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
}
