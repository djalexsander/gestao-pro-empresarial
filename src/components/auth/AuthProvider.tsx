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

// Boot local-first: no desktop NUNCA bloqueamos a UI por mais que o necessário
// para hidratar a sessão Supabase do localStorage. Se NÃO houver token
// persistido, começamos com loading=false (não tem o que esperar). Se houver,
// aguardamos a hidratação com timeout curto (1.2s) — suficiente para o
// localStorage, longe dos 4s anteriores que travavam o boot offline.
const DESKTOP_BOOT_LOCAL_FIRST = isDesktop();

function hasPersistedSupabaseSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i) ?? "";
      // chaves típicas: "sb-<projectref>-auth-token", "supabase.auth.token"
      if (k.startsWith("sb-") && k.includes("auth-token")) return true;
      if (k === "supabase.auth.token") return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

const HAS_CACHED_SESSION = DESKTOP_BOOT_LOCAL_FIRST ? hasPersistedSupabaseSession() : true;
const AUTH_GETSESSION_TIMEOUT = DESKTOP_BOOT_LOCAL_FIRST ? 1200 : 4000;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // No desktop sem sessão cacheada, não há razão para mostrar spinner.
  const [loading, setLoading] = useState(
    DESKTOP_BOOT_LOCAL_FIRST ? HAS_CACHED_SESSION : true,
  );
  const lastEventUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (DESKTOP_BOOT_LOCAL_FIRST) {
      console.log(
        `[BOOT_LOCAL_FIRST] Desktop boot — cached session: ${HAS_CACHED_SESSION}, timeout: ${AUTH_GETSESSION_TIMEOUT}ms`,
      );
    }
  }, []);


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
    withTimeout(dataClient.auth.getSession(), AUTH_GETSESSION_TIMEOUT, "auth.getSession")
      .then(({ session: sess }) => {
        setSession(sess);
        setUser(sess?.user ?? null);
        if (sess?.user) lastEventUserRef.current = sess.user.id;
        if (DESKTOP_BOOT_LOCAL_FIRST) {
          console.log("[LOCAL_STATE_RESTORED] sessão Supabase hidratada.");
        }
      })
      .catch((err) => {
        if (err instanceof TimeoutError) {
          console.warn(
            DESKTOP_BOOT_LOCAL_FIRST
              ? "[BOOT_LOCAL_FIRST] getSession timeout — seguindo com dados locais."
              : "[AuthProvider] getSession timeout — seguindo sem sessão (modo offline?)",
          );
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
