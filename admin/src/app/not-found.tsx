'use client';
import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="empty">
      <div className="empty-title">This page does not exist</div>
      <Link href="/">Go to the overview →</Link>
    </div>
  );
}
