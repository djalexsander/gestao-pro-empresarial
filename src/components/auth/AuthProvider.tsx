import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { registrarAuditLog } from "@/hooks/useAdmin";
import { lockErp } from "@/lib/erpUnlock";
import { isDesktop } from "@/integrations/data/mode";
import { getDesktopAuthorizedUserStatus } from "@/integrations/desktop/tauriBridge";

const OFFLINE_USER_STORAGE_KEY = "gp.auth.offline_user.v1";

type StoredOfflineUser = {
  id?: unknown;
  email?: unknown;
};

function devAuthLog(message: string, meta?: unknown) {
  if (import.meta.env.DEV) {
    console.info(`[auth-offline] ${message}`, meta ?? "");
  }
}

function readStoredOfflineUser(): Pick<User, "id" | "email"> | null {
  try {
    const raw = window.localStorage.getItem(OFFLINE_USER_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredOfflineUser;
    const id = typeof parsed.id === "string" ? parsed.id.trim() : "";
    const email = typeof parsed.email === "string" ? parsed.email.trim() : "";
    if (!id || !email) return null;
    return { id, email };
  } catch {
    return null;
  }
}

function toOfflineSupabaseUser(stored: Pick<User, "id" | "email">): User {
  return {
    id: stored.id,
    email: stored.email ?? undefined,
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  } as User;
}

function persistOfflineUserPointer(user: User) {
  if (!isDesktop() || !user.email) return;
  try {
    window.localStorage.setItem(
      OFFLINE_USER_STORAGE_KEY,
      JSON.stringify({ id: user.id, email: user.email }),
    );
  } catch {
    /* noop */
  }
}

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
  signInOffline: (user: User) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [offlineUser, setOfflineUser] = useState<User | null>(null);
  const offlineUserRef = useRef<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const lastEventUserRef = useRef<string | null>(null);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? offlineUserRef.current ?? null);

      // Registra eventos de auditoria (apenas eventos significativos, evita duplicar)
      if (event === "SIGNED_IN" && sess?.user && lastEventUserRef.current !== sess.user.id) {
        lastEventUserRef.current = sess.user.id;
        persistOfflineUserPointer(sess.user);
        // garante registro de empresa do usuário no primeiro acesso
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
    supabase.auth.getSession().then(async ({ data: { session: sess } }) => {
      if (!alive) return;
      setSession(sess);
      if (sess?.user) {
        persistOfflineUserPointer(sess.user);
        setUser(sess.user);
        setLoading(false);
        lastEventUserRef.current = sess.user.id;
        return;
      }

      if (isDesktop()) {
        const stored = readStoredOfflineUser();
        if (stored?.email) {
          const status = await getDesktopAuthorizedUserStatus(stored.email);
          if (!alive) return;
          if (status.exists && status.user_id === stored.id) {
            const restored = toOfflineSupabaseUser(stored);
            offlineUserRef.current = restored;
            setOfflineUser(restored);
            setUser(restored);
            lastEventUserRef.current = restored.id;
            devAuthLog("sessao offline restaurada", { email: restored.email });
          } else {
            try {
              window.localStorage.removeItem(OFFLINE_USER_STORAGE_KEY);
            } catch {
              /* noop */
            }
            devAuthLog("sessao offline descartada: usuario nao autorizado", {
              email: stored.email,
              userId: stored.id,
            });
            setUser(null);
          }
          setLoading(false);
          return;
        }
      }

      setUser(offlineUserRef.current ?? null);
      setLoading(false);
    }).catch(async (err) => {
      if (!alive) return;
      devAuthLog("getSession falhou no boot", err);
      if (isDesktop()) {
        const stored = readStoredOfflineUser();
        if (stored?.email) {
          const status = await getDesktopAuthorizedUserStatus(stored.email);
          if (!alive) return;
          if (status.exists && status.user_id === stored.id) {
            const restored = toOfflineSupabaseUser(stored);
            offlineUserRef.current = restored;
            setOfflineUser(restored);
            setUser(restored);
            lastEventUserRef.current = restored.id;
            setLoading(false);
            devAuthLog("sessao offline restaurada apos falha do getSession", {
              email: restored.email,
            });
            return;
          }
        }
      }
      setUser(offlineUserRef.current ?? null);
      setLoading(false);
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
        target_type: "user", target_id: uid, metadata: { email },
      }).catch(() => {
        /* Ignore audit failures when offline */
      });
    }
    lockErp();
    setOfflineUser(null);
    offlineUserRef.current = null;
    try {
      window.localStorage.removeItem(OFFLINE_USER_STORAGE_KEY);
    } catch {
      /* noop */
    }
    await supabase.auth.signOut().catch(() => {
      /* Ignore logout failures when offline */
    });
  };

  const signInOffline = (offline: User) => {
    setOfflineUser(offline);
    offlineUserRef.current = offline;
    setUser(offline);
    setSession(null);
    lastEventUserRef.current = offline.id;
    try {
      persistOfflineUserPointer(offline);
    } catch {
      /* noop */
    }
  };

  useEffect(() => {
    if (!session && offlineUser) {
      setUser(offlineUser);
    }
  }, [offlineUser, session]);

  return (
    <AuthContext.Provider
      value={{ user, session, loading, signOut, signInOffline }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth deve ser usado dentro de <AuthProvider>");
  return ctx;
}
