import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeftRight, Check, CircleDollarSign, LockKeyhole } from "lucide-react";
import { supabase } from "./lib/supabase";
import { logPlatformAccess } from "./lib/database";

type Identity = {
  name: string;
  email: string;
  role: "platform_owner" | "client_admin" | "analyst" | "auditor" | "demo";
  isDemo: boolean;
  isAdmin: boolean;
  isPlatformOwner: boolean;
  canManageUsers: boolean;
  canViewAudit: boolean;
  signOut: () => Promise<void>;
};
const demoIdentity = (signOut: () => Promise<void>): Identity => ({
  name: "Utilizador Demo",
  email: "demo@reconciliacao.local",
  role: "demo",
  isDemo: true,
  isAdmin: false,
  isPlatformOwner: false,
  canManageUsers: false,
  canViewAudit: false,
  signOut,
});
const emptyIdentity = demoIdentity(async () => {});
const AuthContext = createContext<Identity>(emptyIdentity);
export const useAuth = () => useContext(AuthContext);

export default function AuthGate({ children }: { children: ReactNode }) {
  const client = supabase;
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [usePassword, setUsePassword] = useState(false);
  const [error, setError] = useState("");
  const [identity, setIdentity] = useState<Identity>(emptyIdentity);
  const [demoMode, setDemoMode] = useState(false);
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
        isDemo: false,
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
      <AuthContext.Provider value={demoIdentity(async () => setDemoMode(false))}>
        {children}
      </AuthContext.Provider>
    );
  if (loading)
    return (
      <div className="auth-page">
        <p>A validar a sessão…</p>
      </div>
    );
  if (demoMode)
    return (
      <AuthContext.Provider value={demoIdentity(async () => setDemoMode(false))}>
        {children}
      </AuthContext.Provider>
    );
  if (session)
    return (
      <AuthContext.Provider value={identity}>{children}</AuthContext.Provider>
    );
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    if (usePassword) {
      const { error: signInError } = await client.auth.signInWithPassword({email,password});
      if (signInError) setError("Email ou palavra-passe inválidos.");
      else await logPlatformAccess();
    } else {
      const {data,error:invokeError}=await client.functions.invoke("pin-login",{body:{email,pin}});
      if(invokeError||data?.error||!data?.session)setError(String(data?.error??"Email ou PIN inválidos."));
      else {
        const {error:sessionError}=await client.auth.setSession({access_token:data.session.access_token,refresh_token:data.session.refresh_token});
        if(sessionError)setError("Não foi possível iniciar a sessão.");
      }
    }
    setLoading(false);
  };
  return (
    <div className="auth-page">
      <section className="auth-experience">
      <div className="auth-story" aria-hidden="true">
        <div className="auth-story-copy">
          <p className="eyebrow">RECONCILIAÇÃO EMIS · REAL TIME</p>
          <h2>Milhões de movimentos.<br/><span>Um saldo explicado.</span></h2>
          <p>Débitos e créditos percorrem um circuito auditável até se encontrarem, fecharem e deixarem visível apenas o que exige atenção.</p>
        </div>
        <div className="accounting-orbit">
          <div className="orbit-ring ring-one"/><div className="orbit-ring ring-two"/>
          <svg className="orbit-tokens" viewBox="0 0 340 250" aria-hidden="true">
            <g className="flow-token debit"><circle r="15"/><text textAnchor="middle" dominantBaseline="central">−</text><animateMotion dur="5s" repeatCount="indefinite" path="M170 0 A125 125 0 1 1 169.9 0"/></g>
            <g className="flow-token credit"><circle r="15"/><text textAnchor="middle" dominantBaseline="central">+</text><animateMotion dur="6.5s" repeatCount="indefinite" path="M340 125 A170 90 0 1 0 0 125 A170 90 0 1 0 340 125"/></g>
          </svg>
          <div className="orbit-centre"><ArrowLeftRight/><strong>0,00</strong><small>SALDO RECONCILIADO</small></div>
          <div className="ledger-chip chip-debit"><CircleDollarSign/><span>DÉBITO</span><strong>− 2 450 000</strong></div>
          <div className="ledger-chip chip-credit"><CircleDollarSign/><span>CRÉDITO</span><strong>+ 2 450 000</strong></div>
        </div>
        <div className="auth-proof"><span><Check/> IDTR validado</span><span><Check/> Saldo zero</span><span><Check/> Rastreabilidade integral</span></div>
      </div>
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
        {usePassword?<label>
          Palavra-passe
          <input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(e)=>setPassword(e.target.value)}/>
        </label>:<label>
          PIN de 4 algarismos
          <input className="pin-input" type="password" inputMode="numeric" autoComplete="current-password" required pattern="[0-9]{4}" maxLength={4} value={pin} onChange={(e)=>setPin(e.target.value.replace(/\D/g,'').slice(0,4))}/>
        </label>}
        {error && <div className="error">{error}</div>}
        <button className="primary-button" disabled={loading}>
          {loading ? "A entrar…" : "Entrar"}
        </button>
        <button type="button" className="auth-method-button" disabled={loading} onClick={()=>{setError("");setUsePassword(value=>!value);}}>
          {usePassword?"Entrar com PIN":"Entrar com palavra-passe"}
        </button>
        <button
          type="button"
          className="demo-login-button"
          disabled={loading}
          onClick={() => {
            setError("");
            setDemoMode(true);
          }}
        >
          Explorar demonstração
        </button>
        <small className="demo-login-note">
          Dados simulados · nenhuma alteração na base central
        </small>
      </form>
      </section>
    </div>
  );
}
