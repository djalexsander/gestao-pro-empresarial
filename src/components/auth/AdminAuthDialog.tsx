import { useEffect, useId, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Lock, Loader2, Mail, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/components/auth/AuthProvider";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { unlockErp } from "@/lib/erpUnlock";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const REMEMBER_EMAIL_KEY = "erp_admin_remember_email";
const INTERNET_REQUIRED_MESSAGE =
  "Sem conexão com a internet. Este recurso exige conexão.";

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

export function AdminAuthDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);
  const formInstanceId = useId();
  const [openCount, setOpenCount] = useState(0);
  const pwdFieldName = `erp-pwd-${formInstanceId}-${openCount}`;
  const emailRef = useRef<HTMLInputElement | null>(null);
  const pwdRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    let remembered = "";
    try {
      remembered = localStorage.getItem(REMEMBER_EMAIL_KEY) ?? "";
    } catch {
      /* noop */
    }
    const initialEmail = user?.email ?? remembered;
    setEmail(initialEmail);
    setPassword("");
    setShowPwd(false);
    setOpenCount((n) => n + 1);
    // If email is already filled, focus password; otherwise focus email.
    setTimeout(() => {
      if (initialEmail && initialEmail.trim().length > 0) {
        pwdRef.current?.focus();
      } else {
        emailRef.current?.focus();
      }
    }, 0);
  }, [open, user?.email]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);

    try {
      let signInData: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["data"] | null = null;
      let signInError: Error | null = null;
      try {
        const result = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        signInData = result.data;
        signInError = result.error;
      } catch (err) {
        signInError = err as Error;
      }

      if (signInError || !signInData?.user) {
        toast.error(
          isNetworkAuthError(signInError)
            ? INTERNET_REQUIRED_MESSAGE
            : signInError?.message === "Invalid login credentials"
              ? "E-mail ou senha inválidos."
              : signInError?.message ?? "Não foi possível autenticar.",
        );
        return;
      }

      const authedUserId = signInData.user.id;
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", authedUserId);

      if (rolesError) {
        toast.error("Falha ao validar permissões.");
        return;
      }

      const roleList = (roles ?? []).map((r) => r.role as string);
      const hasErpAccess =
        roleList.length === 0 ||
        roleList.includes("super_admin") ||
        roleList.includes("admin") ||
        roleList.includes("gerente");

      if (!hasErpAccess || (roleList.includes("caixa") && !hasErpAccess)) {
        toast.error("Acesso negado. Esta conta não tem permissão para acessar o ERP.");
        return;
      }

      try {
        localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim());
      } catch {
        /* noop */
      }
      setPassword("");
      unlockErp(authedUserId);
      toast.success("Acesso autorizado.");
      onOpenChange(false);
      navigate({ to: "/" });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro inesperado ao autenticar.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <ShieldCheck className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle>Acesso ao ERP</DialogTitle>
          <DialogDescription>
            Por segurança, confirme suas credenciais administrativas para entrar
            no sistema. Apenas contas com perfil <strong>admin</strong> ou{" "}
            <strong>gerente</strong> podem acessar.
          </DialogDescription>
        </DialogHeader>

        <form
          key={pwdFieldName}
          onSubmit={onSubmit}
          className="space-y-4"
          autoComplete="off"
          spellCheck={false}
        >
          <div className="space-y-1.5">
            <Label htmlFor="admin-email">E-mail</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="admin-email"
                type="email"
                required
                autoComplete="username"
                placeholder="admin@empresa.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                ref={emailRef}
                className="pl-10"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Senha</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="admin-password"
                name={pwdFieldName}
                type={showPwd ? "text" : "password"}
                required
                autoComplete="new-password"
                placeholder="Sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                ref={pwdRef}
                className="pl-10 pr-10"
              />
              <button
                type="button"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPwd((v) => !v)}
                aria-label={showPwd ? "Ocultar senha" : "Mostrar senha"}
              >
                {showPwd ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Confirmar acesso
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
