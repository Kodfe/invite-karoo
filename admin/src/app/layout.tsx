import type { Metadata, Viewport } from 'next';
import { ReactNode } from 'react';
import { Providers } from './providers';
import '../styles.css';

export const metadata: Metadata = {
  title: 'Invite Karoo Admin',
  description: 'Invite Karoo team console',
  robots: { index: false, follow: false },
  icons: { icon: '/logo.png' },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#14082B' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
