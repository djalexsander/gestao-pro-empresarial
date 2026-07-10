import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import {
  BarChart3,
  Building2,
  Eye,
  EyeOff,
  LayoutDashboard,
  Loader2,
  Lock,
  Mail,
  MousePointerClick,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
import { useAuth } from "@/components/auth/AuthProvider";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Entrar - Gestão Pro" },
      {
        name: "description",
        content:
          "Acesse o Gestão Pro para vendas, compras, estoque, financeiro e relatórios.",
      },
    ],
  }),
  component: AuthPage,
});

const REMEMBER_LOGIN_KEY = "auth_remember_email";
const INTERNET_REQUIRED_MESSAGE =
  "Sem conexão com a internet. Este recurso exige conexão.";
const WEAK_PASSWORD_MESSAGE =
  "Senha muito fraca ou comum. Utilize uma senha com letras maiúsculas, minúsculas, números e caracteres especiais.";

const features = [
  { icon: LayoutDashboard, title: "Gestão completa", desc: "Vendas, compras, estoque e financeiro em um só lugar." },
  { icon: BarChart3, title: "Relatórios inteligentes", desc: "Indicadores em tempo real para decisões melhores." },
  { icon: Building2, title: "Multiempresa", desc: "Dados separados por empresa, com controle de acesso." },
  { icon: ShieldCheck, title: "Acesso seguro", desc: "Autenticação Supabase e auditoria centralizada." },
  { icon: MousePointerClick, title: "Fácil de usar", desc: "Fluxos rápidos para balcão, gestão e análise." },
];

function isNetworkAuthError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message)
        : String(error ?? "");
  return (
    message === "Failed to fetch" ||
    message.includes("Failed to fetch") ||
    message.includes("NetworkError") ||
    message.includes("Load failed") ||
    message.includes("fetch failed")
  );
}

function getAuthErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error && "message" in error
        ? String((error as { message?: unknown }).message)
        : String(error ?? "");

  if (isNetworkAuthError(error)) return INTERNET_REQUIRED_MESSAGE;
  if (message.includes("Password is known to be weak and easy to guess")) {
    return WEAK_PASSWORD_MESSAGE;
  }

  return message || "Não foi possível concluir a autenticação.";
}

function AuthPage() {
  const { user, loading } = useAuth();
  const { redirect } = Route.useSearch();
  const destino = redirect && redirect.startsWith("/pos") ? redirect : "/hub";

  if (loading) return null;
  if (user) return <Navigate to={destino} />;

  return (
    <div className="grid min-h-screen bg-[oklch(0.14_0.04_265)] text-white lg:grid-cols-[1fr_480px]">
      <aside className="hidden flex-col justify-between p-12 lg:flex">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary">
              <Sparkles className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold">Gestão Pro</h1>
              <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                ERP Empresarial
              </p>
            </div>
          </div>
          <h2 className="mt-14 max-w-xl text-5xl font-bold leading-tight">
            Sua empresa organizada e no controle.
          </h2>
          <p className="mt-5 max-w-lg text-white/65">
            Acesse seus dados na nuvem com segurança para operar vendas,
            estoque, financeiro e relatórios.
          </p>
        </div>

        <div className="grid gap-3 xl:grid-cols-2">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-xl border border-white/10 bg-white/[0.04] p-4"
            >
              <feature.icon className="mb-3 h-5 w-5 text-primary" />
              <p className="font-semibold">{feature.title}</p>
              <p className="mt-1 text-sm text-white/55">{feature.desc}</p>
            </div>
          ))}
        </div>
      </aside>

      <main className="flex items-center justify-center p-5">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-8">
          <div className="mb-6 flex items-center justify-center gap-2 lg:hidden">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="font-bold">Gestão Pro</h1>
              <p className="text-[10px] uppercase tracking-[0.2em] text-white/50">
                ERP Empresarial
              </p>
            </div>
          </div>

          <Tabs defaultValue="signin">
            <TabsList className="grid w-full grid-cols-2 bg-white/5">
              <TabsTrigger value="signin">Entrar</TabsTrigger>
              <TabsTrigger value="signup">Criar conta</TabsTrigger>
            </TabsList>
            <TabsContent value="signin" className="mt-6">
              <SignInForm redirect={destino} />
            </TabsContent>
            <TabsContent value="signup" className="mt-6">
              <SignUpForm redirect={destino} />
            </TabsContent>
          </Tabs>
        </div>
      </main>
    </div>
  );
}

function GoogleButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={busy}
      variant="outline"
      className="w-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
      Entrar com Google
    </Button>
  );
}

function Divider() {
  return (
    <div className="flex items-center gap-3">
      <span className="h-px flex-1 bg-white/10" />
      <span className="text-[11px] uppercase tracking-wider text-white/40">
        ou continue com e-mail
      </span>
      <span className="h-px flex-1 bg-white/10" />
    </div>
  );
}

