import { createFileRoute, Navigate, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useState } from "react";
import type { User as SupabaseUser } from "@supabase/supabase-js";
import { z } from "zod";
import { zodValidator } from "@tanstack/zod-adapter";
import {
  Sparkles,
  LayoutDashboard,
  BarChart3,
  Building2,
  MousePointerClick,
  ShieldCheck,
  Headphones,
  Eye,
  EyeOff,
  Mail,
  Lock,
  User,
  Loader2,
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
import {
  saveDesktopAuthorizedUser,
  verifyDesktopAuthorizedUser,
} from "@/integrations/desktop/tauriBridge";
import { isDesktop } from "@/integrations/data/mode";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  redirect: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: zodValidator(searchSchema),
  head: () => ({
    meta: [
      { title: "Entrar — Gestão Pro" },
      {
        name: "description",
        content:
          "Acesse o Gestão Pro — ERP empresarial completo para vendas, compras, estoque, financeiro e relatórios.",
      },
    ],
  }),
  component: AuthPage,
});

const features = [
  {
    icon: LayoutDashboard,
    title: "Gestão completa",
    desc: "Controle de vendas, compras, estoque e financeiro em um só lugar.",
  },
  {
    icon: BarChart3,
    title: "Relatórios inteligentes",
    desc: "Dashboards e relatórios para tomada de decisão em tempo real.",
  },
  {
    icon: Building2,
    title: "Multiempresa",
    desc: "Gerencie múltiplas empresas com separação total de dados.",
  },
  {
    icon: MousePointerClick,
    title: "Fácil de usar",
    desc: "Interface moderna, intuitiva e pensada para agilidade.",
  },
  {
    icon: ShieldCheck,
    title: "Acesso seguro",
    desc: "Dados protegidos, criptografados e com auditoria completa.",
  },
  {
    icon: Headphones,
    title: "Suporte dedicado",
    desc: "Atendimento rápido sempre que você precisar.",
  },
];

const stats = [
  { value: "+10.000", label: "empresas atendidas" },
  { value: "+100.000", label: "usuários ativos" },
  { value: "99,9%", label: "uptime garantido" },
  { value: "24/7", label: "suporte disponível" },
];

