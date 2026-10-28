'use client';
import { FormEvent, useState } from 'react';
import { backend, useAuth } from '../auth';
import { Btn, ErrorNote, Field, msg, Note } from '../ui';

export function LoginPage() {
  const { login, state } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const notice = state.phase === 'signedOut' ? state.notice : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSent(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };

  const forgot = async () => {
    setError(null);
    setSent(null);
    const to = email.trim();
    if (!to) return setError('Type your work email above, then tap “Forgot password?” again.');
    try {
      await backend.resetPassword(to);
      setSent(`If ${to} is on the team, a link to set a new password is on its way. Check the inbox (and spam).`);
    } catch (err) {
      setError(msg(err));
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img src="/logo.png" alt="" width={64} height={64} />
        <h1>Invite Karoo</h1>
        <p className="login-sub">Team console — set up weddings, guest lists and support.</p>
        <Field label="Work email">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorNote>{error ?? (busy ? null : notice)}</ErrorNote>
        {sent ? <Note tone="ok">{sent}</Note> : null}
        <Btn kind="primary" type="submit" busy={busy} className="block">
          Sign in
        </Btn>
        <button type="button" className="linkish login-forgot" onClick={() => void forgot()}>
          Forgot password?
        </button>
        <p className="login-foot">No account? Ask an admin on the team to add you.</p>
      </form>
    </div>
  );
}
