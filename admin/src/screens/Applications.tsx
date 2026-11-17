'use client';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useQueryParam } from '../nav';
import { can } from '../api';
import * as store from '../data';
import { useAuth } from '../auth';
import { ago, Btn, Empty, ErrorNote, Field, fmtDay, fmtRange, fmtSize, fmtWhen, Loading, Note, PageHead, Pager, Pill, Tabs, useAction, useConfirm, useLoad } from '../ui';
import { ImportReport } from './Wedding';

const LIMIT = 50;
type Status = '' | 'new' | 'in_setup' | 'live' | 'rejected';

export function ApplicationsPage() {
  const [status, setStatus] = useState<Status>('new');
  const [offset, setOffset] = useState(0);
  const list = useLoad(() => store.applications({ status, limit: LIMIT, offset }), [status, offset]);

  return (
    <>
      <PageHead title="Host applications" sub="“Host a wedding” forms sent from the app. Turn each one into a wedding." />
      <Tabs<Status>
        value={status}
        onChange={(v) => {
          setStatus(v);
          setOffset(0);
        }}
        items={[
          { id: 'new', label: 'New' },
          { id: 'in_setup', label: 'In setup' },
          { id: 'live', label: 'Live' },
          { id: 'rejected', label: 'Rejected' },
          { id: '', label: 'All' },
        ]}
      />
      <ErrorNote>{list.error}</ErrorNote>
      <div className="card flush">
        {list.loading && !list.data ? (
          <Loading />
        ) : !list.data?.items.length ? (
          <Empty title="No applications here" />
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Couple</th>
                <th>Dates</th>
                <th className="hide-sm">City</th>
                <th>Applicant</th>
                <th className="hide-sm">Files</th>
                <th>Status</th>
                <th className="hide-sm">Assigned</th>
                <th>Sent</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((a: any) => (
                <tr key={a.id}>
                  <td>
                    <Link to={`/applications/${a.id}`}>
                      {a.data.brideName} & {a.data.groomName}
                    </Link>
                  </td>
                  <td>{fmtRange(a.data.startDate, a.data.endDate)}</td>
                  <td className="hide-sm">{a.data.city}</td>
                  <td>
                    {a.applicant ?? '—'}
                    <div className="muted small mono">{a.phonePretty}</div>
                  </td>
                  <td className="hide-sm">
                    {a.cardFile ? <Pill tone="info">Card</Pill> : null} {a.guestFile ? <Pill tone="info">Guest list</Pill> : null}
                  </td>
                  <td>
                    <Pill v={a.status} />
                  </td>
                  <td className="hide-sm">{a.assignedName ?? '—'}</td>
                  <td>{ago(a.createdAt)}</td>
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

export function ApplicationPage() {
  const id = useQueryParam('id');
  const { admin } = useAuth();
  const nav = useNavigate();
  const confirm = useConfirm();
  const app = useLoad(() => (id ? store.application(id) : new Promise<never>(() => {})), [id]);
  const team = useLoad(() => (can(admin?.role, 'admin') ? store.teamMembers() : Promise.resolve([] as any[])), [admin?.role]);
  const [notes, setNotes] = useState('');
  const [created, setCreated] = useState<any>(null);
  const act = useAction();

  useEffect(() => {
    setNotes(app.data?.adminNotes ?? '');
  }, [app.data?.adminNotes]);

  if (!id) return <Empty title="No application chosen"><Link to="/applications">Open host applications →</Link></Empty>;
  if (app.error) return <ErrorNote>{app.error}</ErrorNote>;
  if (!app.data) return <Loading />;
  const a = app.data;
  const d = a.data;
  const isSetup = can(admin?.role, 'setup');

  const patch = async (b: Record<string, unknown>, ok: string) => {
    const r = await act.run(() => store.patchApplication(id, b), ok);
    if (r) app.reload();
  };
  const createWedding = async () => {
    const ok = await confirm({
      title: 'Create the wedding?',
      body: (
        <>
          A draft wedding is made from this form{a.guestFile ? ', and the attached guest list is imported (functions included)' : ''}. Nothing is sent to anyone until you hand it over.
        </>
      ),
      ok: 'Create wedding',
    });
    if (!ok) return;
    const r = await act.run(() => store.weddingFromApplication(id), 'Wedding created');
    if (r) {
      if (r.import) {
        setCreated(r);
        app.reload();
      } else nav(`/weddings/${r.weddingId}`);
    }
  };

  return (
    <>
      <PageHead
        back={
          <Link to="/applications" className="back">
            ← Host applications
          </Link>
        }
        title={`${d.brideName} & ${d.groomName}`}
        sub={
          <>
            {d.city} · {fmtRange(d.startDate, d.endDate)} · sent {fmtWhen(a.createdAt)} · <Pill v={a.status} />
          </>
        }
        actions={
          a.weddingId ? (
            <Btn kind="primary" onClick={() => nav(`/weddings/${a.weddingId}`)}>
              Open the wedding →
            </Btn>
          ) : isSetup ? (
            <Btn kind="primary" busy={act.busy} onClick={createWedding}>
              Create wedding from this
            </Btn>
          ) : null
        }
      />
      <ErrorNote>{act.error}</ErrorNote>
      {created ? (
        <div className="card">
          <h2>Wedding created</h2>
          {created.import.report?.errors?.length ? (
            <Note tone="warn">The draft wedding is made, but their guest list could not be imported as it is. Fix the sheet and import it from the wedding’s Guests tab.</Note>
          ) : null}
          <ImportReport r={created.import} />
          <div className="row-end">
            <Btn kind="primary" onClick={() => nav(`/weddings/${created.weddingId}`)}>
              Open the wedding →
            </Btn>
          </div>
        </div>
      ) : null}
      <div className="grid2">
        <section className="card">
          <h2>What they told us</h2>
          <dl className="dl">
            <dt>Bride</dt>
            <dd>
              {d.brideName}
              {d.brideParents ? <div className="muted">{d.brideParents}</div> : null}
            </dd>
            <dt>Groom</dt>
            <dd>
              {d.groomName}
              {d.groomParents ? <div className="muted">{d.groomParents}</div> : null}
            </dd>
            <dt>Bride’s family</dt>
            <dd>
              {d.brideFamily || '—'}
              {d.brideElders ? <div className="muted">{d.brideElders}</div> : null}
            </dd>
            <dt>Groom’s family</dt>
            <dd>
              {d.groomFamily || '—'}
              {d.groomElders ? <div className="muted">{d.groomElders}</div> : null}
            </dd>
            <dt>City</dt>
            <dd>{d.city}</dd>
            <dt>Dates</dt>
            <dd>
              {fmtDay(d.startDate)} to {fmtDay(d.endDate)} {d.datesLocked === false ? <span className="muted">(may change)</span> : null}
            </dd>
            <dt>Applicant’s number</dt>
            <dd className="mono">{a.phonePretty}</dd>
          </dl>
        </section>
        <section className="card">
          <h2>Files</h2>
          {!a.cardFile && !a.guestFile ? <Note tone="warn">No files attached. Ask the family for the card and the guest list on WhatsApp.</Note> : null}
          {a.cardFile ? (
            <div className="file-row">
              <div>
                <strong>Invitation card</strong>
                <span className="muted">
                  {a.cardFile.name} · {fmtSize(a.cardFile.size)}
                </span>
              </div>
              <Btn small onClick={() => act.run(() => store.openFile(a.cardFile.key).then(() => true))}>
                Download
              </Btn>
            </div>
          ) : null}
          {a.guestFile ? (
            <div className="file-row">
              <div>
                <strong>Guest list</strong>
                <span className="muted">
                  {a.guestFile.name} · {fmtSize(a.guestFile.size)}
                </span>
              </div>
              <Btn small onClick={() => act.run(() => store.openFile(a.guestFile.key).then(() => true))}>
                Download
              </Btn>
            </div>
          ) : null}
          {a.guestReport ? (
            <>
              <h3>When they uploaded it</h3>
              <ImportReport r={{ report: a.guestReport }} />
            </>
          ) : null}

          <h2 className="mt">Team</h2>
          <div className="form">
            <Field label="Status">
              <select value={a.status} onChange={(e) => patch({ status: e.target.value }, 'Status changed')}>
                <option value="new">New</option>
                <option value="in_setup">In setup</option>
                <option value="live">Live</option>
                <option value="rejected">Rejected</option>
              </select>
            </Field>
            {team.data?.length ? (
              <Field label="Assigned to">
                <select value={a.assignedTo ?? ''} onChange={(e) => patch({ assignedTo: e.target.value || null }, 'Assigned')}>
                  <option value="">No one</option>
                  {team.data
                    .filter((m: any) => m.active)
                    .map((m: any) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                </select>
              </Field>
            ) : (
              <Field label="Assigned to">
                <div className="row">
                  <span>{a.assignedTo === admin?.id ? 'You' : a.assignedTo ? 'Someone on the team' : 'No one'}</span>
                  {a.assignedTo !== admin?.id ? (
                    <Btn small onClick={() => patch({ assignedTo: admin?.id }, 'Assigned to you')}>
                      Take it
                    </Btn>
                  ) : null}
                </div>
              </Field>
            )}
            <Field label="Team notes" hint="Only the team sees these">
              <textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} />
            </Field>
            <div className="row-end">
              <Btn disabled={notes === (a.adminNotes ?? '')} onClick={() => patch({ adminNotes: notes }, 'Notes saved')}>
                Save notes
              </Btn>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
