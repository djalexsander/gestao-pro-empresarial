import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { dataClient } from "@/integrations/data";
import { registrarAuditLog } from "@/hooks/useAdmin";
import { lockErp } from "@/lib/erpUnlock";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const lastEventUserRef = useRef<string | null>(null);

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

    dataClient.auth.getSession().then(({ session: sess }) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      setLoading(false);
      if (sess?.user) lastEventUserRef.current = sess.user.id;
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
