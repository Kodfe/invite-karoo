// Shared bits for the screens. The data itself is in ./data.
export type Json = Record<string, any>;
export type Role = 'admin' | 'setup' | 'support';

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number = 400, public fields?: Record<string, string>) {
    super(message);
  }
}

export const fileUrl = (u: string | null | undefined) => u ?? '';

export function can(role: Role | undefined, need: 'setup' | 'admin' | 'any'): boolean {
  if (!role) return false;
  if (role === 'admin' || need === 'any') return true;
  return role === need;
}
