import type { AuthBackend } from './types';
import { authBackend } from './impl';

export const backend: AuthBackend = authBackend;
