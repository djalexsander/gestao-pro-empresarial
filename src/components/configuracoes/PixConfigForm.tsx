import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";

type PixProvider = "estatico" | "asaas" | "mercadopago" | "gerencianet" | "sicoob" | "banco_inter";

const PROVIDER_LABEL: Record<PixProvider, string> = {
  estatico: "Pix estático (QR Copia e Cola)",
  asaas: "Asaas",
  mercadopago: "Mercado Pago",
  gerencianet: "Efí (Gerencianet)",
  sicoob: "Sicoob",
  banco_inter: "Banco Inter",
};

interface Props {
  atual: any | null;
  onSalvar: (payload: any) => void;
  salvando: boolean;
}

export function PixConfigForm({ atual, onSalvar, salvando }: Props) {
  const cfg = atual?.configuracoes ?? {};

  const [ativo, setAtivo] = useState<boolean>(atual?.ativo ?? true);
  const [provider, setProvider] = useState<PixProvider>((cfg.provider ?? "estatico") as PixProvider);

  // Estático
  const [chave, setChave] = useState<string>(cfg.chave ?? "");
  const [tipoChave, setTipoChave] = useState<string>(cfg.tipo_chave ?? "cnpj");
  const [nomeRecebedor, setNomeRecebedor] = useState<string>(cfg.nome_recebedor ?? "");
  const [cidade, setCidade] = useState<string>(cfg.cidade ?? "");

  // Dinâmico (PSP)
  const [ambiente, setAmbiente] = useState<string>(cfg.ambiente ?? "sandbox");
  const [clientId, setClientId] = useState<string>(cfg.client_id ?? "");
  const [clientSecret, setClientSecret] = useState<string>(cfg.client_secret ?? "");
  const [accessToken, setAccessToken] = useState<string>(cfg.access_token ?? "");
  const [webhookUrl, setWebhookUrl] = useState<string>(cfg.webhook_url ?? "");
  const [contaCorrente, setContaCorrente] = useState<string>(cfg.conta_corrente ?? "");
  const [certificado, setCertificado] = useState<string>(cfg.certificado_nome ?? "");

  const handleSalvar = () => {
    if (provider === "estatico") {
      if (!chave || !nomeRecebedor || !cidade) {
        toast.error("Preencha chave, nome e cidade");
        return;
      }
      onSalvar({
        tipo_integracao: "pix",
        status: "connected",
        ativo,
        nome_exibicao: "PIX Cobrança",
        configuracoes: {
          provider: "estatico",
          chave, tipo_chave: tipoChave, nome_recebedor: nomeRecebedor, cidade,
        },
      });
      return;
    }

    onSalvar({
      tipo_integracao: "pix",
      status: clientId && clientSecret ? "configuring" : "disconnected",
      ativo,
      nome_exibicao: "PIX Cobrança",
      configuracoes: {
        provider,
        ambiente,
        client_id: clientId,
        client_secret: clientSecret,
        access_token: accessToken,
        webhook_url: webhookUrl,
        conta_corrente: contaCorrente,
        certificado_nome: certificado,
        chave, tipo_chave: tipoChave, nome_recebedor: nomeRecebedor, cidade,
      },
    });
  };

  const isDinamico = provider !== "estatico";

  return (
    <Tabs defaultValue="provedor" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="provedor">Provedor</TabsTrigger>
        <TabsTrigger value="recebedor">Dados do recebedor</TabsTrigger>
      </TabsList>

      <TabsContent value="provedor" className="space-y-3 pt-3">
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <p className="font-medium">Cobranças com Pix</p>
            <p className="text-xs text-muted-foreground">
              Gerar QR / copia-e-cola para contas a receber e fiado.
            </p>
          </div>
          <Switch checked={ativo} onCheckedChange={setAtivo} />
        </div>

        <div className="space-y-1.5">
          <Label>Provedor</Label>
          <Select value={provider} onValueChange={(v) => setProvider(v as PixProvider)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PROVIDER_LABEL) as PixProvider[]).map((p) => (
                <SelectItem key={p} value={p}>{PROVIDER_LABEL[p]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {provider === "estatico" && (
          <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            Modo estático: gera código Pix copia e cola sem integração bancária.
            Sem confirmação automática de pagamento — a baixa precisa ser manual.
          </div>
        )}

        {isDinamico && (
          <div className="space-y-3 rounded-md border p-3">
            <p className="text-sm font-medium">{PROVIDER_LABEL[provider]}</p>
            <div className="grid gap-3 sm:grid-cols-2">
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
              <div className="space-y-1.5">
                <Label>Conta corrente</Label>
                <Input value={contaCorrente} onChange={(e) => setContaCorrente(e.target.value)} placeholder="opcional" />
              </div>
              <div className="space-y-1.5">
                <Label>Client ID</Label>
                <Input value={clientId} onChange={(e) => setClientId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Client Secret</Label>
                <Input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Access Token (opcional)</Label>
              <Input type="password" value={accessToken} onChange={(e) => setAccessToken(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Webhook de confirmação</Label>
              <Input value={webhookUrl} onChange={(e) => setWebhookUrl(e.target.value)} placeholder="https://..." />
            </div>
            {(provider === "sicoob" || provider === "banco_inter" || provider === "gerencianet") && (
              <div className="space-y-1.5">
                <Label>Certificado (.p12 / .pem) — referência</Label>
                <Input value={certificado} onChange={(e) => setCertificado(e.target.value)} placeholder="nome do certificado armazenado" />
                <p className="text-[11px] text-muted-foreground">
                  O upload real do certificado precisa ser feito via secret seguro (será habilitado em breve).
                </p>
              </div>
            )}
          </div>
        )}
      </TabsContent>

      <TabsContent value="recebedor" className="space-y-3 pt-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Tipo da chave</Label>
            <Select value={tipoChave} onValueChange={setTipoChave}>
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
            <Input value={chave} onChange={(e) => setChave(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Nome do recebedor</Label>
            <Input value={nomeRecebedor} onChange={(e) => setNomeRecebedor(e.target.value)} maxLength={25} />
          </div>
          <div className="space-y-1.5">
            <Label>Cidade</Label>
            <Input value={cidade} onChange={(e) => setCidade(e.target.value)} maxLength={15} />
          </div>
        </div>
      </TabsContent>

      <Separator className="my-3" />
      <div className="flex justify-end">
        <Button onClick={handleSalvar} disabled={salvando}>
          {salvando ? "Salvando..." : "Salvar configurações"}
        </Button>
      </div>
    </Tabs>
  );
}
