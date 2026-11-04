'use client';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useQueryParam } from '../nav';
import * as store from '../data';
import { ago, Btn, Empty, ErrorNote, fmtWhen, Loading, PageHead, Pager, Pill, Tabs, useAction, useLoad } from '../ui';

const LIMIT = 50;
type Status = '' | 'open' | 'answered' | 'closed';

export function TicketsPage() {
  const [status, setStatus] = useState<Status>('open');
  const [offset, setOffset] = useState(0);
  const list = useLoad(() => store.tickets({ status, limit: LIMIT, offset }), [status, offset]);

  return (
    <>
      <PageHead title="Support" sub="Messages people send from Profile → Help & support" />
      <Tabs<Status>
        value={status}
        onChange={(v) => {
          setStatus(v);
          setOffset(0);
        }}
        items={[
          { id: 'open', label: 'Open' },
          { id: 'answered', label: 'Answered' },
          { id: 'closed', label: 'Closed' },
          { id: '', label: 'All' },
        ]}
      />
      <ErrorNote>{list.error}</ErrorNote>
      <div className="card flush">
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty title={status === 'open' ? 'Inbox clear' : 'No tickets here'} />
        ) : (
          <table className="table clickable">
            <thead>
              <tr>
                <th>Ticket</th>
                <th>Subject</th>
                <th>From</th>
                <th className="hide-sm">Topic</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((t: any) => (
                <tr key={t.id}>
                  <td className="mono">
                    <Link to={`/tickets/${t.id}`}>{t.number}</Link>
                  </td>
                  <td>
                    <Link to={`/tickets/${t.id}`} className="plain">
                      {t.unreadForTeam ? <span className="badge">{t.unreadForTeam}</span> : null} {t.subject}
                    </Link>
                  </td>
                  <td>
                    {t.user.name}
                    <div className="muted small mono">{t.user.phonePretty}</div>
                  </td>
                  <td className="hide-sm">{t.category}</td>
                  <td>
                    <Pill v={t.status} />
                  </td>
                  <td>{ago(t.updatedAt)}</td>
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

export function TicketPage() {
  const id = useQueryParam('id');
  const t = useLoad(() => (id ? store.ticket(id) : new Promise<never>(() => {})), [id]);
  const [body, setBody] = useState('');
  const act = useAction();
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [t.data?.messages?.length]);

  const reply = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return;
    const r = await act.run(() => store.replyTicket(id, body.trim()), 'Reply sent — they get a notification');
    if (r) {
      setBody('');
      t.setData(r);
    }
  };
  const setStatus = async (status: string) => {
    const r = await act.run(() => store.setTicketStatus(id, status), status === 'closed' ? 'Ticket closed' : 'Status changed');
    if (r) t.reload();
  };

  if (!id) return <Empty title="No ticket chosen"><Link to="/tickets">Open support →</Link></Empty>;
  if (t.error) return <ErrorNote>{t.error}</ErrorNote>;
  if (!t.data) return <Loading />;
  const d = t.data;
  return (
    <>
      <PageHead
        back={
          <Link to="/tickets" className="back">
            ← Support
          </Link>
        }
        title={d.subject}
        sub={
          <>
            <span className="mono">{d.number}</span> · {d.category} · opened {fmtWhen(d.createdAt)} · <Pill v={d.status} />
          </>
        }
        actions={
          d.status === 'closed' ? (
            <Btn onClick={() => setStatus('open')}>Reopen</Btn>
          ) : (
            <>
              {d.status !== 'answered' ? <Btn onClick={() => setStatus('answered')}>Mark answered</Btn> : null}
              <Btn onClick={() => setStatus('closed')}>Close ticket</Btn>
            </>
          )
        }
      />
      <div className="ticket-layout">
        <section className="card thread">
          {d.messages.map((m: any) => (
            <div key={m.id} className={'msg ' + (m.author === 'team' ? 'team' : 'user')}>
              <div className="msg-who">
                {m.author === 'team' ? m.adminName ?? 'Invite Karoo team' : d.user.name} · <span>{fmtWhen(m.createdAt)}</span>
              </div>
              <div className="msg-body">{m.body}</div>
            </div>
          ))}
          <div ref={end} />
          <form className="reply" onSubmit={reply}>
            <textarea rows={4} placeholder={`Reply to ${d.user.name.split(' ')[0]}…`} value={body} onChange={(e) => setBody(e.target.value)} maxLength={4000} />
            <ErrorNote>{act.error}</ErrorNote>
            <div className="row-end">
              <Btn kind="primary" type="submit" busy={act.busy} disabled={!body.trim()}>
                Send reply
              </Btn>
            </div>
          </form>
        </section>
        <aside className="card side-info">
          <h3>From</h3>
          <div>{d.user.name}</div>
          <div className="mono">{d.user.phonePretty}</div>
          <div className="muted">{d.user.city}</div>
          <Link to="/lookup" state={{ phone: d.user.phonePretty }} className="small">
            Which weddings is this number on? →
          </Link>
          {d.weddingId ? (
            <>
              <h3>About wedding</h3>
              <Link to={`/weddings/${d.weddingId}`}>Open the wedding →</Link>
            </>
          ) : null}
        </aside>
      </div>
    </>
  );
}

