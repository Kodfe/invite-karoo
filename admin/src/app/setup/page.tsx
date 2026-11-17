'use client';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Signed out, the gate shows the setup form here (providers.tsx). Signed in, there is nothing to set up. */
export default function Page() {
  const router = useRouter();
  useEffect(() => router.replace('/'), [router]);
  return null;
}
