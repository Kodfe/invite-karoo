'use client';
import { FormEvent, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useQueryParam } from '../nav';
import { api, can, fileUrl } from '../api';
import { useAuth } from '../auth';
import { Btn, clock, Empty, ErrorNote, Field, fmtDay, fmtRange, fmtSize, fmtWhen, Loading, Modal, Note, PageHead, Pager, Pill, Tabs, useAction, useConfirm, useDebounced, useLoad, useToast } from '../ui';
import { WeddingForm, weddingPayload, weddingValues } from './WeddingForm';

type Tab = 'details' | 'functions' | 'guests' | 'media' | 'access';
type W = Record<string, any>;

export function WeddingPage() {
  const id = useQueryParam('id');
  const tab = (useQueryParam('tab') || 'details') as Tab;
  const nav = useNavigate();
  const { admin } = useAuth();
  const w = useLoad(() => (id ? api.get<W>(`/weddings/${id}`) : new Promise<never>(() => {})), [id]);
  const confirm = useConfirm();
  const act = useAction();
  const editable = can(admin?.role, 'setup');

  if (!id) return <Empty title="No wedding chosen"><Link to="/weddings">Open the list of weddings →</Link></Empty>;
  if (w.error) return <ErrorNote>{w.error}</ErrorNote>;
  if (!w.data) return <Loading />;
  const d = w.data;
  const setTab = (t: Tab) => nav(`/weddings/${id}/${t}`, { replace: true });

  const handover = async () => {
    const again = !!d.handedOverAt;
    const ok = await confirm({
      title: again ? 'Make the wedding active again?' : 'Hand over to the host?',
      body: again ? (
        'The wedding goes back to Active and guests can see it again.'
      ) : (
        <>
          The console opens for <strong className="mono">{d.ownerPhonePretty}</strong>, and every guest on the list can see the wedding in the app. The host gets a notification if they already use the app.
          <br />
          <br />
          {d.functions.length} functions · {d.guestCount} guests. Check the Functions and Guests tabs first.
        </>
      ),
      ok: again ? 'Make active' : 'Hand over',
    });
    if (!ok) return;
    const r = await act.run(() => api.post(`/weddings/${id}/handover`), again ? 'Wedding is active again' : 'Handed over — the host can open the console now');
    if (r) w.setData(r);
  };

  return (
    <>
      <PageHead
        back={
          <Link to="/weddings" className="back">
            ← Weddings
          </Link>
        }
        title={d.couple}
        sub={
          <>
            {d.city} · {fmtRange(d.startDate, d.endDate)} · host <span className="mono">{d.ownerPhonePretty}</span> · <Pill v={d.status} />{' '}
            {d.handedOverAt ? <span className="muted">handed over {fmtDay(d.handedOverAt)}</span> : null}
            {!d.sendingEnabled ? (
              <Pill tone="bad">WhatsApp sending off</Pill>
            ) : null}
          </>
        }
        actions={
          editable && (d.status === 'draft' || (d.status === 'paused' && d.handedOverAt)) ? (
            <Btn kind="gold" busy={act.busy} onClick={handover}>
              {d.handedOverAt ? 'Make active again' : 'Hand over to host'}
            </Btn>
          ) : null
        }
      />
      <ErrorNote>{act.error}</ErrorNote>
      {d.status === 'draft' ? (
        <Note tone="warn">
          Draft — guests and the host can’t see this wedding yet. Add functions, import the guest list, add the card and photos, then hand over.
        </Note>
      ) : null}
      <Tabs<Tab>
        value={tab as Tab}
        onChange={setTab}
        items={[
          { id: 'details', label: 'Details' },
          { id: 'functions', label: 'Functions', count: d.functions.length },
          { id: 'guests', label: 'Guests', count: d.guestCount },
          { id: 'media', label: 'Card & photos', count: d.media.length + (d.card ? 1 : 0) },
          { id: 'access', label: 'Access', count: d.access.length },
        ]}
      />
      {tab === 'details' ? <DetailsTab w={d} editable={editable} onSaved={w.setData} /> : null}
      {tab === 'functions' ? <FunctionsTab w={d} editable={editable} reload={w.reload} /> : null}
      {tab === 'guests' ? <GuestsTab w={d} editable={editable} reload={w.reload} /> : null}
      {tab === 'media' ? <MediaTab w={d} editable={editable} setW={w.setData} reload={w.reload} /> : null}
      {tab === 'access' ? <AccessTab w={d} editable={editable} setW={w.setData} /> : null}
    </>
  );
}

/* ───────────────────────── Details ───────────────────────── */

