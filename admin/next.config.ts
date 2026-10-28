import path from 'node:path';
import type { NextConfig } from 'next';

const MOCK = process.env.NEXT_PUBLIC_AUTH_MOCK === '1';

// A fully static site (no server): `next build` writes it to ./out, which Firebase Hosting
// serves at https://admin.invitekaroo.com. All data comes from the API in the browser.
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  webpack(cfg, { webpack }) {
    if (MOCK) {
      // UI-test builds only: replace Firebase sign-in with a fake one
      const authDir = path.join(__dirname, 'src', 'auth');
      cfg.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^\.\/impl$/, (res: { context: string; request: string }) => {
          if (path.resolve(res.context) === authDir) res.request = './mock';
        }),
      );
    }
    return cfg;
  },
};

export default config;
