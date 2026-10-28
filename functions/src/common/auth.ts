import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AppError, forbidden } from './errors';
import { auth } from './firebase-auth';

/** an app user, from their Firebase ID token (uid = users/{uid}) */
export type UserClaims = { sub: string; phone: string };
/** a team member, from their Firebase ID token (custom claim ikRole) */
export type AdminClaims = { sub: string; email: string; role: 'admin' | 'setup' | 'support' };

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

export const ADMIN_ROLES = 'admin_roles';
/** restrict an admin route: @AdminRoles('admin') — no decorator = every team role */
export const AdminRoles = (...roles: AdminClaims['role'][]) => SetMetadata(ADMIN_ROLES, roles);

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext) {
    const token = bearer(ctx);
    if (!token) throw new UnauthorizedException('Sign in to continue');
    let c;
    try {
      // revocation is checked for the team: switching an account off takes effect at once
      c = await auth().verifyIdToken(token, true);
    } catch {
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }
    if (!c.ikRole) throw new AppError('NOT_TEAM', 'This account is not on the Invite Karoo team', 403);
    const roles = this.reflector.getAllAndOverride<string[]>(ADMIN_ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && c.ikRole !== 'admin' && !roles.includes(c.ikRole)) throw forbidden();
    ctx.switchToHttp().getRequest().admin = { sub: c.uid, email: c.email ?? '', role: c.ikRole } satisfies AdminClaims;
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): UserClaims => {
  return ctx.switchToHttp().getRequest().user;
});
export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminClaims => {
  return ctx.switchToHttp().getRequest().admin;
});
