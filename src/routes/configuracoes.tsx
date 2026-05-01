import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/shared/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTheme } from "@/components/theme/ThemeProvider";
import { EmpresaTab } from "@/components/configuracoes/EmpresaTab";
import { FuncionariosTab } from "@/components/configuracoes/FuncionariosTab";
import { TerminaisTab } from "@/components/configuracoes/TerminaisTab";
import { SociosTab } from "@/components/configuracoes/SociosTab";
import { PlanosModulosTab } from "@/components/configuracoes/PlanosModulosTab";
import { BalancaTab } from "@/components/configuracoes/BalancaTab";
import { DesktopTab } from "@/components/configuracoes/DesktopTab";

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
          <TabsTrigger value="planos">Planos e módulos</TabsTrigger>
          <TabsTrigger value="socios">Sócios e Admins</TabsTrigger>
          <TabsTrigger value="funcionarios">Funcionários</TabsTrigger>
          <TabsTrigger value="terminais">Terminais</TabsTrigger>
          <TabsTrigger value="balanca">Balança</TabsTrigger>
          <TabsTrigger value="desktop">Desktop</TabsTrigger>
          <TabsTrigger value="prefs">Preferências</TabsTrigger>
          <TabsTrigger value="integracoes">Integrações</TabsTrigger>
        </TabsList>

        <TabsContent value="empresa" className="mt-4">
          <EmpresaTab />
        </TabsContent>

        <TabsContent value="planos" className="mt-4">
          <PlanosModulosTab />
        </TabsContent>

        <TabsContent value="socios" className="mt-4">
          <SociosTab />
        </TabsContent>

        <TabsContent value="funcionarios" className="mt-4">
          <FuncionariosTab />
        </TabsContent>

        <TabsContent value="terminais" className="mt-4">
          <TerminaisTab />
        </TabsContent>

        <TabsContent value="balanca" className="mt-4">
          <BalancaTab />
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

