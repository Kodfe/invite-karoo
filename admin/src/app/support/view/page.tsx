'use client';
import { Suspense } from 'react';
import { TicketPage } from '../../../screens/Tickets';
import { Loading } from '../../../ui';

// one static page; the id comes from ?id=… (the site is a static export)
export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <TicketPage />
    </Suspense>
  );
}