function DetailsTab({ w, editable, onSaved }: { w: W; editable: boolean; onSaved: (w: W) => void }) {
  const act = useAction();
  const st = useAction();
  const confirm = useConfirm();
  const [status, setStatus] = useState(w.status);
  const [reason, setReason] = useState(w.statusReason ?? '');
  const initial = useMemo(() => weddingValues(w), [w.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveStatus = async () => {
    if (status === 'ended' && !(await confirm({ title: 'End this wedding?', body: 'Reminders stop and the console becomes read-only for the host.', ok: 'End wedding', danger: true }))) return;
    const r = await st.run(() => api.patch(`/weddings/${w.id}`, { status, statusReason: reason.trim() || null }), 'Status saved');
    if (r) onSaved(r);
  };
  const toggleSending = async () => {
    const off = w.sendingEnabled;
    if (off && !(await confirm({ title: 'Stop WhatsApp sending?', body: 'Invitations and reminders for this wedding will not go out on WhatsApp until you turn it back on. In-app notifications still work.', ok: 'Stop sending', danger: true }))) return;
    const r = await st.run(() => api.patch(`/weddings/${w.id}`, { sendingEnabled: !off }), off ? 'WhatsApp sending stopped' : 'WhatsApp sending is on');
    if (r) onSaved(r);
  };

  return (
    <div className="grid-main">
      <section className="card">
        <h2>Couple, families and dates</h2>
        <WeddingForm
          key={w.updatedAt}
          initial={initial}
          readOnly={!editable}
          submitLabel="Save changes"
          busy={act.busy}
          error={act.error}
          fields={act.fields}
          onSubmit={async (v) => {
            const r = await act.run(() => api.patch(`/weddings/${w.id}`, weddingPayload(v)), 'Saved');
            if (r) onSaved(r);
          }}
        />
      </section>
      <aside className="stack">
        <section className="card">
          <h2>Status</h2>
          <fieldset disabled={!editable} className="plainset form">
            <Field label="Status" hint="Paused hides the wedding from guests and stops reminders">
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="draft">Draft (being set up)</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="ended">Ended</option>
              </select>
            </Field>
            <Field label="Reason (team only)">
              <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="e.g. Family asked to wait" />
            </Field>
            <div className="row-end">
              <Btn disabled={status === w.status && reason === (w.statusReason ?? '')} busy={st.busy} onClick={saveStatus}>
                Save status
              </Btn>
            </div>
          </fieldset>
        </section>
        <section className="card">
          <h2>WhatsApp</h2>
          <p className="muted">
            {w.sendingEnabled ? 'Invitations and reminders go out on WhatsApp when the host sends them.' : 'Nothing goes out on WhatsApp for this wedding.'}
          </p>
          {editable ? (
            <Btn kind={w.sendingEnabled ? 'danger' : 'primary'} busy={st.busy} onClick={toggleSending}>
              {w.sendingEnabled ? 'Stop WhatsApp sending' : 'Turn WhatsApp sending on'}
            </Btn>
          ) : null}
          <ErrorNote>{st.error}</ErrorNote>
        </section>
        <section className="card">
          <h2>Record</h2>
          <dl className="dl tight">
            <dt>Created</dt>
            <dd>{fmtWhen(w.createdAt)}</dd>
            <dt>Last change</dt>
            <dd>{fmtWhen(w.updatedAt)}</dd>
            <dt>Handed over</dt>
            <dd>{w.handedOverAt ? fmtWhen(w.handedOverAt) : 'Not yet'}</dd>
            {w.applicationId ? (
              <>
                <dt>From</dt>
                <dd>
                  <Link to={`/applications/${w.applicationId}`}>the host’s application</Link>
                </dd>
              </>
            ) : null}
          </dl>
        </section>
      </aside>
    </div>
  );
}

/* ───────────────────────── Functions ───────────────────────── */

type Fn = Record<string, any>;

function FunctionsTab({ w, editable, reload }: { w: W; editable: boolean; reload: () => void }) {
  const [edit, setEdit] = useState<Fn | 'new' | null>(null);
  const confirm = useConfirm();
  const act = useAction();

  const remove = async (f: Fn) => {
    const ok = await confirm({
      title: `Delete ${f.name}?`,
      body: f.invited ? `${f.invited} guests are invited to it. They will no longer see it, and their replies for it are lost.` : 'It has no guests yet.',
      ok: 'Delete function',
      danger: true,
    });
    if (!ok) return;
    if (await act.run(() => api.delete(`/weddings/${w.id}/functions/${f.id}`), `${f.name} deleted`)) reload();
  };

  return (
    <section className="card flush">
      <div className="card-head pad">
        <h2>Functions</h2>
        {editable ? (
          <Btn kind="primary" small onClick={() => setEdit('new')}>
            Add a function
          </Btn>
        ) : null}
      </div>
      <ErrorNote>{act.error}</ErrorNote>
      {!w.functions.length ? (
        <Empty title="No functions yet">Add them here, or import a guest list with a Functions sheet.</Empty>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Function</th>
              <th>When</th>
              <th className="hide-sm">Venue</th>
              <th className="num">Invited</th>
              <th className="num">Going</th>
              <th className="num hide-sm">Gifts out</th>
              <th className="hide-sm">WhatsApp</th>
              {editable ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            {w.functions.map((f: Fn) => (
              <tr key={f.id}>
                <td>
                  <span className="swatch" style={{ background: f.color }} /> <strong>{f.name}</strong>
                  {f.dressCode ? <div className="muted small">Dress: {f.dressCode}</div> : null}
                </td>
                <td>
                  {f.dayLabel}
                  <div className="muted small">
                    {f.timeLabel}
                    {f.end ? ` – ${clock(f.end)}` : ''}
                  </div>
                </td>
                <td className="hide-sm">
                  {f.venueName}
                  {f.venueAddress ? <div className="muted small">{f.venueAddress}</div> : null}
                </td>
                <td className="num">{f.invited}</td>
                <td className="num">{f.going}</td>
                <td className="num hide-sm">{f.giftOut}</td>
                <td className="hide-sm">
                  {f.blasts.length
                    ? f.blasts.map((b: any) => (
                        <div key={b.kind} className="small">
                          {b.kind === 'rsvp_request' ? 'Invitation' : 'Reminder'} <Pill v={b.state} /> {b.recipientCount ? <span className="muted">{b.recipientCount}</span> : null}
                        </div>
                      ))
                    : <span className="muted small">Nothing sent</span>}
                </td>
                {editable ? (
                  <td className="row-actions">
                    <Btn small onClick={() => setEdit(f)}>
                      Edit
                    </Btn>
                    <Btn small kind="danger" onClick={() => remove(f)}>
                      Delete
                    </Btn>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {edit ? (
        <FunctionForm
          w={w}
          f={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            reload();
          }}
        />
      ) : null}
    </section>
  );
}

const ICONS = ['rings', 'flower', 'music', 'diya', 'gift'];

function FunctionForm({ w, f, onClose, onSaved }: { w: W; f: Fn | null; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    name: f?.name ?? '',
    date: f?.date ?? w.startDate,
    start: f?.start ?? '19:00',
    end: f?.end ?? '',
    venueName: f?.venueName ?? '',
    venueAddress: f?.venueAddress ?? '',
    mapsUrl: f?.mapsUrl ?? '',
    dressCode: f?.dressCode ?? '',
    notes: f?.notes ?? '',
    giftPlan: f?.giftPlan ?? '',
    color: f?.color ?? '',
    icon: f?.icon ?? '',
  });
  const act = useAction();
  const set = (k: keyof typeof v, x: string) => setV((p) => ({ ...p, [k]: x }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const nul = (s: string) => (s.trim() ? s.trim() : null);
    const body: Record<string, unknown> = {
      name: v.name.trim(),
      date: v.date,
      start: v.start,
      end: nul(v.end),
      venueName: v.venueName.trim(),
      venueAddress: nul(v.venueAddress),
      mapsUrl: nul(v.mapsUrl),
      dressCode: nul(v.dressCode),
      notes: nul(v.notes),
      giftPlan: nul(v.giftPlan),
    };
    if (v.color) body.color = v.color;
    if (v.icon) body.icon = v.icon;
    const r = f
      ? await act.run(() => api.patch(`/weddings/${w.id}/functions/${f.id}`, body), 'Function saved')
      : await act.run(() => api.post(`/weddings/${w.id}/functions`, body), `${v.name} added`);
    if (r) onSaved();
  };

  return (
    <Modal
      title={f ? `Edit ${f.name}` : 'Add a function'}
      onClose={onClose}
      wide
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" type="submit" form="fn-form" busy={act.busy}>
            {f ? 'Save' : 'Add function'}
          </Btn>
        </>
      }
    >
      {f && w.status === 'active' ? <Note tone="warn">This wedding is live. If you move the time or venue, every invited guest is told, and their reminders move with it.</Note> : null}
      <form id="fn-form" className="form" onSubmit={submit}>
        <div className="form-cols">
          <Field label="Name" hint="Haldi, Mehendi, Sangeet, Wedding, Reception…" error={act.fields.name}>
            <input value={v.name} onChange={(e) => set('name', e.target.value)} required maxLength={60} autoFocus />
          </Field>
          <Field label="Dress code">
            <input value={v.dressCode} onChange={(e) => set('dressCode', e.target.value)} maxLength={80} placeholder="e.g. Yellow, Indo-western" />
          </Field>
        </div>
        <div className="form-cols three">
          <Field label="Date" error={act.fields.date} hint={w.datesLocked ? `${fmtDay(w.startDate)} to ${fmtDay(w.endDate)}` : undefined}>
            <input type="date" value={v.date} min={w.datesLocked ? w.startDate : undefined} max={w.datesLocked ? w.endDate : undefined} onChange={(e) => set('date', e.target.value)} required />
          </Field>
          <Field label="Starts" error={act.fields.start}>
            <input type="time" value={v.start} onChange={(e) => set('start', e.target.value)} required />
          </Field>
          <Field label="Ends (optional)" error={act.fields.end}>
            <input type="time" value={v.end} onChange={(e) => set('end', e.target.value)} />
          </Field>
        </div>
        <div className="form-cols">
          <Field label="Venue" error={act.fields.venueName}>
            <input value={v.venueName} onChange={(e) => set('venueName', e.target.value)} required maxLength={100} />
          </Field>
          <Field label="Address">
            <input value={v.venueAddress} onChange={(e) => set('venueAddress', e.target.value)} maxLength={200} />
          </Field>
        </div>
        <Field label="Google Maps link" error={act.fields.mapsUrl}>
          <input type="url" value={v.mapsUrl} onChange={(e) => set('mapsUrl', e.target.value)} maxLength={500} placeholder="https://maps.app.goo.gl/…" />
        </Field>
        <div className="form-cols">
          <Field label="Note for guests">
            <textarea rows={2} value={v.notes} onChange={(e) => set('notes', e.target.value)} maxLength={300} />
          </Field>
          <Field label="Gift plan (host only)" hint="e.g. Sweets box for every family">
            <input value={v.giftPlan} onChange={(e) => set('giftPlan', e.target.value)} maxLength={80} />
          </Field>
        </div>
        <div className="form-cols">
          <Field label="Colour" hint="Leave empty to pick from the name">
            <div className="row">
              <input type="color" value={v.color || '#7C5CBF'} onChange={(e) => set('color', e.target.value.toUpperCase())} className="color" />
              {v.color ? (
                <button type="button" className="linkish" onClick={() => set('color', '')}>
                  Use automatic
                </button>
              ) : (
                <span className="muted small">Automatic</span>
              )}
            </div>
          </Field>
          <Field label="Picture">
            <select value={v.icon} onChange={(e) => set('icon', e.target.value)}>
              <option value="">Automatic (from the name)</option>
              {ICONS.map((i) => (
                <option key={i} value={i}>
                  {i}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <ErrorNote>{act.error}</ErrorNote>
      </form>
    </Modal>
  );
}

/* ───────────────────────── Guests ───────────────────────── */

const GLIMIT = 100;

function GuestsTab({ w, editable, reload }: { w: W; editable: boolean; reload: () => void }) {
  const [q, setQ] = useState('');
  const [removed, setRemoved] = useState(false);
  const [offset, setOffset] = useState(0);
  const [edit, setEdit] = useState<W | 'new' | null>(null);
  const [importing, setImporting] = useState(false);
  const dq = useDebounced(q);
  const list = useLoad(() => api.get(`/weddings/${w.id}/guests`, { q: dq, removed: removed ? '1' : '0', limit: GLIMIT, offset }), [w.id, dq, removed, offset]);
  const act = useAction();
  const confirm = useConfirm();
  const fns: Fn[] = w.functions;

  const setActive = async (g: W, active: boolean) => {
    if (!active && !(await confirm({ title: `Take ${g.name} off the list?`, body: 'They stop seeing this wedding in the app. You can put them back from “Removed”.', ok: 'Remove', danger: true }))) return;
    if (await act.run(() => api.patch(`/weddings/${w.id}/guests/${g.id}`, { active }), active ? `${g.name} is back on the list` : `${g.name} removed`)) {
      list.reload();
      reload();
    }
  };

  return (
    <section className="card flush">
      <div className="card-head pad wrap">
        <div className="toolbar tight">
          <input
            className="search"
            placeholder="Search name or number"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={removed}
              onChange={(e) => {
                setRemoved(e.target.checked);
                setOffset(0);
              }}
            />
            Show removed
          </label>
        </div>
        <div className="row">
          <Btn small onClick={() => act.run(() => api.download('/guest-template', 'invite-karoo-guest-list.xlsx'))}>
            Blank template
          </Btn>
          <Btn small onClick={() => act.run(() => api.download(`/weddings/${w.id}/guests/export`, 'guests.xlsx'))}>
            Export
          </Btn>
          {editable ? (
            <>
              <Btn small onClick={() => setImporting(true)}>
                Import sheet
              </Btn>
              <Btn small kind="primary" disabled={!fns.length} title={fns.length ? '' : 'Add a function first'} onClick={() => setEdit('new')}>
                Add guest
              </Btn>
            </>
          ) : null}
        </div>
      </div>
      <ErrorNote>{list.error ?? act.error}</ErrorNote>
      {list.loading && !list.data ? (
        <Loading />
      ) : !list.data?.items.length ? (
        <Empty title={q ? 'No one matches' : removed ? 'No one removed' : 'No guests yet'}>{!q && !removed ? 'Import the family’s guest list sheet, or add guests one by one.' : null}</Empty>
      ) : (
        <div className="table-scroll">
          <table className="table guests">
            <thead>
              <tr>
                <th>Guest</th>
                <th>Mobile</th>
                <th className="hide-sm">Side</th>
                <th className="num hide-sm">Pax</th>
                {fns.map((f) => (
                  <th key={f.id} className="fn-col" title={f.name}>
                    <span className="swatch" style={{ background: f.color }} />
                    {f.name}
                  </th>
                ))}
                {editable ? <th /> : null}
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((g: any) => (
                <tr key={g.id}>
                  <td>
                    {g.name}
                    {g.relation ? <div className="muted small">{g.relation}</div> : null}
                  </td>
                  <td className="mono">{g.phonePretty}</td>
                  <td className="hide-sm">{g.side === 'bride' ? 'Bride' : 'Groom'}</td>
                  <td className="num hide-sm">{g.expectedPax}</td>
                  {fns.map((f) => {
                    const i = g.functions.find((x: any) => x.functionId === f.id);
                    return (
                      <td key={f.id} className="fn-col">
                        {i ? (
                          <>
                            <Pill v={i.rsvp} />
                            {i.rsvp === 'going' && i.pax ? <span className="muted small"> ×{i.pax}</span> : null}
                            {i.giftOut ? <span className={'gift' + (i.giftOutGiven ? ' given' : '')} title={i.giftOutGiven ? 'Gift given' : 'Gift to give'}>🎁</span> : null}
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    );
                  })}
                  {editable ? (
                    <td className="row-actions">
                      {removed ? (
                        <Btn small onClick={() => setActive(g, true)}>
                          Restore
                        </Btn>
                      ) : (
                        <>
                          <Btn small onClick={() => setEdit(g)}>
                            Edit
                          </Btn>
                          <Btn small kind="danger" onClick={() => setActive(g, false)}>
                            Remove
                          </Btn>
                        </>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {list.data ? (
        <div className="pad">
          <Pager total={list.data.total} limit={GLIMIT} offset={offset} onChange={setOffset} />
        </div>
      ) : null}
      {edit ? (
        <GuestForm
          w={w}
          g={edit === 'new' ? null : edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            list.reload();
            reload();
          }}
        />
      ) : null}
      {importing ? (
        <ImportDialog
          w={w}
          onClose={() => setImporting(false)}
          onDone={() => {
            list.reload();
            reload();
          }}
        />
      ) : null}
    </section>
  );
}

function GuestForm({ w, g, onClose, onSaved }: { w: W; g: W | null; onClose: () => void; onSaved: () => void }) {
  const fns: Fn[] = w.functions;
  const [v, setV] = useState({
    name: g?.name ?? '',
    phone: g?.phonePretty ?? '',
    side: (g?.side ?? 'bride') as 'bride' | 'groom',
    relation: g?.relation ?? '',
    expectedPax: g?.expectedPax ?? 1,
    notes: g?.notes ?? '',
  });
  const [picked, setPicked] = useState<Record<string, { on: boolean; giftOut: boolean }>>(() =>
    Object.fromEntries(
      fns.map((f) => {
        const i = g?.functions.find((x: any) => x.functionId === f.id);
        return [f.id, { on: g ? !!i : true, giftOut: !!i?.giftOut }];
      }),
    ),
  );
  const act = useAction();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const functions = fns.filter((f) => picked[f.id]?.on).map((f) => ({ functionId: f.id, giftOut: picked[f.id].giftOut }));
    if (!functions.length) return act.setError('Pick at least one function');
    const body = { ...v, name: v.name.trim(), relation: v.relation.trim(), notes: v.notes.trim(), expectedPax: Number(v.expectedPax) || 1, functions };
    const r = g ? await act.run(() => api.put(`/weddings/${w.id}/guests/${g.id}`, body), 'Guest saved') : await act.run(() => api.post(`/weddings/${w.id}/guests`, body), `${body.name} added`);
    if (r) onSaved();
  };

  return (
    <Modal
      title={g ? `Edit ${g.name}` : 'Add a guest'}
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn kind="primary" type="submit" form="guest-form" busy={act.busy}>
            {g ? 'Save' : 'Add guest'}
          </Btn>
        </>
      }
    >
      <form id="guest-form" className="form" onSubmit={submit}>
        <div className="form-cols">
          <Field label="Name" error={act.fields.name}>
            <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required maxLength={60} autoFocus />
          </Field>
          <Field label="Mobile" error={act.fields.phone} hint="Their invitation shows up when they sign in with this number">
            <input inputMode="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} required />
          </Field>
        </div>
        <div className="form-cols three">
          <Field label="Side">
            <select value={v.side} onChange={(e) => setV({ ...v, side: e.target.value as 'bride' | 'groom' })}>
              <option value="bride">Bride’s side</option>
              <option value="groom">Groom’s side</option>
            </select>
          </Field>
          <Field label="Relation">
            <input value={v.relation} onChange={(e) => setV({ ...v, relation: e.target.value })} maxLength={40} placeholder="Mama ji, college friend…" />
          </Field>
          <Field label="Expected people">
            <input type="number" min={1} max={20} value={v.expectedPax} onChange={(e) => setV({ ...v, expectedPax: Number(e.target.value) })} />
          </Field>
        </div>
        <Field label="Notes (host only)">
          <input value={v.notes} onChange={(e) => setV({ ...v, notes: e.target.value })} maxLength={300} />
        </Field>
        <div className="field">
          <span className="field-label">Invited to</span>
          <div className="fn-picks">
            {fns.map((f) => (
              <div key={f.id} className={'fn-pick' + (picked[f.id]?.on ? ' on' : '')}>
                <label className="check">
                  <input type="checkbox" checked={!!picked[f.id]?.on} onChange={(e) => setPicked({ ...picked, [f.id]: { ...picked[f.id], on: e.target.checked } })} />
                  <span className="swatch" style={{ background: f.color }} />
                  <span>
                    {f.name} <span className="muted small">{f.dayLabel}</span>
                  </span>
                </label>
                <label className="check small">
                  <input type="checkbox" disabled={!picked[f.id]?.on} checked={!!picked[f.id]?.giftOut} onChange={(e) => setPicked({ ...picked, [f.id]: { ...picked[f.id], giftOut: e.target.checked } })} />
                  Gift to give
                </label>
              </div>
            ))}
          </div>
        </div>
        <ErrorNote>{act.error}</ErrorNote>
      </form>
    </Modal>
  );
}

export function ImportReport({ r }: { r: any }) {
  if (!r) return null;
  const rep = r.report ?? {};
  const applied = r.dryRun === false;
  const preview = r.dryRun === true;
  return (
    <div className="report">
      <div className="report-nums">
        <div>
          <b>{rep.guests ?? 0}</b> guest rows read
        </div>
        {rep.bad ? (
          <div className="bad-text">
            <b>{rep.bad}</b> rows skipped
          </div>
        ) : null}
        {rep.gifts ? (
          <div>
            <b>{rep.gifts}</b> gifts marked
          </div>
        ) : null}
        {r.added !== undefined ? (
          <>
            <div>
              <b>{r.added}</b> {preview ? 'will be added' : 'added'}
            </div>
            <div>
              <b>{r.updated}</b> {preview ? 'will be updated' : 'updated'}
            </div>
            {r.removed ? (
              <div className="bad-text">
                <b>{r.removed}</b> {preview ? 'will be taken off the list' : 'taken off the list'}
              </div>
            ) : null}
            {applied && r.invitesAdded ? (
              <div>
                <b>{r.invitesAdded}</b> new invitations
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {rep.functions?.length ? (
        <div className="small">
          <span className="muted">Function columns:</span> {rep.functions.join(', ')}
        </div>
      ) : null}
      {r.functionsCreated?.length ? (
        <Note tone="info">
          {preview ? 'These functions will be created from the Functions sheet' : 'Functions created'}: <b>{r.functionsCreated.join(', ')}</b>
        </Note>
      ) : null}
      {rep.errors?.length ? (
        <Note tone="bad">
          <b>Fix these in the sheet first</b>
          <ul>
            {rep.errors.map((e: string, i: number) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Note>
      ) : null}
      {rep.warnings?.length ? (
        <Note tone="warn">
          <ul>
            {rep.warnings.map((e: string, i: number) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </Note>
      ) : null}
      {rep.badRows?.length ? (
        <details className="bad-rows">
          <summary>{rep.badRows.length} rows that were skipped</summary>
          <ul>
            {rep.badRows.map((e: string, i: number) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function ImportDialog({ w, onClose, onDone }: { w: W; onClose: () => void; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [createFunctions, setCreateFunctions] = useState(true);
  const [preview, setPreview] = useState<any>(null);
  const [result, setResult] = useState<any>(null);
  const act = useAction();

  const send = (dryRun: boolean) => {
    const fd = new FormData();
    fd.append('file', file!);
    return api.upload(`/weddings/${w.id}/guests/import`, fd, { mode, dryRun: String(dryRun), createFunctions: String(createFunctions) });
  };
  const check = async () => {
    setPreview(null);
    const r = await act.run(() => send(true));
    if (r) setPreview(r);
  };
  const apply = async () => {
    const r = await act.run(() => send(false), 'Guest list imported');
    if (r) {
      setResult(r);
      onDone();
    }
  };
  const canApply = preview && !preview.report.errors.length;
  const reset = () => {
    setPreview(null);
    setResult(null);
  };

  return (
    <Modal
      title="Import the guest list"
      onClose={onClose}
      wide
      footer={
        result ? (
          <Btn kind="primary" onClick={onClose}>
            Done
          </Btn>
        ) : (
          <>
            <Btn onClick={onClose}>Cancel</Btn>
            {preview ? (
              <Btn kind="primary" disabled={!canApply} busy={act.busy} onClick={apply}>
                Import {preview.added + preview.updated} guests
              </Btn>
            ) : (
              <Btn kind="primary" disabled={!file} busy={act.busy} onClick={check}>
                Check the sheet
              </Btn>
            )}
          </>
        )
      }
    >
      {result ? (
        <>
          <Note tone="ok">The guest list is in. Nothing was sent to guests — the host sends invitations from the app.</Note>
          <ImportReport r={result} />
        </>
      ) : (
        <div className="form">
          <p className="muted">
            Excel (.xlsx) or CSV in the Invite Karoo template: a <b>Guests</b> sheet with one Y/N column per function (and an optional “Gift” column per function), plus an optional <b>Functions</b> sheet with
            dates, times and venues. Checking first changes nothing.
          </p>
          <Field label="Sheet">
            <input
              type="file"
              accept=".xlsx,.xls,.csv,.xml"
              onChange={(e) => {
                setFile(e.target.files?.[0] ?? null);
                reset();
              }}
            />
          </Field>
          <div className="form-cols">
            <Field label="How to apply it">
              <select
                value={mode}
                onChange={(e) => {
                  setMode(e.target.value as 'merge' | 'replace');
                  reset();
                }}
              >
                <option value="merge">Merge — add new guests, update existing ones</option>
                <option value="replace">Replace — the sheet is the whole list; take off anyone not in it</option>
              </select>
            </Field>
            <label className="check pad-top">
              <input
                type="checkbox"
                checked={createFunctions}
                onChange={(e) => {
                  setCreateFunctions(e.target.checked);
                  reset();
                }}
              />
              Create missing functions from the Functions sheet
            </label>
          </div>
          {preview ? (
            <>
              <h3>{canApply ? 'Looks good — here is what will happen' : 'The sheet needs fixing'}</h3>
              <ImportReport r={preview} />
            </>
          ) : null}
          <ErrorNote>{act.error}</ErrorNote>
        </div>
      )}
    </Modal>
  );
}

/* ───────────────────────── Card & photos ───────────────────────── */

const KINDS: { id: 'cover' | 'couple' | 'family'; label: string; hint: string }[] = [
  { id: 'cover', label: 'Cover carousel', hint: 'Top of the wedding page. Photos, plus at most one short video.' },
  { id: 'couple', label: 'The couple', hint: 'Gallery of the bride and groom' },
  { id: 'family', label: 'Family', hint: 'Gallery of the families' },
];

function MediaTab({ w, editable, setW, reload }: { w: W; editable: boolean; setW: (w: W) => void; reload: () => void }) {
  const act = useAction();
  const toast = useToast();
  const confirm = useConfirm();
  const [uploading, setUploading] = useState<string | null>(null);

  const addMedia = async (kind: string, files: FileList | null) => {
    if (!files?.length) return;
    setUploading(kind);
    let n = 0;
    for (const file of Array.from(files)) {
      const fd = new FormData();
      fd.append('file', file);
      const r = await act.run(() => api.upload(`/weddings/${w.id}/media`, fd, { kind }));
      if (!r) break;
      n++;
    }
    setUploading(null);
    if (n) toast(`${n} ${n === 1 ? 'file' : 'files'} added`);
    reload();
  };
  const move = async (kind: string, idx: number, dir: -1 | 1) => {
    const items = w.media.filter((m: any) => m.kind === kind);
    const j = idx + dir;
    if (j < 0 || j >= items.length) return;
    [items[idx], items[j]] = [items[j], items[idx]];
    if (await act.run(() => api.put(`/weddings/${w.id}/media/order`, { ids: items.map((m: any) => m.id) }))) reload();
  };
  const remove = async (m: any) => {
    if (!(await confirm({ title: 'Delete this photo?', body: 'It is removed from the wedding page for everyone.', ok: 'Delete', danger: true }))) return;
    if (await act.run(() => api.delete(`/weddings/${w.id}/media/${m.id}`), 'Deleted')) reload();
  };

  return (
    <div className="stack">
      <ErrorNote>{act.error}</ErrorNote>
      <div className="grid2">
        <CardSection w={w} editable={editable} setW={setW} />
        <VoiceSection w={w} editable={editable} setW={setW} />
      </div>
      <PeopleSection w={w} editable={editable} setW={setW} />
      {KINDS.map((k) => {
        const items = w.media.filter((m: any) => m.kind === k.id);
        return (
          <section key={k.id} className="card">
            <div className="card-head">
              <div>
                <h2>{k.label}</h2>
                <div className="muted small">{k.hint}</div>
              </div>
              {editable ? (
                <label className={'btn btn-ghost sm' + (uploading ? ' disabled' : '')}>
                  {uploading === k.id ? <span className="spin" /> : null}
                  Add {k.id === 'cover' ? 'photos or a video' : 'photos'}
                  <input type="file" hidden multiple accept={k.id === 'cover' ? 'image/*,video/mp4,video/quicktime' : 'image/*'} disabled={!!uploading} onChange={(e) => { addMedia(k.id, e.target.files); e.target.value = ''; }} />
                </label>
              ) : null}
            </div>
            {!items.length ? (
              <div className="muted small">Nothing yet.</div>
            ) : (
              <div className="thumbs">
                {items.map((m: any, i: number) => (
                  <figure key={m.id} className="thumb">
                    {m.type === 'video' ? <video src={fileUrl(m.url)} muted playsInline preload="metadata" /> : <img src={fileUrl(m.url)} alt="" loading="lazy" />}
                    {m.type === 'video' ? <span className="thumb-tag">Video</span> : null}
                    {editable ? (
                      <figcaption>
                        <button title="Move earlier" disabled={i === 0} onClick={() => move(k.id, i, -1)}>
                          ←
                        </button>
                        <button title="Move later" disabled={i === items.length - 1} onClick={() => move(k.id, i, 1)}>
                          →
                        </button>
                        <button title="Delete" className="del" onClick={() => remove(m)}>
                          Delete
                        </button>
                      </figcaption>
                    ) : null}
                  </figure>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

function CardSection({ w, editable, setW }: { w: W; editable: boolean; setW: (w: W) => void }) {
  const [pdf, setPdf] = useState<File | null>(null);
  const [pages, setPages] = useState<File[]>([]);
  const act = useAction();
  const pdfRef = useRef<HTMLInputElement>(null);
  const pagesRef = useRef<HTMLInputElement>(null);

  const upload = async () => {
    if (!pdf) return;
    const fd = new FormData();
    fd.append('pdf', pdf);
    pages.forEach((p) => fd.append('pages', p));
    const r = await act.run(() => api.upload(`/weddings/${w.id}/card`, fd), 'Card uploaded');
    if (r) {
      setW(r);
      setPdf(null);
      setPages([]);
      if (pdfRef.current) pdfRef.current.value = '';
      if (pagesRef.current) pagesRef.current.value = '';
    }
  };

  return (
    <section className="card">
      <h2>Invitation card</h2>
      {w.card ? (
        <>
          <div className="file-row">
            <div>
              <strong>{w.card.name}</strong>
              <span className="muted">
                PDF · {fmtSize(w.card.size)} · {w.card.pages?.length ? `${w.card.pages.length} page images` : 'no page images (guests see the PDF)'}
              </span>
            </div>
          </div>
          {w.card.pages?.length ? (
            <div className="thumbs small">
              {w.card.pages.map((u: string) => (
                <figure key={u} className="thumb">
                  <img src={fileUrl(u)} alt="" loading="lazy" />
                </figure>
              ))}
            </div>
          ) : null}
        </>
      ) : (
        <Note tone="warn">No card yet. Guests see the wedding without a card until you add one.</Note>
      )}
      {editable ? (
        <div className="form mt">
          <Field label={w.card ? 'Replace with a new PDF' : 'Card PDF'}>
            <input ref={pdfRef} type="file" accept="application/pdf" onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
          </Field>
          <Field label="Page images (optional)" hint="One image per page, in order — they open faster on phones than the PDF. Up to 12.">
            <input ref={pagesRef} type="file" accept="image/*" multiple onChange={(e) => setPages(Array.from(e.target.files ?? []).slice(0, 12))} />
          </Field>
          <ErrorNote>{act.error}</ErrorNote>
          <div className="row-end">
            <Btn kind="primary" disabled={!pdf} busy={act.busy} onClick={upload}>
              Upload card
            </Btn>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function VoiceSection({ w, editable, setW }: { w: W; editable: boolean; setW: (w: W) => void }) {
  const act = useAction();
  const upload = async (file?: File) => {
    if (!file) return;
    const durationSec = await audioLength(file);
    const fd = new FormData();
    fd.append('file', file);
    const r = await act.run(() => api.upload(`/weddings/${w.id}/voice`, fd, durationSec ? { durationSec } : undefined), 'Voice note uploaded');
    if (r) setW(r);
  };
  return (
    <section className="card">
      <h2>Voice invitation</h2>
      <p className="muted small">A short recorded invitation from the family, played on the wedding page.</p>
      {w.voice ? (
        <>
          <audio controls src={fileUrl(w.voice.url)} preload="none" className="audio" />
          {w.voice.durationSec ? <div className="muted small">{Math.floor(w.voice.durationSec / 60)}:{String(w.voice.durationSec % 60).padStart(2, '0')}</div> : null}
        </>
      ) : (
        <div className="muted small">No recording yet.</div>
      )}
      {editable ? (
        <label className={'btn btn-ghost sm mt' + (act.busy ? ' disabled' : '')}>
          {act.busy ? <span className="spin" /> : null}
          {w.voice ? 'Replace recording' : 'Upload a recording'}
          <input type="file" hidden accept="audio/*" disabled={act.busy} onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      ) : null}
      <ErrorNote>{act.error}</ErrorNote>
    </section>
  );
}

function audioLength(file: File): Promise<number | undefined> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const a = new Audio();
    const done = (v?: number) => {
      URL.revokeObjectURL(url);
      resolve(v);
    };
    a.preload = 'metadata';
    a.onloadedmetadata = () => done(isFinite(a.duration) && a.duration > 0 ? Math.min(600, Math.max(1, Math.round(a.duration))) : undefined);
    a.onerror = () => done(undefined);
    setTimeout(() => done(undefined), 5000);
    a.src = url;
  });
}

const PEOPLE: { id: 'bride' | 'groom' | 'brideFamily' | 'groomFamily'; label: string }[] = [
  { id: 'bride', label: 'Bride' },
  { id: 'groom', label: 'Groom' },
  { id: 'brideFamily', label: 'Bride’s family' },
  { id: 'groomFamily', label: 'Groom’s family' },
];

function PeopleSection({ w, editable, setW }: { w: W; editable: boolean; setW: (w: W) => void }) {
  const act = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  const upload = async (who: string, file?: File) => {
    if (!file) return;
    setBusy(who);
    const fd = new FormData();
    fd.append('file', file);
    const r = await act.run(() => api.upload(`/weddings/${w.id}/photo/${who}`, fd), 'Photo saved');
    setBusy(null);
    if (r) setW(r);
  };
  return (
    <section className="card">
      <h2>Portraits</h2>
      <div className="people">
        {PEOPLE.map((p) => {
          const url = w[p.id]?.photoUrl;
          return (
            <div key={p.id} className="person">
              <div className="portrait">{url ? <img src={fileUrl(url)} alt="" /> : <span>{(w[p.id]?.name ?? '?').slice(0, 1)}</span>}</div>
              <div className="person-name">{w[p.id]?.name}</div>
              <div className="muted small">{p.label}</div>
              {editable ? (
                <label className={'linkish small' + (busy ? ' disabled' : '')}>
                  {busy === p.id ? 'Uploading…' : url ? 'Change photo' : 'Add photo'}
                  <input type="file" hidden accept="image/*" disabled={!!busy} onChange={(e) => { upload(p.id, e.target.files?.[0]); e.target.value = ''; }} />
                </label>
              ) : null}
            </div>
          );
        })}
      </div>
      <ErrorNote>{act.error}</ErrorNote>
    </section>
  );
}

/* ───────────────────────── Access ───────────────────────── */

const ROLE_LABEL: Record<string, string> = { owner: 'Owner', cohost: 'Co-host', giftdesk: 'Gift desk only' };

function AccessTab({ w, editable, setW }: { w: W; editable: boolean; setW: (w: W) => void }) {
  const [v, setV] = useState({ name: '', phone: '', relation: '' });
  const act = useAction();
  const confirm = useConfirm();

  const add = async (e: FormEvent) => {
    e.preventDefault();
    const r = await act.run(() => api.post(`/weddings/${w.id}/access`, { name: v.name.trim(), phone: v.phone.trim(), relation: v.relation.trim() }), `${v.name} can open the console`);
    if (r) {
      setW(r);
      setV({ name: '', phone: '', relation: '' });
    }
  };
  const remove = async (a: any) => {
    if (!(await confirm({ title: `Remove ${a.name}?`, body: 'They can no longer open this wedding’s console.', ok: 'Remove access', danger: true }))) return;
    const r = await act.run(() => api.delete(`/weddings/${w.id}/access/${a.id}`), 'Access removed');
    if (r) setW(r);
  };

  return (
    <div className="grid-main">
      <section className="card flush">
        <div className="card-head pad">
          <h2>Who can open the host console</h2>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Mobile</th>
              <th>Relation</th>
              <th>Role</th>
              {editable ? <th /> : null}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <strong>Host</strong>
              </td>
              <td className="mono">{w.ownerPhonePretty}</td>
              <td className="muted">Owns the wedding</td>
              <td>
                <Pill tone="mag">Owner</Pill>
              </td>
              {editable ? <td className="muted small">Change under Details</td> : null}
            </tr>
            {w.access.map((a: any) => (
              <tr key={a.id}>
                <td>{a.name}</td>
                <td className="mono">{a.phonePretty}</td>
                <td>{a.relation}</td>
                <td>
                  <Pill tone={a.role === 'giftdesk' ? 'warn' : 'info'}>{ROLE_LABEL[a.role] ?? a.role}</Pill>
                </td>
                {editable ? (
                  <td className="row-actions">
                    <Btn small kind="danger" onClick={() => remove(a)}>
                      Remove
                    </Btn>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {!w.access.length ? <div className="pad muted small">Only the host so far. The host can also add family from the app (Family access).</div> : null}
      </section>
      {editable ? (
        <form className="card" onSubmit={add}>
          <h2>Give a family member access</h2>
          <p className="muted small">They get full co-host access. The host can change it to “Gift desk only” from the app.</p>
          <Field label="Name" error={act.fields.name}>
            <input value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required maxLength={60} />
          </Field>
          <Field label="Mobile" error={act.fields.phone}>
            <input inputMode="tel" value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} required />
          </Field>
          <Field label="Relation" error={act.fields.relation}>
            <input value={v.relation} onChange={(e) => setV({ ...v, relation: e.target.value })} required maxLength={40} placeholder="Brother of the bride" />
          </Field>
          <ErrorNote>{act.error}</ErrorNote>
          <div className="row-end">
            <Btn kind="primary" type="submit" busy={act.busy}>
              Give access
            </Btn>
          </div>
        </form>
      ) : null}
    </div>
  );
}