const inputCls =
  "h-11 border-white/10 bg-white/5 text-white placeholder:text-white/35 focus-visible:border-white/30 focus-visible:ring-white/10";

function SignInForm({ redirect }: { redirect: string }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const formInstanceId = useId();
  const pwdFieldName = `login-pwd-${formInstanceId}`;

  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_LOGIN_KEY);
      setEmail(saved ?? "");
      setRemember(Boolean(saved));
    } catch {
      setRemember(false);
    }
  }, []);

  async function onGoogle() {
    setGoogleBusy(true);
    try {
      const result = await lovable.auth.signInWithOAuth("google", {
        redirect_uri: window.location.origin,
      });
      if (result.error) {
        toast.error("Não foi possível entrar com Google.");
        setGoogleBusy(false);
        return;
      }
      if (result.redirected) return;
      navigate({ to: redirect });
    } catch {
      toast.error(INTERNET_REQUIRED_MESSAGE);
      setGoogleBusy(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    let result;
    try {
      result = await supabase.auth.signInWithPassword({ email, password });
    } catch (error) {
      result = { error: error as Error };
    }
    setBusy(false);

    if (result.error) {
      toast.error(
        result.error.message === "Invalid login credentials"
          ? "E-mail ou senha inválidos."
          : isNetworkAuthError(result.error)
            ? INTERNET_REQUIRED_MESSAGE
            : result.error.message,
      );
      return;
    }

    try {
      if (remember) localStorage.setItem(REMEMBER_LOGIN_KEY, email.trim());
      else localStorage.removeItem(REMEMBER_LOGIN_KEY);
    } catch {
      /* noop */
    }
    setPassword("");
    toast.success("Bem-vindo de volta!");
    navigate({ to: redirect });
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold">Bem-vindo de volta</h3>
        <p className="mt-1 text-sm text-white/55">Entre para acessar seu painel</p>
      </div>

      <GoogleButton onClick={onGoogle} busy={googleBusy} />
      <Divider />

      <form onSubmit={onSubmit} className="space-y-4" autoComplete="off">
        <AuthInput
          id="signin-email"
          label="E-mail"
          type="email"
          icon="mail"
          value={email}
          onChange={setEmail}
          autoComplete="username"
        />
        <PasswordInput
          id="signin-password"
          name={pwdFieldName}
          value={password}
          show={showPwd}
          onChange={setPassword}
          onToggle={() => setShowPwd((v) => !v)}
        />
        <label className="flex items-center gap-2 text-sm text-white/65">
          <Checkbox
            checked={remember}
            onCheckedChange={(checked) => setRemember(checked === true)}
          />
          Lembrar e-mail
        </label>
        <Button type="submit" className="h-11 w-full" disabled={busy}>
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Entrar
        </Button>
      </form>
    </div>
  );
}

function SignUpForm({ redirect }: { redirect: string }) {
  const navigate = useNavigate();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { nome } },
      });
      if (error) {
        toast.error(getAuthErrorMessage(error));
        return;
      }
      if (data.user) {
        toast.success("Conta criada com sucesso!");
        navigate({ to: redirect });
      }
    } catch {
      toast.error(INTERNET_REQUIRED_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" autoComplete="off">
      <AuthInput
        id="signup-name"
        label="Nome"
        type="text"
        icon="user"
        value={nome}
        onChange={setNome}
        autoComplete="name"
      />
      <AuthInput
        id="signup-email"
        label="E-mail"
        type="email"
        icon="mail"
        value={email}
        onChange={setEmail}
        autoComplete="username"
      />
      <PasswordInput
        id="signup-password"
        name="signup-password"
        value={password}
        show={showPwd}
        onChange={setPassword}
        onToggle={() => setShowPwd((v) => !v)}
      />
      <Button type="submit" className="h-11 w-full" disabled={busy}>
        {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Criar conta
      </Button>
    </form>
  );
}

function AuthInput({
  id,
  label,
  type,
  icon,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  type: string;
  icon: "mail" | "user";
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  const Icon = icon === "mail" ? Mail : Sparkles;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
        <Input
          id={id}
          type={type}
          required
          value={value}
          autoComplete={autoComplete}
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputCls, "pl-10")}
        />
      </div>
    </div>
  );
}

function PasswordInput({
  id,
  name,
  value,
  show,
  onChange,
  onToggle,
}: {
  id: string;
  name: string;
  value: string;
  show: boolean;
  onChange: (value: string) => void;
  onToggle: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>Senha</Label>
      <div className="relative">
        <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/35" />
        <Input
          id={id}
          name={name}
          type={show ? "text" : "password"}
          required
          value={value}
          autoComplete="new-password"
          onChange={(e) => onChange(e.target.value)}
          className={cn(inputCls, "pl-10 pr-10")}
        />
        <button
          type="button"
          onClick={onToggle}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-white/45 hover:text-white"
          aria-label={show ? "Ocultar senha" : "Mostrar senha"}
        >
          {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
