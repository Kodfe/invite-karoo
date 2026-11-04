'use client';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useQueryParam } from '../nav';
import * as store from '../data';
import { Btn, Empty, ErrorNote, Field, PageHead, Pill, useAction } from '../ui';

type Hit = { guestId: string; name: string; active: boolean; weddingId: string; wedding: string; invites: number };

export function LookupPage() {
  const start = useQueryParam('phone');
  const [phone, setPhone] = useState(start);
  const [hits, setHits] = useState<Hit[] | null>(null);
  const act = useAction();

  const search = async (value: string) => {
    const digits = value.replace(/\D/g, '');
    if (digits.length < 6) return act.setError('Enter at least 6 digits of the number');
    const r = await act.run(() => store.lookupPhone(digits));
    if (r) setHits(r);
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    search(phone);
  };
  useEffect(() => {
    if (start) search(start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <PageHead title="Phone lookup" sub="Which weddings is this number on? Useful when a guest says “I can’t see my invitation”." />
      <form className="card narrow" onSubmit={submit}>
        <div className="inline-form">
          <Field label="Mobile number">
            <input inputMode="tel" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} autoFocus />
          </Field>
          <Btn kind="primary" type="submit" busy={act.busy}>
            Look up
          </Btn>
        </div>
        <ErrorNote>{act.error}</ErrorNote>
      </form>
      {hits ? (
        hits.length ? (
          <div className="card">
            <table className="table">
              <thead>
                <tr>
                  <th>Guest name on the list</th>
                  <th>Wedding</th>
                  <th>Functions invited to</th>
                  <th>On the list</th>
                </tr>
              </thead>
              <tbody>
                {hits.map((h) => (
                  <tr key={h.guestId}>
                    <td>{h.name}</td>
                    <td>
                      <Link to={`/weddings/${h.weddingId}/guests`}>{h.wedding}</Link>
                    </td>
                    <td>{h.invites}</td>
                    <td>{h.active ? <Pill tone="ok">Yes</Pill> : <Pill tone="muted">Removed</Pill>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Not on any guest list">This number is not on any wedding’s guest list. The host may have a different number for them.</Empty>
        )
      ) : null}
    </>
  );
}
