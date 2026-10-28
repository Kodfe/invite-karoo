import type { AuthBackend } from './types';
import { authBackend } from './impl';

// `./impl` is Firebase Auth. Only a build with NEXT_PUBLIC_AUTH_MOCK=1 swaps it for ./mock
// (see next.config.ts), so production bundles never contain the fake sign-in.
export const backend: AuthBackend = authBackend;
