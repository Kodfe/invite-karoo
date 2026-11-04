import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { auth } from './firebase-auth';

/** an app user, from their Firebase ID token (uid = users/{uid}) */
export type UserClaims = { sub: string; phone: string };

function bearer(ctx: ExecutionContext): string | null {
  const h = ctx.switchToHttp().getRequest().headers?.authorization as string | undefined;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7);
}

@Injectable()
export class UserGuard implements CanActivate {
  async canActivate(ctx: ExecutionContext) {
    const token = bearer(ctx);
    if (!token) throw new UnauthorizedException('Sign in to continue');
    let c;
    try {
      c = await auth().verifyIdToken(token);
    } catch {
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }
    if (!c.phone) throw new UnauthorizedException('Sign in with your mobile number to continue');
    ctx.switchToHttp().getRequest().user = { sub: c.uid, phone: c.phone } satisfies UserClaims;
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): UserClaims => {
  return ctx.switchToHttp().getRequest().user;
});
