import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Btn, ErrorNote, Field, LABELS, PageHead, useAction } from '../ui';

export function AccountPage() {
  const { admin, logout } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const act = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== again) return act.setError('The two new passwords do not match');
    const r = await act.run(() => api.post('/me/password', { current, next }), 'Password changed');
    if (r) {
      setCurrent('');
      setNext('');
      setAgain('');
    }
  };

  return (
    <>
      <PageHead title="My account" sub={`${admin?.name} · ${admin?.email} · ${LABELS[admin?.role ?? '']}`} actions={<Btn onClick={logout}>Sign out</Btn>} />
      <form className="card narrow" onSubmit={submit}>
        <h2>Change password</h2>
        <Field label="Current password" error={act.fields.current}>
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        </Field>
        <Field label="New password" hint="At least 10 characters" error={act.fields.next}>
          <input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required minLength={10} />
        </Field>
        <Field label="New password again">
          <input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} required minLength={10} />
        </Field>
        <ErrorNote>{act.error}</ErrorNote>
        <div className="row-end">
          <Btn kind="primary" type="submit" busy={act.busy}>
            Change password
          </Btn>
        </div>
      </form>
    </>
  );
}
