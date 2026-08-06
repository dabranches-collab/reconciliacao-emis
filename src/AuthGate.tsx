import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { LockKeyhole } from "lucide-react";
import { supabase } from "./lib/supabase";
import { logPlatformAccess } from "./lib/database";

type Identity = {
  name: string;
  email: string;
  role: "platform_owner" | "client_admin" | "analyst" | "auditor";
  isAdmin: boolean;
  isPlatformOwner: boolean;
  canManageUsers: boolean;
  canViewAudit: boolean;
  signOut: () => Promise<void>;
};
const demoIdentity: Identity = {
  name: "Diogo Abranches",
  email: "dabranches@gmail.com",
  role: "platform_owner",
  isAdmin: true,
  isPlatformOwner: true,
  canManageUsers: true,
  canViewAudit: true,
  signOut: async () => {},
};
const AuthContext = createContext<Identity>(demoIdentity);
export const useAuth = () => useContext(AuthContext);

export default function AuthGate({ children }: { children: ReactNode }) {
  const client = supabase;
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [identity, setIdentity] = useState<Identity>(demoIdentity);
  useEffect(() => {
    if (!client) return;
    const loadIdentity = async (nextSession: Session | null) => {
      setSession(nextSession);
      if (!nextSession) return;
      const { data: profile } = await client
        .from("profiles")
        .select("full_name,email,role,is_active")
        .eq("id", nextSession.user.id)
        .maybeSingle();
      if (profile && !profile.is_active) {
        await client.auth.signOut();
        setError("Esta conta encontra-se suspensa.");
        return;
      }
      const email = profile?.email ?? nextSession.user.email ?? "";
      const role =
        profile?.role ??
        (email.toLowerCase() === "dabranches@gmail.com"
          ? "platform_owner"
          : "analyst");
      const name =
        profile?.full_name ||
        nextSession.user.user_metadata.full_name ||
        (email.toLowerCase() === "dabranches@gmail.com"
          ? "Diogo Abranches"
          : email.split("@")[0]);
      const isPlatformOwner = role === "platform_owner",
        canManageUsers = isPlatformOwner || role === "client_admin";
      setIdentity({
        name,
        email,
        role,
        isAdmin: canManageUsers,
        isPlatformOwner,
        canManageUsers,
        canViewAudit: isPlatformOwner,
        signOut: async () => {
          await client.auth.signOut();
        },
      });
    };
    void client.auth.getSession().then(async ({ data }) => {
      await loadIdentity(data.session);
      setLoading(false);
    });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => {
      void loadIdentity(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  if (!client)
    return (
      <AuthContext.Provider value={demoIdentity}>
        {children}
      </AuthContext.Provider>
    );
  if (loading)
    return (
      <div className="auth-page">
        <p>A validar a sessão…</p>
      </div>
    );
  if (session)
    return (
      <AuthContext.Provider value={identity}>{children}</AuthContext.Provider>
    );
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) setError("Email ou password inválidos.");
    else await logPlatformAccess();
    setLoading(false);
  };
  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <img
          className="keve-logo auth-keve-logo"
          src="/keve-logo-purple.png"
          alt="Keve — O Banco que avança"
        />
        <div className="auth-logo">
          <LockKeyhole size={27} />
        </div>
        <p className="eyebrow">RECONCILIAÇÃO EMIS</p>
        <h1>Entrar na plataforma</h1>
        <p>Acesso reservado a utilizadores autorizados.</p>
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            autoComplete="current-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button className="primary-button" disabled={loading}>
          {loading ? "A entrar…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}
