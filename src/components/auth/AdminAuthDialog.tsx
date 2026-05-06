import { useEffect, useId, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Eye, EyeOff, Lock, Loader2, ShieldCheck, Mail, Info } from "lucide-react";
import { toast } from "sonner";
import { dataClient } from "@/integrations/data";
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

/**
 * Dialog de reconfirmação para acesso ao ERP.
 *
 * Mesmo com sessão ativa, exige login + senha de um usuário
 * com role admin / gerente / super_admin. Operadores de caixa
 * são bloqueados.
 */
const REMEMBER_EMAIL_KEY = "erp_admin_remember_email";

export function AdminAuthDialog({ open, onOpenChange }: Props) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [busy, setBusy] = useState(false);

  // Nome aleatório do campo de senha + key do form a cada abertura.
  // Isso evita que o navegador faça autofill / salve a senha do ERP.
  const formInstanceId = useId();
  const [openCount, setOpenCount] = useState(0);
  const pwdFieldName = `erp-pwd-${formInstanceId}-${openCount}`;

  // Pré-preenche apenas o e-mail (sessão atual ou último lembrado).
  // A senha SEMPRE inicia vazia — nunca é persistida em lugar algum.
  useEffect(() => {
    if (open) {
      let remembered = "";
      try {
        remembered = localStorage.getItem(REMEMBER_EMAIL_KEY) ?? "";
      } catch {
        /* noop */
      }
      setEmail(user?.email ?? remembered ?? "");
      setPassword("");
      setShowPwd(false);
      setOpenCount((n) => n + 1);
    }
  }, [open, user?.email]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || !password) return;
    setBusy(true);

    try {
      // 1) Reautenticação obrigatória (não confia na sessão existente).
      const { user: authedUser, error: signInError } =
        await dataClient.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

      if (signInError || !authedUser) {
        toast.error(
          signInError?.message === "Invalid login credentials"
            ? "E-mail ou senha inválidos."
            : signInError?.message ?? "Não foi possível autenticar.",
        );
        setBusy(false);
        return;
      }

      const authedUserId = authedUser.id;

      // 2) Verifica papel: somente admin/gerente/super_admin entram no ERP.
      let roleList: string[] = [];
      try {
        roleList = await dataClient.userRoles.listar(authedUserId);
      } catch {
        toast.error("Falha ao validar permissões.");
        setBusy(false);
        return;
      }

      // (já populado acima)
      const hasErpAccess =
        roleList.length === 0 || // primeiro usuário (sem roles) é tratado como admin
        roleList.includes("super_admin") ||
        roleList.includes("admin") ||
        roleList.includes("gerente");

      const isCaixaOnly =
        roleList.includes("caixa") && !hasErpAccess;

      if (isCaixaOnly || !hasErpAccess) {
        toast.error(
          "Acesso negado. Esta conta não tem permissão para acessar o ERP.",
        );
        setBusy(false);
        return;
      }

      // 3) Libera acesso e navega para o ERP.
      // Lembra apenas o e-mail — NUNCA a senha.
      try {
        localStorage.setItem(REMEMBER_EMAIL_KEY, email.trim());
      } catch {
        /* noop */
      }
      // Garante que a senha digitada não permanece em memória após sucesso.
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
            Por segurança, confirme suas credenciais administrativas para
            entrar no sistema. Apenas contas com perfil <strong>admin</strong> ou{" "}
            <strong>gerente</strong> podem acessar.
          </DialogDescription>
        </DialogHeader>

        {/* key força React a remontar o form (e seus inputs) a cada abertura,
            o que descarta qualquer estado anterior e bloqueia autofill persistente */}
        <form
          key={pwdFieldName}
          onSubmit={onSubmit}
          className="space-y-4"
          autoComplete="off"
          spellCheck={false}
        >
          {/* Campos-isca: alguns navegadores ignoram autocomplete="off" se
              não houver um par usuário+senha "consumível" antes do campo real */}
          <div
            aria-hidden="true"
            style={{ position: "absolute", top: -9999, left: -9999, height: 0, width: 0, overflow: "hidden" }}
          >
            <input type="text" name="fakeuser" tabIndex={-1} autoComplete="username" />
            <input type="password" name="fakepassword" tabIndex={-1} autoComplete="new-password" />
          </div>

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
                className="pl-10"
                disabled={busy}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="admin-password">Senha</Label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="admin-password"
                /* nome dinâmico impede o navegador de associar essa senha
                   a um login salvo e a auto-preencher na próxima abertura */
                name={pwdFieldName}
                type={showPwd ? "text" : "password"}
                required
                autoComplete="new-password"
                data-lpignore="true"
                data-1p-ignore="true"
                data-bwignore="true"
                data-form-type="other"
                placeholder="Digite sua senha"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="pl-10 pr-10"
                disabled={busy}
                autoFocus
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
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
            <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
              <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Por segurança, a senha nunca é salva. Você precisa digitá-la
                a cada acesso ao ERP.
              </span>
            </p>
          </div>

          <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
              disabled={busy}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={busy || !email || !password}>
              {busy ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Autenticando...
                </>
              ) : (
                <>
                  <ShieldCheck className="h-4 w-4" /> Entrar no ERP
                </>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
