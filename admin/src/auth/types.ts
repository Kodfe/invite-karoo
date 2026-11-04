/** What the dashboard needs from a sign-in provider. Firebase Auth in real builds. */
export type AuthUser = { email: string | null };

export interface AuthBackend {
  /** fires once with the restored user (or null), then on every sign-in / sign-out */
  onChange(cb: (user: AuthUser | null) => void): () => void;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  resetPassword(email: string): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
}

/** a sign-in problem with a message fit for the screen */
export class AuthError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}
