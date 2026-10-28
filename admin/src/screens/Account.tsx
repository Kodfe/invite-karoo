'use client';
import { FormEvent, useState } from 'react';
import { backend, useAuth } from '../auth';
import { Btn, ErrorNote, Field, LABELS, msg, PageHead, useToast } from '../ui';

export function AccountPage() {
  const { admin, logout } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (next.length < 10) return setError('The new password needs at least 10 characters');
    if (next !== again) return setError('The two new passwords do not match');
    setBusy(true);
    try {
      await backend.changePassword(current, next);
      toast('Password changed');
      setCurrent('');
      setNext('');
      setAgain('');
    } catch (err) {
      setError(msg(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="My account" sub={`${admin?.name} · ${admin?.email} · ${LABELS[admin?.role ?? '']}`} actions={<Btn onClick={() => void logout()}>Sign out</Btn>} />
      <form className="card narrow" onSubmit={submit}>
        <h2>Change password</h2>
        <Field label="Current password">
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" hint="At least 10 characters">
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} />
        </Field>
        <Field label="New password again">
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={10} />
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <div className="row-end">
          <Btn kind="primary" type="submit" busy={busy}>
            Change password
          </Btn>
        </div>
      </form>
    </>
  );
}