function AuthPage() {
  const auth = useAuth();
  const { user, loading } = auth;
  const { redirect } = Route.useSearch();

  // Após login, sempre passamos pelo /hub para o usuário escolher entre
  // ERP e PDV. Só respeitamos `redirect` se for explicitamente para o /pos
  // (caso o operador tenha sido redirecionado de uma rota do PDV).
  const destino = redirect && redirect.startsWith("/pos") ? redirect : "/hub";

  if (loading) return null;
  if (user) return <Navigate to={destino} />;

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-[oklch(0.14_0.04_265)] text-white">
      {/* Ambient background */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -top-40 -left-32 h-[480px] w-[480px] rounded-full bg-[oklch(0.55_0.22_280)] opacity-30 blur-[120px]" />
        <div className="absolute top-1/3 -right-40 h-[520px] w-[520px] rounded-full bg-[oklch(0.55_0.22_240)] opacity-30 blur-[140px]" />
        <div className="absolute bottom-0 left-1/3 h-[400px] w-[400px] rounded-full bg-[oklch(0.5_0.2_300)] opacity-20 blur-[120px]" />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              "linear-gradient(to right, white 1px, transparent 1px), linear-gradient(to bottom, white 1px, transparent 1px)",
            backgroundSize: "44px 44px",
          }}
        />
      </div>

      <div className="grid min-h-screen w-full lg:grid-cols-2">
        {/* LEFT — institutional */}
        <aside className="relative hidden flex-col justify-between p-10 xl:p-14 lg:flex">
          <div className="animate-in fade-in slide-in-from-left-4 duration-700">
            <div className="flex items-center gap-3">
              <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-[oklch(0.7_0.2_275)] to-[oklch(0.55_0.22_245)] shadow-lg shadow-[oklch(0.55_0.22_270)]/40">
                <Sparkles className="h-6 w-6 text-white" />
                <span className="absolute inset-0 rounded-2xl ring-1 ring-inset ring-white/20" />
              </div>
              <div>
                <h1 className="text-xl font-bold tracking-tight">Gestão Pro</h1>
                <p className="text-xs uppercase tracking-[0.2em] text-white/50">
                  ERP Empresarial
                </p>
              </div>
            </div>

            <h2 className="mt-12 max-w-xl text-4xl font-bold leading-[1.1] tracking-tight xl:text-5xl">
              Sua empresa,{" "}
              <span className="bg-gradient-to-r from-[oklch(0.78_0.18_290)] via-[oklch(0.7_0.2_270)] to-[oklch(0.7_0.18_240)] bg-clip-text text-transparent">
                organizada e no controle.
              </span>
            </h2>
            <p className="mt-5 max-w-lg text-base text-white/65 leading-relaxed">
              O Gestão Pro reúne tudo que sua empresa precisa em um único
              sistema: vendas, compras, estoque, financeiro e relatórios.
            </p>
          </div>

          {/* Features */}
          <div className="mt-10 grid grid-cols-1 gap-4 xl:grid-cols-2 animate-in fade-in slide-in-from-left-4 duration-700 delay-100">
            {features.map((f) => (
              <div
                key={f.title}
                className="group flex gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-3.5 backdrop-blur-sm transition-all hover:border-white/15 hover:bg-white/[0.06]"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-[oklch(0.65_0.2_275)]/25 to-[oklch(0.55_0.22_245)]/25 ring-1 ring-inset ring-white/10">
                  <f.icon className="h-4.5 w-4.5 text-[oklch(0.82_0.14_280)]" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white">{f.title}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-white/55">
                    {f.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Stats */}
          <div className="mt-10 grid grid-cols-4 gap-3 animate-in fade-in slide-in-from-left-4 duration-700 delay-200">
            {stats.map((s) => (
              <div
                key={s.label}
                className="rounded-xl border border-white/8 bg-white/[0.03] p-3 backdrop-blur-sm"
              >
                <p className="text-lg font-bold tracking-tight text-white xl:text-xl">
                  {s.value}
                </p>
                <p className="mt-0.5 text-[11px] leading-tight text-white/50">
                  {s.label}
                </p>
              </div>
            ))}
          </div>

          <p className="mt-8 text-xs text-white/40">
            © {new Date().getFullYear()} Gestão Pro · Todos os direitos
            reservados
          </p>
        </aside>

        {/* RIGHT — login card */}
        <section className="flex items-center justify-center p-5 sm:p-8 lg:p-10">
          <div className="w-full max-w-md animate-in fade-in slide-in-from-right-4 duration-500">
            {/* Mobile logo */}
            <div className="mb-6 flex items-center justify-center gap-2.5 lg:hidden">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-[oklch(0.7_0.2_275)] to-[oklch(0.55_0.22_245)] shadow-lg">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">Gestão Pro</h1>
                <p className="text-[10px] uppercase tracking-[0.2em] text-white/50">
                  ERP Empresarial
                </p>
              </div>
            </div>

            <div className="relative rounded-2xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/40 backdrop-blur-xl sm:p-8">
              {/* Card glow */}
              <div className="pointer-events-none absolute inset-x-12 -top-px h-px bg-gradient-to-r from-transparent via-white/40 to-transparent" />

              <Tabs defaultValue="signin" className="w-full">
                <TabsList className="grid w-full grid-cols-2 bg-white/5 p-1">
                  <TabsTrigger
                    value="signin"
                    className="data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow text-white/60"
                  >
                    Entrar
                  </TabsTrigger>
                  <TabsTrigger
                    value="signup"
                    className="data-[state=active]:bg-white/10 data-[state=active]:text-white data-[state=active]:shadow text-white/60"
                  >
                    Criar conta
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="signin" className="mt-6">
                  <SignInForm redirect={destino} />
                </TabsContent>
                <TabsContent value="signup" className="mt-6">
                  <SignUpForm redirect={destino} />
                </TabsContent>
              </Tabs>
            </div>

            <p className="mt-6 text-center text-xs text-white/45">
              Problemas para entrar?{" "}
              <span className="text-white/70">
                Fale com o administrador do sistema.
              </span>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------- Shared bits ---------- */

function GoogleButton({ onClick, busy }: { onClick: () => void; busy: boolean }) {
  return (
    <Button
      type="button"
      onClick={onClick}
      disabled={busy}
      variant="outline"
      className="w-full border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="#EA4335"
            d="M12 10.2v3.9h5.5c-.24 1.4-1.66 4.1-5.5 4.1-3.31 0-6.01-2.74-6.01-6.12S8.69 5.96 12 5.96c1.88 0 3.14.8 3.86 1.49l2.63-2.54C16.94 3.4 14.7 2.4 12 2.4 6.86 2.4 2.7 6.56 2.7 11.7s4.16 9.3 9.3 9.3c5.37 0 8.93-3.77 8.93-9.08 0-.61-.07-1.08-.16-1.55H12z"
          />
        </svg>
      )}
      Entrar com Google
    </Button>
  );
}

function Divider({ label }: { label: string }) {
  return (
    <div className="relative flex items-center py-1">
      <span className="flex-1 h-px bg-white/10" />
      <span className="px-3 text-[11px] uppercase tracking-wider text-white/40">
        {label}
      </span>
      <span className="flex-1 h-px bg-white/10" />
    </div>
  );
}

const inputCls =
  "h-11 border-white/10 bg-white/5 text-white placeholder:text-white/35 focus-visible:border-white/30 focus-visible:ring-white/10";

/* ---------- Sign in ---------- */

const REMEMBER_LOGIN_KEY = "auth_remember_email";

function SignInForm({ redirect }: { redirect: string }) {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const auth = useAuth();

  // Nome aleatório do campo de senha + key do form a cada montagem.
  // Impede o navegador (Chrome, Edge, gerenciadores de senha) de salvar
  // ou auto-preencher a senha de login.
  const formInstanceId = useId();
  const [mountCount, setMountCount] = useState(0);
  const pwdFieldName = `login-pwd-${formInstanceId}-${mountCount}`;

  // Recupera SOMENTE o e-mail lembrado. A senha nunca é persistida.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(REMEMBER_LOGIN_KEY);
      if (saved) {
        setEmail(saved);
        setRemember(true);
      } else {
        setRemember(false);
      }
    } catch {
      /* noop */
    }
    setPassword("");
    setMountCount((n) => n + 1);
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
      toast.error("Login com Google indisponível no momento.");
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
    if (result.error) {
      if (isDesktop()) {
        const local = await verifyDesktopAuthorizedUser(email.trim(), password);
        if (local) {
          auth.signInOffline({
            id: local.user_id,
            email: email.trim(),
            aud: "authenticated",
            app_metadata: {},
            user_metadata: {},
            created_at: new Date().toISOString(),
          } as SupabaseUser);
          try {
            if (remember) {
              localStorage.setItem(REMEMBER_LOGIN_KEY, email.trim());
            } else {
              localStorage.removeItem(REMEMBER_LOGIN_KEY);
            }
          } catch {
            /* noop */
          }
          setPassword("");
          setBusy(false);
          toast.success("Bem-vindo de volta! (modo offline)");
          navigate({ to: redirect });
          return;
        }
      }
      setBusy(false);
      toast.error(
        result.error.message === "Invalid login credentials"
          ? "E-mail ou senha inválidos."
          : result.error.message,
      );
      return;
    }

    setBusy(false);
    // Lembra apenas o e-mail, se solicitado. Senha nunca é salva.
    try {
      if (remember) {
        localStorage.setItem(REMEMBER_LOGIN_KEY, email.trim());
      } else {
        localStorage.removeItem(REMEMBER_LOGIN_KEY);
      }
    } catch {
      /* noop */
    }
    const user = result.data?.user;
    if (user && isDesktop()) {
      saveDesktopAuthorizedUser(email.trim(), user.id, password).catch(() => {
        /* ignore local cache failures */
      });
    }
    setPassword("");
    toast.success("Bem-vindo de volta!");
    navigate({ to: redirect });
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold tracking-tight text-white">
          Bem-vindo de volta
        </h3>
        <p className="mt-1 text-sm text-white/55">
          Entre para acessar seu painel
        </p>
      </div>

      <GoogleButton onClick={onGoogle} busy={googleBusy} />
      <Divider label="ou continue com e-mail" />

      <form
        key={pwdFieldName}
        onSubmit={onSubmit}
        className="space-y-4"
        autoComplete="off"
        spellCheck={false}
      >
        {/* Campos-isca: o navegador preenche estes em vez do campo real,
            evitando que ofereça "salvar senha" para o login do ERP. */}
        <div
          aria-hidden="true"
          style={{
            position: "absolute",
            top: -9999,
            left: -9999,
            height: 0,
            width: 0,
            overflow: "hidden",
          }}
        >
          <input type="text" name="fakeuser" tabIndex={-1} autoComplete="username" />
          <input type="password" name="fakepassword" tabIndex={-1} autoComplete="new-password" />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signin-email" className="text-white/80">
            E-mail
          </Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <Input
              id="signin-email"
              type="email"
              required
              autoComplete="username"
              placeholder="voce@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(inputCls, "pl-10")}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="signin-password" className="text-white/80">
              Senha
            </Label>
            <button
              type="button"
              onClick={() =>
                toast.message(
                  "Solicite a redefinição de senha ao administrador.",
                )
              }
              className="text-xs text-[oklch(0.78_0.16_280)] hover:text-[oklch(0.85_0.14_280)] transition-colors"
            >
              Esqueci minha senha
            </button>
          </div>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <Input
              id="signin-password"
              /* nome dinâmico + autocomplete="new-password" impedem
                 o navegador de salvar/auto-preencher a senha */
              name={pwdFieldName}
              type={showPwd ? "text" : "password"}
              required
              autoComplete="new-password"
              data-lpignore="true"
              data-1p-ignore="true"
              data-bwignore="true"
              data-form-type="other"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(inputCls, "pl-10 pr-10")}
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
              aria-label={showPwd ? "Ocultar senha" : "Mostrar senha"}
              tabIndex={-1}
            >
              {showPwd ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
          <p className="text-[11px] text-white/45">
            Por segurança, a senha nunca é salva. Você precisa digitá-la a
            cada acesso.
          </p>
        </div>

        <label className="flex cursor-pointer items-center gap-2 text-sm text-white/65 select-none">
          <Checkbox
            checked={remember}
            onCheckedChange={(v) => setRemember(Boolean(v))}
            className="border-white/30 data-[state=checked]:bg-[oklch(0.6_0.2_270)] data-[state=checked]:border-[oklch(0.6_0.2_270)]"
          />
          Lembrar de mim
        </label>

        <Button
          type="submit"
          disabled={busy}
          className="w-full h-11 bg-gradient-to-r from-[oklch(0.62_0.22_275)] to-[oklch(0.55_0.22_245)] hover:opacity-95 text-white font-medium shadow-lg shadow-[oklch(0.55_0.22_270)]/30 border-0"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Entrando...
            </>
          ) : (
            "Entrar"
          )}
        </Button>
      </form>
    </div>
  );
}

