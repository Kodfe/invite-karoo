'use client';
import NextLink from 'next/link';
import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '../auth';
import * as store from '../data';
import { Btn, ErrorNote, Field, Loading, msg, Note } from '../ui';

/** One time only: makes the first admin from ADMIN_EMAIL / ADMIN_PASSWORD on the API, then signs in. */
export function SetupPage() {
  const { login } = useAuth();
  const [open, setOpen] = useState<boolean | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    store.setupOpen().then(setOpen, (e) => {
      setOpen(false);
      setError(msg(e));
    });
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await store.createFirstAdmin({ name: name.trim(), email: email.trim(), password });
      // signed in, the gate shows app/setup/page.tsx, which goes on to the overview
      await login(email.trim(), password);
    } catch (err) {
      setError(msg(err));
      setBusy(false);
    }
  };

  if (open === null) return <Loading label="Checking…" />;

  return (
    <div className="login">
      {open ? (
        <form className="login-card" onSubmit={submit}>
          <img src="/logo.png" alt="" width={64} height={64} />
          <h1>Invite Karoo</h1>
          <p className="login-sub">Create the first admin. This page works once: after that, add people from the Team page.</p>
          <Field label="Your name">
            <input autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={60} autoFocus />
          </Field>
          <Field label="Work email" hint="The ADMIN_EMAIL set on the API">
            <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" hint="The ADMIN_PASSWORD set on the API — it becomes this account's password">
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={10} />
          </Field>
          <ErrorNote>{error}</ErrorNote>
          <Btn kind="primary" type="submit" busy={busy} className="block">
            Create admin and sign in
          </Btn>
        </form>
      ) : (
        <div className="login-card">
          <img src="/logo.png" alt="" width={64} height={64} />
          <h1>Invite Karoo</h1>
          {error ? <ErrorNote>{error}</ErrorNote> : <Note>Setup is closed: the first admin already exists, or ADMIN_EMAIL / ADMIN_PASSWORD are not set on the API.</Note>}
          <NextLink href="/" className="linkish login-forgot">
            Go to sign in
          </NextLink>
        </div>
      )}
    </div>
  );
}
