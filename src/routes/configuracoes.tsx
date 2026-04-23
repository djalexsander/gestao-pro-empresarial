import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTheme } from "@/components/theme/ThemeProvider";
import { FuncionariosTab } from "@/components/configuracoes/FuncionariosTab";
import { TerminaisTab } from "@/components/configuracoes/TerminaisTab";

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