/* ---------- Sign up ---------- */

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
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);

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
      toast.error("Cadastro com Google indisponível no momento.");
      setGoogleBusy(false);
    }
  }

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
          : error.message,
      );
      return;
    }
    toast.success("Conta criada! Bem-vindo ao Gestão Pro.");
    navigate({ to: redirect });
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-xl font-semibold tracking-tight text-white">
          Crie sua conta
        </h3>
        <p className="mt-1 text-sm text-white/55">
          Comece a organizar sua empresa em minutos
        </p>
      </div>

      <GoogleButton onClick={onGoogle} busy={googleBusy} />
      <Divider label="ou cadastre-se com e-mail" />

      <form onSubmit={onSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="signup-nome" className="text-white/80">
            Seu nome
          </Label>
          <div className="relative">
            <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <Input
              id="signup-nome"
              required
              placeholder="Nome completo"
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className={cn(inputCls, "pl-10")}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-email" className="text-white/80">
            E-mail
          </Label>
          <div className="relative">
            <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <Input
              id="signup-email"
              type="email"
              required
              autoComplete="email"
              placeholder="voce@empresa.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={cn(inputCls, "pl-10")}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="signup-password" className="text-white/80">
            Senha
          </Label>
          <div className="relative">
            <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/40" />
            <Input
              id="signup-password"
              type={showPwd ? "text" : "password"}
              required
              autoComplete="new-password"
              minLength={6}
              placeholder="Mínimo 6 caracteres"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={cn(inputCls, "pl-10 pr-10")}
            />
            <button
              type="button"
              onClick={() => setShowPwd((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70 transition-colors"
              aria-label={showPwd ? "Ocultar senha" : "Mostrar senha"}
            >
              {showPwd ? (
                <EyeOff className="h-4 w-4" />
              ) : (
                <Eye className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        <Button
          type="submit"
          disabled={busy}
          className="w-full h-11 bg-gradient-to-r from-[oklch(0.62_0.22_275)] to-[oklch(0.55_0.22_245)] hover:opacity-95 text-white font-medium shadow-lg shadow-[oklch(0.55_0.22_270)]/30 border-0"
        >
          {busy ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Criando conta...
            </>
          ) : (
            "Criar conta"
          )}
        </Button>

        <p className="text-center text-[11px] leading-relaxed text-white/45">
          Ao criar uma conta, você concorda com os termos de uso e política de
          privacidade do Gestão Pro.
        </p>
      </form>
    </div>
  );
}
