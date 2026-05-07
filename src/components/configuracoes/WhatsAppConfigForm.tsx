import { useState, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, QrCode as QrIcon, Send, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";

const TEMPLATE_WA_DEFAULT =
  "Olá {{cliente_nome}}, você possui uma cobrança em aberto no valor de R$ {{valor}}, com vencimento em {{vencimento}}. Para facilitar, segue o Pix copia e cola: {{pix_copia_cola}}";

type Provider = "manual" | "evolution" | "zapi" | "meta_cloud";

const PROVIDER_LABEL: Record<Provider, string> = {
  manual: "Manual (wa.me)",
  evolution: "Evolution API",
  zapi: "Z-API",
  meta_cloud: "Meta WhatsApp Cloud API",
};

interface Props {
  empresaId: string;
  atual: any | null;
  onSalvar: (payload: any) => void;
  salvando: boolean;
}

export function WhatsAppConfigForm({ empresaId, atual, onSalvar, salvando }: Props) {
  const cfg = atual?.configuracoes ?? {};

  const [ativo, setAtivo] = useState<boolean>(atual?.ativo ?? false);
  const [provider, setProvider] = useState<Provider>((cfg.provider ?? cfg.tipo_api ?? "manual") as Provider);
  const [numeroEmpresa, setNumeroEmpresa] = useState<string>(cfg.numero_empresa ?? "");

  // Evolution
  const [evoUrl, setEvoUrl] = useState<string>(cfg.api_url ?? "");
  const [evoInstance, setEvoInstance] = useState<string>(cfg.instance ?? "");
  const [evoApiKey, setEvoApiKey] = useState<string>(cfg.api_key ?? "");

  // Z-API
  const [zapiInstance, setZapiInstance] = useState<string>(cfg.instance_id ?? "");
  const [zapiToken, setZapiToken] = useState<string>(cfg.token ?? "");
  const [zapiClientToken, setZapiClientToken] = useState<string>(cfg.client_token ?? "");

  // Meta Cloud
  const [metaPhoneId, setMetaPhoneId] = useState<string>(cfg.phone_number_id ?? "");
  const [metaToken, setMetaToken] = useState<string>(cfg.access_token ?? "");
  const [metaWabaId, setMetaWabaId] = useState<string>(cfg.waba_id ?? "");

  // Cobrança automática
  const [diasAntes, setDiasAntes] = useState<number>(cfg.dias_antes ?? 2);
  const [diasApos, setDiasApos] = useState<number>(cfg.dias_apos ?? 3);
  const [horarioInicio, setHorarioInicio] = useState<string>(cfg.horario_inicio ?? "09:00");
  const [horarioFim, setHorarioFim] = useState<string>(cfg.horario_fim ?? "18:00");
  const [msgAntes, setMsgAntes] = useState<string>(cfg.msg_antes ?? TEMPLATE_WA_DEFAULT);
  const [msgVenc, setMsgVenc] = useState<string>(cfg.msg_vencimento ?? TEMPLATE_WA_DEFAULT);
  const [msgApos, setMsgApos] = useState<string>(cfg.msg_apos ?? TEMPLATE_WA_DEFAULT);

  // QR / teste
  const [qrBase64, setQrBase64] = useState<string | null>(null);
  const [testTo, setTestTo] = useState<string>("");

  const status = atual?.status ?? "disconnected";
  const ultimoSync = atual?.ultimo_sync_at ? new Date(atual.ultimo_sync_at).toLocaleString("pt-BR") : "—";

  function buildConfig() {
    const numeroLimpo = numeroEmpresa.replace(/\D/g, "");
    const baseCfg: Record<string, any> = {
      provider,
      tipo_api: provider, // back-compat
      numero_empresa: numeroLimpo,
      modo_envio: provider === "manual" ? "manual" : "automatico",
      dias_antes: diasAntes,
      dias_apos: diasApos,
      horario_inicio: horarioInicio,
      horario_fim: horarioFim,
      msg_antes: msgAntes,
      msg_vencimento: msgVenc,
      msg_apos: msgApos,
    };
    if (provider === "evolution") {
      Object.assign(baseCfg, { api_url: evoUrl.trim(), instance: evoInstance.trim(), api_key: evoApiKey.trim() });
    } else if (provider === "zapi") {
      Object.assign(baseCfg, {
        instance_id: zapiInstance.trim(),
        token: zapiToken.trim(),
        client_token: zapiClientToken.trim(),
      });
    } else if (provider === "meta_cloud") {
      Object.assign(baseCfg, {
        phone_number_id: metaPhoneId.trim(),
        access_token: metaToken.trim(),
        waba_id: metaWabaId.trim(),
      });
    }
    return baseCfg;
  }

  const handleSalvar = () => {
    const numeroLimpo = numeroEmpresa.replace(/\D/g, "");
    if (ativo && provider === "manual" && !numeroLimpo) {
      toast.error("Informe o número de WhatsApp da empresa");
      return;
    }
    onSalvar({
      tipo_integracao: "whatsapp",
      status: ativo ? (provider === "manual" ? "configuring" : status === "connected" ? "connected" : "configuring") : "disabled",
      ativo,
      nome_exibicao: "WhatsApp Cobranças",
      configuracoes: buildConfig(),
    });
  };

  const callFn = async (action: "test_connection" | "get_qr" | "send_message", extra?: any) => {
    const { data, error } = await supabase.functions.invoke("whatsapp-provider", {
      body: { action, empresa_id: empresaId, ...extra },
    });
    if (error) throw new Error(error.message);
    return data;
  };

  const testConn = useMutation({
    mutationFn: () => callFn("test_connection"),
    onSuccess: (data: any) => {
      if (data?.ok) toast.success("Conexão OK!");
      else toast.error(data?.error ?? "Falha na conexão");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const getQr = useMutation({
    mutationFn: () => callFn("get_qr"),
    onSuccess: (data: any) => {
      if (data?.ok && data?.qr_base64) {
        const b64 = String(data.qr_base64);
        setQrBase64(b64.startsWith("data:") ? b64 : `data:image/png;base64,${b64}`);
        toast.success("QR Code gerado — escaneie no WhatsApp");
      } else {
        toast.error(data?.error ?? "QR não disponível");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendTest = useMutation({
    mutationFn: () => callFn("send_message", {
      to: testTo.replace(/\D/g, ""),
      message: `Teste de envio do ${PROVIDER_LABEL[provider]} — ${new Date().toLocaleString("pt-BR")}`,
    }),
    onSuccess: (data: any) => {
      if (data?.ok) toast.success("Mensagem enviada!");
      else toast.error(data?.error ?? "Falha no envio");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const requiresQr = provider === "evolution" || provider === "zapi";

  return (
    <Tabs defaultValue="conexao" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        <TabsTrigger value="conexao">Conexão</TabsTrigger>
        <TabsTrigger value="automacao">Automação</TabsTrigger>
        <TabsTrigger value="mensagens">Mensagens</TabsTrigger>
      </TabsList>

      <TabsContent value="conexao" className="space-y-3 pt-3">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="font-medium">Cobranças via WhatsApp</p>
            <p className="text-xs text-muted-foreground">Habilita envio de mensagens (manual ou automático).</p>
          </div>
          <Switch checked={ativo} onCheckedChange={setAtivo} />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Provedor</Label>
            <Select value={provider} onValueChange={(v) => { setProvider(v as Provider); setQrBase64(null); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual (wa.me)</SelectItem>
                <SelectItem value="evolution">Evolution API</SelectItem>
                <SelectItem value="zapi">Z-API</SelectItem>
                <SelectItem value="meta_cloud">Meta Cloud API (oficial)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Número da empresa</Label>
            <Input
              value={numeroEmpresa}
              onChange={(e) => setNumeroEmpresa(e.target.value)}
              placeholder="55 11 99999-9999"
              inputMode="tel"
            />
          </div>
        </div>

        {provider === "manual" && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-700 dark:text-amber-300">
            Modo manual: sem automação real. O sistema apenas abre o link <code>wa.me</code> no navegador do operador.
          </div>
        )}

        {provider === "evolution" && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">Evolution API</p>
            <div className="space-y-1.5">
              <Label>URL da API</Label>
              <Input value={evoUrl} onChange={(e) => setEvoUrl(e.target.value)} placeholder="https://evolution.suaempresa.com" />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Nome da instância</Label>
                <Input value={evoInstance} onChange={(e) => setEvoInstance(e.target.value)} placeholder="empresa-1" />
              </div>
              <div className="space-y-1.5">
                <Label>API Key</Label>
                <Input type="password" value={evoApiKey} onChange={(e) => setEvoApiKey(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {provider === "zapi" && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">Z-API</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Instance ID</Label>
                <Input value={zapiInstance} onChange={(e) => setZapiInstance(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Token da instância</Label>
                <Input type="password" value={zapiToken} onChange={(e) => setZapiToken(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Client-Token (segurança)</Label>
              <Input type="password" value={zapiClientToken} onChange={(e) => setZapiClientToken(e.target.value)} />
            </div>
          </div>
        )}

        {provider === "meta_cloud" && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">Meta WhatsApp Cloud API</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Phone Number ID</Label>
                <Input value={metaPhoneId} onChange={(e) => setMetaPhoneId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>WABA ID</Label>
                <Input value={metaWabaId} onChange={(e) => setMetaWabaId(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Access Token (permanente)</Label>
              <Input type="password" value={metaToken} onChange={(e) => setMetaToken(e.target.value)} />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Requer aprovação de templates na Meta Business para envio fora da janela de 24h.
            </p>
          </div>
        )}

        {provider !== "manual" && (
          <>
            <Separator />
            <div className="space-y-3 rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Status da conexão</p>
                  <p className="text-xs text-muted-foreground">Última sincronização: {ultimoSync}</p>
                </div>
                <StatusPill status={status} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => testConn.mutate()} disabled={testConn.isPending}>
                  {testConn.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
                  Testar conexão
                </Button>
                {requiresQr && (
                  <Button size="sm" variant="outline" onClick={() => getQr.mutate()} disabled={getQr.isPending}>
                    {getQr.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <QrIcon className="mr-2 h-4 w-4" />}
                    Conectar (QR Code)
                  </Button>
                )}
              </div>

              {qrBase64 && (
                <div className="flex flex-col items-center gap-2 rounded border bg-background p-3">
                  <img src={qrBase64} alt="QR Code WhatsApp" className="h-56 w-56" />
                  <p className="text-xs text-muted-foreground">Abra o WhatsApp → Aparelhos conectados → Conectar aparelho</p>
                </div>
              )}

              <Separator />
              <div className="space-y-1.5">
                <Label>Testar envio para número</Label>
                <div className="flex gap-2">
                  <Input
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    placeholder="55 11 99999-9999"
                    inputMode="tel"
                  />
                  <Button
                    size="sm"
                    onClick={() => sendTest.mutate()}
                    disabled={sendTest.isPending || !testTo}
                  >
                    {sendTest.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Send className="mr-2 h-4 w-4" />}
                    Enviar teste
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Salve as credenciais antes de testar.</p>
              </div>
            </div>
          </>
        )}
      </TabsContent>

      <TabsContent value="automacao" className="space-y-3 pt-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Dias antes do vencimento</Label>
            <Input type="number" min={0} max={30} value={diasAntes} onChange={(e) => setDiasAntes(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Dias após vencimento (reenvio)</Label>
            <Input type="number" min={0} max={60} value={diasApos} onChange={(e) => setDiasApos(Number(e.target.value))} />
          </div>
          <div className="space-y-1.5">
            <Label>Horário início de envio</Label>
            <Input type="time" value={horarioInicio} onChange={(e) => setHorarioInicio(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Horário fim de envio</Label>
            <Input type="time" value={horarioFim} onChange={(e) => setHorarioFim(e.target.value)} />
          </div>
        </div>
        <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
          O disparo automático respeita esse horário e evita envios duplicados (Fase 2 — agendamento via cron).
        </div>
      </TabsContent>

      <TabsContent value="mensagens" className="space-y-3 pt-3">
        <div className="space-y-1.5">
          <Label>Antes do vencimento</Label>
          <Textarea rows={3} value={msgAntes} onChange={(e) => setMsgAntes(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>No vencimento</Label>
          <Textarea rows={3} value={msgVenc} onChange={(e) => setMsgVenc(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Após vencimento</Label>
          <Textarea rows={3} value={msgApos} onChange={(e) => setMsgApos(e.target.value)} />
        </div>
        <p className="text-xs text-muted-foreground">
          Variáveis: <code>{"{{cliente_nome}}"}</code>, <code>{"{{valor}}"}</code>,{" "}
          <code>{"{{vencimento}}"}</code>, <code>{"{{empresa_nome}}"}</code>,{" "}
          <code>{"{{pix_copia_cola}}"}</code>.
        </p>
      </TabsContent>

      <div className="flex justify-end pt-4">
        <Button onClick={handleSalvar} disabled={salvando}>
          {salvando ? "Salvando..." : "Salvar configurações"}
        </Button>
      </div>
    </Tabs>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "connected")
    return <Badge className="gap-1 bg-emerald-500 text-white"><Wifi className="h-3 w-3" /> Conectado</Badge>;
  if (status === "configuring")
    return <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Aguardando QR</Badge>;
  if (status === "error")
    return <Badge variant="destructive" className="gap-1"><WifiOff className="h-3 w-3" /> Erro</Badge>;
  return <Badge variant="secondary" className="gap-1"><WifiOff className="h-3 w-3" /> Desconectado</Badge>;
}
