import { FormEvent, useState } from 'react';
import { useAuth } from '../auth';
import { Btn, ErrorNote, Field, msg } from '../ui';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email.trim(), password);
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="login-card" onSubmit={submit}>
        <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={64} height={64} />
        <h1>Invite Karoo</h1>
        <p className="login-sub">Team console — set up weddings, guest lists and support.</p>
        <Field label="Work email">
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password">
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Btn kind="primary" type="submit" busy={busy} className="block">
          Sign in
        </Btn>
        <p className="login-foot">No account? Ask an admin on the team to add you.</p>
      </form>
    </div>
  );
}
