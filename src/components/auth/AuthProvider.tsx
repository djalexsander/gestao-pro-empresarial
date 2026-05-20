import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { dataClient } from "@/integrations/data";
import { registrarAuditLog } from "@/hooks/useAdmin";
import { lockErp } from "@/lib/erpUnlock";
import { withTimeout, TimeoutError } from "@/lib/withTimeout";
import { isDesktop } from "@/integrations/data/mode";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Boot local-first: no desktop NUNCA bloqueamos a UI esperando o Supabase.
// A sessão cacheada (Supabase mantém em localStorage) é restaurada em
// background. Os gates (RequireAuth) só redirecionam para /auth se realmente
// não houver usuário ao final. No web mantemos o comportamento clássico
// (loading=true) para evitar flicker antes de saber se está logado.
const DESKTOP_BOOT_LOCAL_FIRST = isDesktop();

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(!DESKTOP_BOOT_LOCAL_FIRST);
  const lastEventUserRef = useRef<string | null>(null);
  if (DESKTOP_BOOT_LOCAL_FIRST && typeof window !== "undefined") {
    // log único de boot
    (window as unknown as Record<string, unknown>).__gpBootLocalFirstLogged ||
      (console.log("[BOOT_LOCAL_FIRST] Desktop: render imediato, auth em background."),
      ((window as unknown as Record<string, unknown>).__gpBootLocalFirstLogged = true));
  }

  useEffect(() => {
    const subscription = dataClient.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);

      if (event === "SIGNED_IN" && sess?.user && lastEventUserRef.current !== sess.user.id) {
        lastEventUserRef.current = sess.user.id;
        dataClient.auth.garantirEmpresaAtual().then(() => {
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

    // Boot resiliente: nunca bloquear a UI esperando a rede.
    // Se a sessão demorar > 4s (offline / DNS travado), seguimos como
    // "sem sessão" e o RequireAuth/RequireErpUnlock decidem o caminho
    // (cache local no desktop, login no web).
    withTimeout(dataClient.auth.getSession(), 4000, "auth.getSession")
      .then(({ session: sess }) => {
        setSession(sess);
        setUser(sess?.user ?? null);
        if (sess?.user) lastEventUserRef.current = sess.user.id;
      })
      .catch((err) => {
        if (err instanceof TimeoutError) {
          console.warn("[AuthProvider] getSession timeout — seguindo sem sessão (modo offline?)");
        } else {
          console.warn("[AuthProvider] getSession falhou:", err);
        }
      })
      .finally(() => {
        setLoading(false);
      });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    const uid = user?.id;
    const email = user?.email;
    if (uid) {
      await registrarAuditLog("auth.logout", {
        target_type: "user", target_id: uid, metadata: { email },
      });
    }
    lockErp();
    await dataClient.auth.signOut();
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
