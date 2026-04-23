import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useTheme } from "@/components/theme/ThemeProvider";
import { FuncionariosTab } from "@/components/configuracoes/FuncionariosTab";
import { TerminaisTab } from "@/components/configuracoes/TerminaisTab";
import { useResetarDadosEmpresa } from "@/hooks/useSaasCliente";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Gestão Pro" },
      { name: "description", content: "Configurações da empresa, usuários e preferências." },
    ],
  }),
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Configurações"
        description="Personalize o sistema de acordo com sua operação."
      />

      <Tabs defaultValue="empresa">
        <TabsList>
          <TabsTrigger value="empresa">Empresa</TabsTrigger>
          <TabsTrigger value="funcionarios">Funcionários</TabsTrigger>
          <TabsTrigger value="terminais">Terminais</TabsTrigger>
          <TabsTrigger value="prefs">Preferências</TabsTrigger>
          <TabsTrigger value="integracoes">Integrações</TabsTrigger>
          <TabsTrigger value="perigo" className="text-destructive data-[state=active]:text-destructive">
            Zona de Perigo
          </TabsTrigger>
        </TabsList>

        <TabsContent value="empresa" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Dados da empresa</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="razao">Razão social</Label>
                <Input id="razao" defaultValue="Minha Empresa Ltda" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cnpj">CNPJ</Label>
                <Input id="cnpj" defaultValue="00.000.000/0001-00" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail comercial</Label>
                <Input id="email" type="email" defaultValue="contato@empresa.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tel">Telefone</Label>
                <Input id="tel" defaultValue="(11) 0000-0000" />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="end">Endereço</Label>
                <Input id="end" defaultValue="Av. Principal, 1000 - Centro - São Paulo/SP" />
              </div>
              <div className="md:col-span-2">
                <Button>Salvar alterações</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="funcionarios" className="mt-4">
          <FuncionariosTab />
        </TabsContent>

        <TabsContent value="terminais" className="mt-4">
          <TerminaisTab />
        </TabsContent>

        <TabsContent value="prefs" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Preferências</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <p className="font-medium">Notificações por e-mail</p>
                  <p className="text-sm text-muted-foreground">Receba alertas sobre vendas e estoque.</p>
                </div>
                <Switch defaultChecked />
              </div>
              <div className="flex items-center justify-between rounded-lg border border-border p-4">
                <div>
                  <p className="font-medium">Alerta de estoque baixo</p>
                  <p className="text-sm text-muted-foreground">Avise quando produtos atingirem o mínimo.</p>
                </div>
                <Switch defaultChecked />
              </div>
              <DarkModeSwitchRow />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="integracoes" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Integrações disponíveis</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">Conecte gateways de pagamento, NFe e marketplaces em breve.</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="perigo" className="mt-4">
          <ZonaPerigoTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function DarkModeSwitchRow() {
  const { resolvedTheme, setTheme } = useTheme();
  const isDark = resolvedTheme === "dark";
  return (
    <div className="flex items-center justify-between rounded-lg border border-border p-4">
      <div>
        <p className="font-medium">Tema escuro</p>
        <p className="text-sm text-muted-foreground">
          Use a interface em modo escuro. A preferência fica salva neste navegador.
        </p>
      </div>
      <Switch
        checked={isDark}
        onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
        aria-label="Alternar tema escuro"
      />
    </div>
  );
}

function ZonaPerigoTab() {
  const [confirm, setConfirm] = useState("");
  const reset = useResetarDadosEmpresa();
  const palavraConfirma = "ZERAR";

  return (
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-destructive">
          <AlertTriangle className="h-5 w-5" />
          Zerar todos os dados da empresa
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <p className="mb-2 font-medium text-destructive">
            Atenção: esta ação é irreversível!
          </p>
          <p className="text-muted-foreground">
            Serão apagados <strong>permanentemente</strong>: vendas, produtos,
            clientes, fornecedores, compras, caixa, financeiro, estoque,
            terminais e funcionários. Sua conta, empresa, plano e módulos
            permanecem intactos.
          </p>
          <p className="mt-2 text-muted-foreground">
            Use isto se quiser recomeçar com a base limpa após o período de
            testes.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm-reset">
            Para confirmar, digite{" "}
            <code className="rounded bg-muted px-1 font-mono text-xs">
              {palavraConfirma}
            </code>
            :
          </Label>
          <Input
            id="confirm-reset"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder={palavraConfirma}
            autoComplete="off"
          />
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="destructive"
              disabled={confirm !== palavraConfirma || reset.isPending}
            >
              {reset.isPending && (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              )}
              Zerar dados agora
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Tem certeza absoluta?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação não pode ser desfeita. Todos os dados operacionais da
                sua empresa serão apagados imediatamente.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  reset.mutate(undefined, {
                    onSuccess: () => setConfirm(""),
                  });
                }}
              >
                Sim, apagar tudo
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}
