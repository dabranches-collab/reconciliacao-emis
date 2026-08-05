import { useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { LockKeyhole } from 'lucide-react';
import { supabase } from './lib/supabase';

export default function AuthGate({ children }: { children: ReactNode }) {
  const client = supabase;
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!client) return;
    void client.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);
  if (!client) return children;
  if (loading) return <div className="auth-page"><p>A validar a sessão…</p></div>;
  if (session) return children;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setError(''); setLoading(true);
    const { error: signInError } = await client.auth.signInWithPassword({ email, password });
    if (signInError) setError('Email ou password inválidos.');
    setLoading(false);
  };
  return <div className="auth-page"><form className="auth-card" onSubmit={(event) => void submit(event)}>
    <div className="auth-logo"><LockKeyhole size={27}/></div><p className="eyebrow">RECONCILIAÇÃO EMIS</p><h1>Entrar na plataforma</h1><p>Acesso reservado a utilizadores autorizados.</p>
    <label>Email<input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)}/></label>
    <label>Password<input type="password" autoComplete="current-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}/></label>
    {error && <div className="error">{error}</div>}<button className="primary-button" disabled={loading}>{loading ? 'A entrar…' : 'Entrar'}</button>
  </form></div>;
}
