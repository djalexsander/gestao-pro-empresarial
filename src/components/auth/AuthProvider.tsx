import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { registrarAuditLog } from "@/hooks/useAdmin";
import { lockErp } from "@/lib/erpUnlock";
import { markBootStep } from "@/lib/desktopErrorLogger";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  markBootStep("authentication-provider-mounted");
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const lastEventUserRef = useRef<string | null>(null);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);

      if (event === "SIGNED_IN" && sess?.user && lastEventUserRef.current !== sess.user.id) {
        lastEventUserRef.current = sess.user.id;
        supabase.rpc("garantir_empresa_atual").then(() => {
          registrarAuditLog("auth.login", {
            target_type: "user",
            target_id: sess.user.id,
            metadata: { email: sess.user.email },
          });
        });
      }

      if (event === "SIGNED_OUT") {
        lastEventUserRef.current = null;
      }
    });

    let alive = true;
    supabase.auth
      .getSession()
      .then(({ data: { session: sess } }) => {
        if (!alive) return;
        setSession(sess);
        setUser(sess?.user ?? null);
        lastEventUserRef.current = sess?.user?.id ?? null;
      })
      .catch(() => {
        if (!alive) return;
        setSession(null);
        setUser(null);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  const signOut = async () => {
    const uid = user?.id;
    const email = user?.email;
    if (uid) {
      await registrarAuditLog("auth.logout", {
        target_type: "user",
        target_id: uid,
        metadata: { email },
      }).catch(() => {
        /* auditoria nao deve bloquear logout */
      });
    }
    lockErp();
    await supabase.auth.signOut().catch(() => {
      /* logout depende de conexao, mas estado local da sessao sera atualizado pelo cliente */
    });
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
