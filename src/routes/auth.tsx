import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [{ title: "Entrar — Gestão Pro" }],
  }),
  component: AuthPage,
});

function AuthPage() {
  const { user, loading } = useAuth();
  const { redirect } = Route.useSearch();

  if (loading) return null;
  if (user) return <Navigate to={redirect ?? "/"} />;

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gradient-to-br from-background via-muted/30 to-background p-4">
      <div className="w-full max-w-md">
        <div className="mb-8 flex items-center justify-center gap-2.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-lg">
            <Sparkles className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Gestão Pro</h1>
            <p className="text-xs text-muted-foreground">ERP Empresarial</p>
          </div>
        </div>

        <Card className="border-border/60 shadow-xl">
          <CardContent className="p-6">
            <Tabs defaultValue="signin">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="signin">Entrar</TabsTrigger>
                <TabsTrigger value="signup">Criar conta</TabsTrigger>
              </TabsList>
              <TabsContent value="signin" className="mt-5">
                <SignInForm redirect={redirect ?? "/"} />
              </TabsContent>
              <TabsContent value="signup" className="mt-5">
                <SignUpForm redirect={redirect ?? "/"} />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function SignInForm({ redirect }: { redirect: string }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      toast.error(error.message === "Invalid login credentials"
        ? "E-mail ou senha inválidos."
        : error.message);
      return;
    }
    toast.success("Bem-vindo de volta!");
    navigate({ to: redirect });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="signin-email">E-mail</Label>
        <Input id="signin-email" type="email" required autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="signin-password">Senha</Label>
        <Input id="signin-password" type="password" required autoComplete="current-password"
          value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Entrando..." : "Entrar"}
      </Button>
    </form>
  );
}

const signupSchema = z.object({
  email: z.string().trim().email("E-mail inválido").max(255),
  password: z.string().min(6, "Mínimo 6 caracteres").max(72),
  nome: z.string().trim().min(2, "Informe seu nome").max(100),
});

function SignUpForm({ redirect }: { redirect: string }) {
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = signupSchema.safeParse({ nome, email, password });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0].message);
      return;
    }
    setBusy(true);
    const redirectUrl = `${window.location.origin}/`;
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: { nome },
      },
    });
    setBusy(false);
    if (error) {
      toast.error(
        error.message.includes("already registered")
          ? "Este e-mail já está cadastrado."
          : error.message
      );
      return;
    }
    toast.success("Conta criada! Verifique seu e-mail para confirmar.");
    navigate({ to: redirect });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="signup-nome">Seu nome</Label>
        <Input id="signup-nome" required value={nome} onChange={(e) => setNome(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="signup-email">E-mail</Label>
        <Input id="signup-email" type="email" required autoComplete="email"
          value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="signup-password">Senha</Label>
        <Input id="signup-password" type="password" required autoComplete="new-password" minLength={6}
          value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="text-xs text-muted-foreground">Mínimo de 6 caracteres.</p>
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Criando conta..." : "Criar conta"}
      </Button>
    </form>
  );
}
