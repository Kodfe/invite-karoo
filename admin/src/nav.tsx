'use client';
/*
 * The screens were written with app-style paths (/weddings/<id>/guests, /tickets/<id>, …).
 * The site is a static export, so pages with an id are one static page each that reads the id
 * from the query string. `href()` turns the app-style path into the real URL.
 */
import NextLink from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ComponentProps, ReactNode, useCallback } from 'react';

const q = (params: Record<string, string | undefined>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) s.set(k, v);
  const t = s.toString();
  return t ? `?${t}` : '';
};

/** state = extra values the target page reads (e.g. a phone number to look up) */
export function href(to: string, state?: Record<string, string | undefined>): string {
  const [path, hash = ''] = to.split('#');
  const parts = path.split('/').filter(Boolean);
  const extra = state ?? {};
  let out: string;
  if (parts[0] === 'weddings' && parts[1] && parts[1] !== 'view') out = `/weddings/view/${q({ id: parts[1], tab: parts[2], ...extra })}`;
  else if (parts[0] === 'applications' && parts[1] && parts[1] !== 'view') out = `/applications/view/${q({ id: parts[1], ...extra })}`;
  else if ((parts[0] === 'tickets' || parts[0] === 'support') && parts[1] && parts[1] !== 'view') out = `/support/view/${q({ id: parts[1], ...extra })}`;
  else if (parts[0] === 'tickets') out = `/support/${q(extra)}`;
  else out = (parts.length ? `/${parts.join('/')}/` : '/') + q(extra);
  return hash ? `${out}#${hash}` : out;
}

type LinkProps = Omit<ComponentProps<typeof NextLink>, 'href'> & { to: string; state?: Record<string, string | undefined>; children?: ReactNode };

export function Link({ to, state, ...rest }: LinkProps) {
  return <NextLink href={href(to, state)} {...rest} />;
}

export function useNavigate() {
  const router = useRouter();
  return useCallback(
    (to: string, opts?: { replace?: boolean; state?: Record<string, string | undefined> }) => {
      const url = href(to, opts?.state);
      if (opts?.replace) router.replace(url, { scroll: false });
      else router.push(url);
    },
    [router],
  );
}

/** the query-string value of a static "view" page (empty string when missing) */
export function useQueryParam(name: string): string {
  return useSearchParams().get(name) ?? '';
}
