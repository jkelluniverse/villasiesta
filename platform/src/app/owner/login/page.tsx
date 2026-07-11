'use client';
import { signIn } from 'next-auth/react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr('');
    const res = await signIn('credentials', { email, password, redirect: false });
    if (res?.error) { setErr('Wrong email or password.'); setBusy(false); return; }
    const cb = new URLSearchParams(window.location.search).get('callbackUrl');
    router.push(cb || '/owner');
    router.refresh();
  }

  return (
    <div className="op-login">
      <form className="box" onSubmit={submit}>
        <h1>Owners Portal</h1>
        <p>Sign in to manage Villa Siesta.</p>
        <label>Email</label>
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label>Password</label>
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {err ? <div className="err">{err}</div> : null}
        <button type="submit" className="op-btn op-btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}
