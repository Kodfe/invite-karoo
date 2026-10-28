import { Link } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../auth';
import { ago, Empty, ErrorNote, fmtRange, Loading, PageHead, Pill, useLoad } from '../ui';

type Stats = { users: number; newUsers7d: number; weddings: number; liveWeddings: number; guests: number; newApplications: number; openTickets: number; replies7d: number };

export function OverviewPage() {
  const { admin } = useAuth();
  const stats = useLoad(() => api.get<Stats>('/stats'), []);
  const apps = useLoad(() => api.get('/applications', { status: 'new', limit: 5 }), []);
  const tickets = useLoad(() => api.get('/tickets', { status: 'open', limit: 5 }), []);
  const soon = useLoad(() => api.get('/weddings', { limit: 6 }), []);
  const s = stats.data;

  return (
    <>
      <PageHead title={`Namaste, ${admin?.name.split(' ')[0] ?? ''}`} sub="What needs the team today" />
      <ErrorNote>{stats.error}</ErrorNote>
      {!s ? (
        <Loading />
      ) : (
        <div className="tiles">
          <Tile to="/applications" n={s.newApplications} label="New host applications" hot={s.newApplications > 0} />
          <Tile to="/tickets" n={s.openTickets} label="Open support tickets" hot={s.openTickets > 0} />
          <Tile to="/weddings" n={s.liveWeddings} label={`Live weddings · ${s.weddings} in all`} />
          <Tile n={s.guests} label="Guests on live lists" />
          <Tile to="/users" n={s.users} label={`App users · +${s.newUsers7d} this week`} />
          <Tile n={s.replies7d} label="RSVP replies this week" />
        </div>
      )}

      <div className="grid2">
        <section className="card">
          <div className="card-head">
            <h2>New applications</h2>
            <Link to="/applications">All →</Link>
          </div>
          {apps.loading ? (
            <Loading />
          ) : !apps.data?.items.length ? (
            <Empty title="Nothing waiting">New “Host a wedding” forms from the app land here.</Empty>
          ) : (
            <ul className="list">
              {apps.data.items.map((a: any) => (
                <li key={a.id}>
                  <Link to={`/applications/${a.id}`} className="list-row">
                    <div>
                      <strong>
                        {a.data.brideName} & {a.data.groomName}
                      </strong>
                      <span className="muted">
                        {a.data.city} · {fmtRange(a.data.startDate, a.data.endDate)}
                      </span>
                    </div>
                    <span className="muted small">{ago(a.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="card-head">
            <h2>Open tickets</h2>
            <Link to="/tickets">All →</Link>
          </div>
          {tickets.loading ? (
            <Loading />
          ) : !tickets.data?.items.length ? (
            <Empty title="Inbox clear">No one is waiting on the team.</Empty>
          ) : (
            <ul className="list">
              {tickets.data.items.map((t: any) => (
                <li key={t.id}>
                  <Link to={`/tickets/${t.id}`} className="list-row">
                    <div>
                      <strong>{t.subject}</strong>
                      <span className="muted">
                        {t.number} · {t.user.name} · {t.category}
                      </span>
                    </div>
                    <span className="muted small">
                      {t.unreadForTeam ? <span className="badge">{t.unreadForTeam}</span> : null} {ago(t.updatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section className="card">
        <div className="card-head">
          <h2>Weddings</h2>
          <Link to="/weddings">All →</Link>
        </div>
        {soon.loading ? (
          <Loading />
        ) : !soon.data?.items.length ? (
          <Empty title="No weddings yet">Create one from an application, or from Weddings → New wedding.</Empty>
        ) : (
          <ul className="list">
            {soon.data.items.map((w: any) => (
              <li key={w.id}>
                <Link to={`/weddings/${w.id}`} className="list-row">
                  <div>
                    <strong>{w.couple}</strong>
                    <span className="muted">
                      {w.city} · {fmtRange(w.startDate, w.endDate)} · {w.functions} functions · {w.guests} guests
                    </span>
                  </div>
                  <Pill v={w.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Tile({ n, label, to, hot }: { n: number; label: string; to?: string; hot?: boolean }) {
  const body = (
    <>
      <div className="tile-n">{n.toLocaleString('en-IN')}</div>
      <div className="tile-l">{label}</div>
    </>
  );
  return to ? (
    <Link to={to} className={'tile' + (hot ? ' hot' : '')}>
      {body}
    </Link>
  ) : (
    <div className="tile">{body}</div>
  );
}
