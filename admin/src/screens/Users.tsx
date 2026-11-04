'use client';
import { useState } from 'react';
import { Link } from '../nav';
import * as store from '../data';
import { Empty, ErrorNote, fmtDay, Loading, PageHead, Pager, useDebounced, useLoad } from '../ui';

const LANG: Record<string, string> = { en: 'English', hi: 'हिन्दी', ta: 'தமிழ்', gu: 'ગુજરાતી' };
const LIMIT = 50;

export function UsersPage() {
  const [q, setQ] = useState('');
  const [offset, setOffset] = useState(0);
  const dq = useDebounced(q);
  const list = useLoad(() => store.users({ q: dq, limit: LIMIT, offset }), [dq, offset]);

  return (
    <>
      <PageHead title="Users" sub={list.data ? `${list.data.total.toLocaleString('en-IN')} people use the app` : undefined} />
      <div className="toolbar">
        <input
          className="search"
          placeholder="Search name, city or number"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
      </div>
      <ErrorNote>{list.error}</ErrorNote>
      <div className="card flush">
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty title="No one found" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Mobile</th>
                <th className="hide-sm">City</th>
                <th className="hide-sm">Email</th>
                <th className="hide-sm">Language</th>
                <th>Joined</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((u: any) => (
                <tr key={u.id}>
                  <td>{u.name}</td>
                  <td className="mono">
                    <Link to={`/lookup`} state={{ phone: u.phonePretty }} title="Look up their invitations">
                      {u.phonePretty}
                    </Link>
                  </td>
                  <td className="hide-sm">{u.city || '—'}</td>
                  <td className="hide-sm">{u.email || '—'}</td>
                  <td className="hide-sm">{LANG[u.lang] ?? u.lang}</td>
                  <td>{fmtDay(u.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {list.data ? <Pager total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} /> : null}
    </>
  );
}
