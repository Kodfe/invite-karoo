import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { api, can } from './api';
import { useAuth } from './auth';
import { LABELS } from './ui';

type Counts = { newApplications: number; openTickets: number };

export function Shell() {
  const { admin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const loc = useLocation();

  useEffect(() => {
    setOpen(false);
  }, [loc.pathname]);
  useEffect(() => {
    api.get<Counts>('/stats').then(setCounts).catch(() => {});
  }, [loc.pathname]);

  const nav = [
    { to: '/', label: 'Overview', end: true },
    { to: '/applications', label: 'Host applications', badge: counts?.newApplications },
    { to: '/weddings', label: 'Weddings' },
    { to: '/tickets', label: 'Support', badge: counts?.openTickets },
    { to: '/users', label: 'Users' },
    { to: '/lookup', label: 'Phone lookup' },
    ...(can(admin?.role, 'admin') ? [{ to: '/team', label: 'Team' }] : []),
  ];

  return (
    <div className={'shell' + (open ? ' nav-open' : '')}>
      <aside className="side">
        <div className="brand">
          <img src={`${import.meta.env.BASE_URL}logo.png`} alt="" width={34} height={34} />
          <div>
            <div className="brand-name">Invite Karoo</div>
            <div className="brand-sub">Team console</div>
          </div>
        </div>
        <nav>
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'nav' + (isActive ? ' on' : '')}>
              <span>{n.label}</span>
              {n.badge ? <span className="badge">{n.badge}</span> : null}
            </NavLink>
          ))}
        </nav>
        <div className="me">
          <NavLink to="/account" className="me-name">
            {admin?.name}
            <span>
              {admin?.email} · {LABELS[admin?.role ?? '']}
            </span>
          </NavLink>
          <button className="linkish" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="topbar">
          <button className="burger" aria-label="Menu" onClick={() => setOpen((v) => !v)}>
            ☰
          </button>
          <span className="brand-name">Invite Karoo</span>
        </div>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <div className="side-scrim" onClick={() => setOpen(false)} />
    </div>
  );
}
