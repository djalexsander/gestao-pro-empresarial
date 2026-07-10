import { createFileRoute, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, type ReactNode } from "react";
import { PageHeader } from "@/components/shared/PageHeader";
import { CloudDependencyNotice } from "@/components/shared/CloudDependencyNotice";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { SaveBar } from "@/components/configuracoes/SaveBar";
import { useTheme } from "@/components/theme/ThemeProvider";
import { EmpresaTab } from "@/components/configuracoes/EmpresaTab";
import { FuncionariosTab } from "@/components/configuracoes/FuncionariosTab";
import { TerminaisTab } from "@/components/configuracoes/TerminaisTab";
import { SociosTab } from "@/components/configuracoes/SociosTab";
import { PlanosModulosTab } from "@/components/configuracoes/PlanosModulosTab";
import { BalancaTab } from "@/components/configuracoes/BalancaTab";
import { AtualizacoesTab } from "@/components/configuracoes/AtualizacoesTab";
import { IntegracoesTab } from "@/components/configuracoes/IntegracoesTab";
import { ImpressoraConfigCard } from "@/components/configuracoes/ImpressoraConfigCard";

export const Route = createFileRoute("/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Gestão Pro" },
      { name: "description", content: "Configurações da empresa, usuários e preferências." },
    ],
  }),
  component: SettingsPage,
});

const TAB_VALUES = [
  "empresa",
  "planos",
  "socios",
  "funcionarios",
  "terminais",
  "balanca",
  "atualizacoes",
  "impressoras",
  "prefs",
  "integracoes",
] as const;

function SettingsPage() {
  const search = useSearch({ strict: false }) as { tab?: string };
  const tab = TAB_VALUES.includes(search.tab as (typeof TAB_VALUES)[number])
    ? (search.tab as string)
    : "empresa";

  return (
    <div className="space-y-6">
      <CloudDependencyNotice />
      <PageHeader
        title="Configurações"
        description="Personalize o sistema de acordo com sua operação."
      />

      <Tabs value={tab} className="space-y-4">
        <div className="min-w-0 flex-1">
          <KeepMountedTab value="empresa" active={tab}>
            <EmpresaTab />
          </KeepMountedTab>
          <KeepMountedTab value="planos" active={tab}>
            <PlanosModulosTab />
          </KeepMountedTab>
          <KeepMountedTab value="socios" active={tab}>
            <SociosTab />
          </KeepMountedTab>
          <KeepMountedTab value="funcionarios" active={tab}>
            <FuncionariosTab />
          </KeepMountedTab>
          <KeepMountedTab value="terminais" active={tab}>
            <TerminaisTab />
          </KeepMountedTab>
          <KeepMountedTab value="balanca" active={tab}>
            <BalancaTab />
          </KeepMountedTab>
          <KeepMountedTab value="atualizacoes" active={tab}>
            <AtualizacoesTab />
          </KeepMountedTab>
          <KeepMountedTab value="impressoras" active={tab}>
            <ImpressoraConfigCard />
          </KeepMountedTab>
          <KeepMountedTab value="prefs" active={tab}>
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>Preferências</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border border-border p-4">
                    <div>
                      <p className="font-medium">Notificações por e-mail</p>
                      <p className="text-sm text-muted-foreground">
                        Receba alertas sobre vendas e estoque.
                      </p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border border-border p-4">
                    <div>
                      <p className="font-medium">Alerta de estoque baixo</p>
                      <p className="text-sm text-muted-foreground">
                        Avise quando produtos atingirem o mínimo.
                      </p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <DarkModeSwitchRow />
                </CardContent>
              </Card>
              <SaveBar />
            </div>
          </KeepMountedTab>
          <KeepMountedTab value="integracoes" active={tab}>
            <IntegracoesTab />
          </KeepMountedTab>
        </div>
      </Tabs>
    </div>
  );
}

function KeepMountedTab({
  value,
  active,
  children,
}: {
  value: string;
  active: string;
  children: ReactNode;
}) {
  const visited = useRef(false);
  if (active === value) visited.current = true;
  useEffect(() => {
    if (active === value) visited.current = true;
  }, [active, value]);

  if (!visited.current) return null;
  return (
    <TabsContent value={value} forceMount className="mt-0 data-[state=inactive]:hidden">
      {children}
    </TabsContent>
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
