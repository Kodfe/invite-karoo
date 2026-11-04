'use client';
import { useState } from 'react';
import { Link, useNavigate } from '../nav';
import { can } from '../api';
import * as store from '../data';
import { useAuth } from '../auth';
import { Btn, Empty, ErrorNote, fmtRange, Loading, Modal, PageHead, Pager, Pill, Tabs, useAction, useDebounced, useLoad } from '../ui';
import { emptyWedding, WeddingForm, weddingPayload } from './WeddingForm';

const LIMIT = 50;
type Status = '' | 'draft' | 'active' | 'paused' | 'ended';

export function WeddingsPage() {
  const { admin } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<Status>('');
  const [offset, setOffset] = useState(0);
  const [creating, setCreating] = useState(false);
  const dq = useDebounced(q);
  const list = useLoad(() => store.weddings({ q: dq, status, limit: LIMIT, offset }), [dq, status, offset]);
  const act = useAction();

  return (
    <>
      <PageHead
        title="Weddings"
        sub={list.data ? `${list.data.total} ${status ? 'here' : 'in all'}` : undefined}
        actions={can(admin?.role, 'setup') ? <Btn kind="primary" onClick={() => setCreating(true)}>New wedding</Btn> : null}
      />
      <div className="toolbar">
        <input
          className="search"
          placeholder="Search bride, groom, city or host’s number"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
        />
        <Tabs<Status>
          value={status}
          onChange={(v) => {
            setStatus(v);
            setOffset(0);
          }}
          items={[
            { id: '', label: 'All' },
            { id: 'draft', label: 'Draft' },
            { id: 'active', label: 'Active' },
            { id: 'paused', label: 'Paused' },
            { id: 'ended', label: 'Ended' },
          ]}
        />
      </div>
      <ErrorNote>{list.error}</ErrorNote>
      <div className="card flush">
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty title="No weddings found" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Couple</th>
                <th>Dates</th>
                <th className="hide-sm">City</th>
                <th className="hide-sm">Host</th>
                <th className="num">Functions</th>
                <th className="num">Guests</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((w: any) => (
                <tr key={w.id}>
                  <td>
                    <Link to={`/weddings/${w.id}`}>{w.couple}</Link>
                    <div className="muted small">
                      {w.bride} & {w.groom}
                    </div>
                  </td>
                  <td>{fmtRange(w.startDate, w.endDate)}</td>
                  <td className="hide-sm">{w.city}</td>
                  <td className="hide-sm mono">{w.ownerPhone}</td>
                  <td className="num">{w.functions}</td>
                  <td className="num">{w.guests}</td>
                  <td>
                    <Pill v={w.status} />
                    {w.status === 'draft' ? null : !w.handedOverAt ? <div className="muted small">not handed over</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {list.data ? <Pager total={list.data.total} limit={LIMIT} offset={offset} onChange={setOffset} /> : null}

      {creating ? (
        <Modal title="New wedding" onClose={() => setCreating(false)} wide>
          <p className="muted">It starts as a draft. Add functions and the guest list next, then hand it over to the host.</p>
          <WeddingForm
            initial={emptyWedding()}
            submitLabel="Create wedding"
            busy={act.busy}
            error={act.error}
            fields={act.fields}
            onCancel={() => setCreating(false)}
            onSubmit={async (v) => {
              const r = await act.run(() => store.createWedding(weddingPayload(v)), 'Wedding created');
              if (r) nav(`/weddings/${r.id}/functions`);
            }}
          />
        </Modal>
      ) : null}
    </>
  );
}
