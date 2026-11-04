import type { NextConfig } from 'next';

// A fully static site (no server): `next build` writes it to ./out, which Firebase Hosting
// serves at https://admin.invitekaroo.com. All data comes from Firebase, in the browser.
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
};

export default config;
