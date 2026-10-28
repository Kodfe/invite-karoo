'use client';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { ReactNode, useEffect, useState } from 'react';
import { api, can } from './api';
import { useAuth } from './auth';
import { LABELS } from './ui';

type Counts = { newApplications: number; openTickets: number };

/** the signed-in frame: sidebar (a drawer on phones) + the page */
export function Shell({ children }: { children: ReactNode }) {
  const { admin, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [counts, setCounts] = useState<Counts | null>(null);
  const path = usePathname() || '/';

  useEffect(() => {
    setOpen(false);
  }, [path]);
  useEffect(() => {
    api.get<Counts>('/stats').then(setCounts).catch(() => {});
  }, [path]);

  const nav = [
    { to: '/', label: 'Overview', end: true },
    { to: '/applications/', label: 'Host applications', badge: counts?.newApplications },
    { to: '/weddings/', label: 'Weddings' },
    { to: '/support/', label: 'Support', badge: counts?.openTickets },
    { to: '/users/', label: 'Users' },
    { to: '/lookup/', label: 'Phone lookup' },
    ...(can(admin?.role, 'admin') ? [{ to: '/team/', label: 'Team' }] : []),
  ];
  const isOn = (to: string, end?: boolean) => (end ? path === to : path === to || path.startsWith(to));

  return (
    <div className={'shell' + (open ? ' nav-open' : '')}>
      <aside className="side">
        <div className="brand">
          <img src="/logo.png" alt="" width={34} height={34} />
          <div>
            <div className="brand-name">Invite Karoo</div>
            <div className="brand-sub">Team console</div>
          </div>
        </div>
        <nav>
          {nav.map((n) => (
            <NextLink key={n.to} href={n.to} className={'nav' + (isOn(n.to, n.end) ? ' on' : '')} aria-current={isOn(n.to, n.end) ? 'page' : undefined}>
              <span>{n.label}</span>
              {n.badge ? <span className="badge">{n.badge}</span> : null}
            </NextLink>
          ))}
        </nav>
        <div className="me">
          <NextLink href="/account/" className={'me-name' + (path.startsWith('/account') ? ' on' : '')}>
            {admin?.name}
            <span>
              {admin?.email} · {LABELS[admin?.role ?? '']}
            </span>
          </NextLink>
          <button className="linkish" onClick={() => void logout()}>
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
        <main className="content">{children}</main>
      </div>
      <div className="side-scrim" onClick={() => setOpen(false)} />
    </div>
  );
}
