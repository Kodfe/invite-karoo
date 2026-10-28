'use client';
import { Suspense } from 'react';
import { LookupPage } from '../../screens/Lookup';
import { Loading } from '../../ui';

export default function Page() {
  return (
    <Suspense fallback={<Loading />}>
      <LookupPage />
    </Suspense>
  );
}
