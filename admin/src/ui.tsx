'use client';
import { createContext, ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

/* ───────── data loading ───────── */

export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const seq = useRef(0);
  const reload = useCallback(async () => {
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await fn();
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(msg(e));
    } finally {
      if (n === seq.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    reload();
  }, [reload]);
  return { data, error, loading, reload, setData };
}

export const msg = (e: unknown) => (e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Something went wrong');
export const fieldsOf = (e: unknown) => (e instanceof ApiError ? e.fields ?? {} : {});

/** runs an action, toasts on success, keeps the error for inline display */
export function useAction() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
      setBusy(true);
      setError(null);
      setFields({});
      try {
        const r = await fn();
        if (ok) toast(ok);
        return r;
      } catch (e) {
        setError(msg(e));
        setFields(fieldsOf(e));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );
  return { run, busy, error, fields, setError };
}

/* ───────── toast ───────── */

const ToastCtx = createContext<(m: string, bad?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastHost({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<{ id: number; m: string; bad?: boolean }[]>([]);
  const show = useCallback((m: string, bad?: boolean) => {
    const id = Date.now() + Math.random();
    setItems((x) => [...x, { id, m, bad }]);
    setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), 3200);
  }, []);
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={'toast' + (t.bad ? ' bad' : '')}>
            {t.m}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

/* ───────── building blocks ───────── */

type BtnKind = 'primary' | 'ghost' | 'danger' | 'gold' | 'plain';
export function Btn({
  kind = 'ghost',
  small,
  busy,
  children,
  ...rest
}: { kind?: BtnKind; small?: boolean; busy?: boolean } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" {...rest} disabled={rest.disabled || busy} className={`btn btn-${kind}${small ? ' sm' : ''} ${rest.className ?? ''}`}>
      {busy ? <span className="spin" aria-hidden /> : null}
      {children}
    </button>
  );
}

export function Field({ label, error, hint, children, wide }: { label: string; error?: string; hint?: string; children: ReactNode; wide?: boolean }) {
  return (
    <label className={'field' + (wide ? ' wide' : '') + (error ? ' has-err' : '')}>
      <span className="field-label">{label}</span>
      {children}
      {error ? <span className="field-err">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function ErrorNote({ children }: { children?: ReactNode }) {
  if (!children) return null;
  return (
    <div className="note bad" role="alert">
      {children}
    </div>
  );
}

export function Note({ tone = 'info', children }: { tone?: 'info' | 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  return <div className={'note ' + tone}>{children}</div>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="loading">
      <span className="spin" aria-hidden /> {label}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-title">{title}</div>
      {children ? <div className="empty-body">{children}</div> : null}
    </div>
  );
}

const TONES: Record<string, string> = {
  new: 'info',
  in_setup: 'warn',
  live: 'ok',
  rejected: 'bad',
  draft: 'muted',
  active: 'ok',
  paused: 'warn',
  ended: 'muted',
  open: 'info',
  answered: 'ok',
  closed: 'muted',
  going: 'ok',
  maybe: 'warn',
  not_going: 'bad',
  none: 'muted',
  admin: 'mag',
  setup: 'info',
  support: 'warn',
  sent: 'ok',
  queued: 'info',
  sending: 'info',
  failed: 'bad',
};
export const LABELS: Record<string, string> = {
  new: 'New',
  in_setup: 'In setup',
  live: 'Live',
  rejected: 'Rejected',
  draft: 'Draft',
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
  open: 'Open',
  answered: 'Answered',
  closed: 'Closed',
  going: 'Going',
  maybe: 'Maybe',
  not_going: 'Not going',
  none: 'No reply',
  admin: 'Admin',
  setup: 'Setup',
  support: 'Support',
  sent: 'Sent',
  queued: 'Queued',
  sending: 'Sending',
  failed: 'Failed',
};
export function Pill({ v, tone, children }: { v?: string; tone?: string; children?: ReactNode }) {
  return <span className={'pill ' + (tone ?? TONES[v ?? ''] ?? 'muted')}>{children ?? LABELS[v ?? ''] ?? v}</span>;
}

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={'modal' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

/** a yes/no dialog driven by a promise: `if (await confirm({...})) ...` */
type ConfirmOpts = { title: string; body: ReactNode; ok?: string; danger?: boolean };
const ConfirmCtx = createContext<(o: ConfirmOpts) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmCtx);
export function ConfirmHost({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOpts & { resolve: (v: boolean) => void }) | null>(null);
  const ask = useCallback((o: ConfirmOpts) => new Promise<boolean>((resolve) => setState({ ...o, resolve })), []);
  const done = (v: boolean) => {
    state?.resolve(v);
    setState(null);
  };
  return (
    <ConfirmCtx.Provider value={ask}>
      {children}
      {state ? (
        <Modal
          title={state.title}
          onClose={() => done(false)}
          footer={
            <>
              <Btn onClick={() => done(false)}>Cancel</Btn>
              <Btn kind={state.danger ? 'danger' : 'primary'} onClick={() => done(true)}>
                {state.ok ?? 'Confirm'}
              </Btn>
            </>
          }
        >
          <div className="confirm-body">{state.body}</div>
        </Modal>
      ) : null}
    </ConfirmCtx.Provider>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: string; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} className={'tab' + (value === t.id ? ' on' : '')} onClick={() => onChange(t.id)}>
          {t.label}
          {t.count !== undefined ? <span className="tab-n">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Pager({ total, limit, offset, onChange }: { total: number; limit: number; offset: number; onChange: (offset: number) => void }) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="pager">
      <Btn small disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        ← Previous
      </Btn>
      <span>
        Page {page} of {pages} · {total} in all
      </span>
      <Btn small disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        Next →
      </Btn>
    </div>
  );
}

export function PageHead({ title, sub, actions, back }: { title: string; sub?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        {back}
        <h1>{title}</h1>
        {sub ? <div className="page-sub">{sub}</div> : null}
      </div>
      {actions ? <div className="page-actions">{actions}</div> : null}
    </header>
  );
}

export function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

/* ───────── formatting ───────── */

const dfmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const dtfmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
export const fmtDay = (s?: string | null) => {
  if (!s) return '—';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(s + 'T00:00:00') : new Date(s);
  return isNaN(d.getTime()) ? s : dfmt.format(d);
};
export const fmtWhen = (s?: string | null) => (s ? dtfmt.format(new Date(s)) : '—');
export const fmtRange = (a?: string, b?: string) => (a && b && a !== b ? `${fmtDay(a)} – ${fmtDay(b)}` : fmtDay(a));
export const fmtSize = (n?: number) => (!n ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);
/** "19:30" → "7:30 PM" */
export function clock(hhmm?: string | null) {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return hhmm ?? '';
  const h = Number(m[1]);
  return `${((h + 11) % 12) + 1}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}
export function ago(s?: string | null) {
  if (!s) return '—';
  const m = Math.round((Date.now() - new Date(s).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d} d ago` : fmtDay(s);
}
