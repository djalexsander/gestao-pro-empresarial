import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect, useMemo } from "react";
import { Settings2, CreditCard, Copy, Check, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  RadioGroup, RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  useConfigComercial, useSetConfigComercial, useAdminPlanos,
} from "@/hooks/useSaasAdmin";

export const Route = createFileRoute("/admin/config-comercial")({
  head: () => ({ meta: [{ title: "Configurações comerciais — Master" }] }),
  component: ConfigComercialPage,
});

function ConfigComercialPage() {
  const { data, isLoading } = useConfigComercial();
  const { data: planos = [] } = useAdminPlanos();
  const save = useSetConfigComercial();

  const [form, setForm] = useState({
    dias_trial: 7,
    permitir_modulos_no_trial: true,
    plano_padrao_id: "__none__",
    valor_padrao_sistema: 0,
    asaas_enabled: false,
    asaas_ambiente: "sandbox" as "sandbox" | "producao",
  });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (data) {
      setForm({
        dias_trial: data.dias_trial,
        permitir_modulos_no_trial: data.permitir_modulos_no_trial,
        plano_padrao_id: data.plano_padrao_id ?? "__none__",
        valor_padrao_sistema: Number(data.valor_padrao_sistema),
        asaas_enabled: data.asaas_enabled ?? false,
        asaas_ambiente: (data.asaas_ambiente ?? "sandbox") as "sandbox" | "producao",
      });
    }
  }, [data]);

  const webhookUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return `${window.location.origin}/api/public/webhooks/asaas`;
  }, []);

  const copyWebhook = async () => {
    try {
      await navigator.clipboard.writeText(webhookUrl);
      setCopied(true);
      toast.success("URL do webhook copiada");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Não foi possível copiar");
    }
  };

  const handleSave = () => {
    save.mutate({
      dias_trial: form.dias_trial,
      permitir_modulos_no_trial: form.permitir_modulos_no_trial,
      plano_padrao_id: form.plano_padrao_id === "__none__" ? null : form.plano_padrao_id,
      valor_padrao_sistema: form.valor_padrao_sistema,
      asaas_enabled: form.asaas_enabled,
      asaas_ambiente: form.asaas_ambiente,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações comerciais"
        description="Defaults aplicados a todas as novas empresas e integração de cobrança automática."
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Settings2 className="h-5 w-5" /> Trial e plano padrão
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Dias de trial</Label>
                  <Input type="number" min={0} value={form.dias_trial}
                    onChange={(e) => setForm({ ...form, dias_trial: Number(e.target.value) })} />
                  <p className="text-xs text-muted-foreground">
                    Quantos dias toda nova empresa ganha em modo trial.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Plano padrão</Label>
                  <Select value={form.plano_padrao_id}
                    onValueChange={(v) => setForm({ ...form, plano_padrao_id: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— nenhum —</SelectItem>
                      {planos.map((p) => <SelectItem key={p.id} value={p.id}>{p.nome}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Plano atribuído automaticamente no início do trial.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Valor padrão do sistema (R$)</Label>
                  <Input type="number" step="0.01" value={form.valor_padrao_sistema}
                    onChange={(e) => setForm({ ...form, valor_padrao_sistema: Number(e.target.value) })} />
                  <p className="text-xs text-muted-foreground">
                    Referência usada em telas de cobrança.
                  </p>
                </div>
              </div>

              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">Liberar módulos durante o trial</p>
                  <p className="text-sm text-muted-foreground">
                    Se ativado, todos os módulos ficam disponíveis durante o trial.
                  </p>
                </div>
                <Switch
                  checked={form.permitir_modulos_no_trial}
                  onCheckedChange={(c) => setForm({ ...form, permitir_modulos_no_trial: c })}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <CreditCard className="h-5 w-5" /> Cobrança automática (Asaas)
            {form.asaas_enabled && (
              <Badge variant={form.asaas_ambiente === "producao" ? "default" : "secondary"}>
                {form.asaas_ambiente === "producao" ? "Produção" : "Sandbox"}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">Ativar cobrança automática</p>
              <p className="text-sm text-muted-foreground">
                Quando ativo, o sistema poderá gerar e processar cobranças via Asaas.
              </p>
            </div>
            <Switch
              checked={form.asaas_enabled}
              onCheckedChange={(c) => setForm({ ...form, asaas_enabled: c })}
            />
          </div>

          <div className="space-y-2">
            <Label>Ambiente</Label>
            <RadioGroup
              value={form.asaas_ambiente}
              onValueChange={(v) => setForm({ ...form, asaas_ambiente: v as "sandbox" | "producao" })}
              className="flex flex-col gap-2 sm:flex-row sm:gap-6"
            >
              <label className="flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer flex-1">
                <RadioGroupItem value="sandbox" id="amb-sandbox" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Sandbox</p>
                  <p className="text-xs text-muted-foreground">
                    Ambiente de testes — não gera cobranças reais.
                  </p>
                </div>
              </label>
              <label className="flex items-center gap-2 rounded-md border px-3 py-2 cursor-pointer flex-1">
                <RadioGroupItem value="producao" id="amb-prod" />
                <div className="flex-1">
                  <p className="text-sm font-medium">Produção</p>
                  <p className="text-xs text-muted-foreground">
                    Cobranças reais com lançamentos efetivos.
                  </p>
                </div>
              </label>
            </RadioGroup>
          </div>

          <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
            <div>
              <p className="text-sm font-medium">Credenciais (segredos)</p>
              <p className="text-xs text-muted-foreground">
                Chaves armazenadas com segurança no servidor. Nunca expostas ao navegador.
              </p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">ASAAS_API_KEY</Label>
                <div className="flex items-center gap-2">
                  <Input value="••••••••••••••••" disabled />
                  <Badge variant="outline" className="shrink-0">Configurado</Badge>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">ASAAS_WEBHOOK_TOKEN</Label>
                <div className="flex items-center gap-2">
                  <Input value="••••••••••••••••" disabled />
                  <Badge variant="outline" className="shrink-0">Configurado</Badge>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Para alterar, use a área de Secrets do projeto (Lovable Cloud).
            </p>
          </div>

          <div className="space-y-2">
            <Label>Webhook URL (cole no painel da Asaas)</Label>
            <div className="flex items-center gap-2">
              <Input value={webhookUrl} readOnly className="font-mono text-xs" />
              <Button type="button" variant="outline" size="icon" onClick={copyWebhook}>
                {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </Button>
              <Button type="button" variant="outline" size="icon" asChild>
                <a href="https://www.asaas.com/customerWebhookConfigs/list" target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              No painel da Asaas, configure o token de acesso igual ao{" "}
              <code className="rounded bg-muted px-1">ASAAS_WEBHOOK_TOKEN</code>. O endpoint
              valida o header <code className="rounded bg-muted px-1">asaas-access-token</code>{" "}
              em todas as requisições.
            </p>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button disabled={save.isPending || isLoading} onClick={handleSave}>
          {save.isPending ? "Salvando…" : "Salvar configurações"}
        </Button>
      </div>
    </div>
  );
}
