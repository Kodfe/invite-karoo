import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { env } from '../config/env';
import { forbidden } from './errors';

export type UserClaims = { sub: string; phone: string; typ: 'user' };
export type AdminClaims = { sub: string; email: string; role: 'admin' | 'setup' | 'support'; typ: 'admin' };

const jwt = new JwtService();

export function signUserAccess(c: Omit<UserClaims, 'typ'>) {
  return jwt.sign({ ...c, typ: 'user' }, { secret: env().JWT_ACCESS_SECRET, expiresIn: env().ACCESS_TOKEN_TTL as never });
}
export function signAdmin(c: Omit<AdminClaims, 'typ'>) {
  return jwt.sign({ ...c, typ: 'admin' }, { secret: env().JWT_ADMIN_SECRET, expiresIn: '12h' });
}

function bearer(ctx: ExecutionContext): string | null {
  const h = ctx.switchToHttp().getRequest().headers?.authorization as string | undefined;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7);
}

@Injectable()
export class UserGuard implements CanActivate {
  canActivate(ctx: ExecutionContext) {
    const token = bearer(ctx);
    if (!token) throw new UnauthorizedException('Sign in to continue');
    try {
      const claims = jwt.verify<UserClaims>(token, { secret: env().JWT_ACCESS_SECRET });
      if (claims.typ !== 'user') throw new Error('wrong token type');
      ctx.switchToHttp().getRequest().user = claims;
      return true;
    } catch {
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }
  }
}

export const ADMIN_ROLES = 'admin_roles';
/** restrict an admin route: @AdminRoles('admin') — no decorator = every admin role */
export const AdminRoles = (...roles: AdminClaims['role'][]) => SetMetadata(ADMIN_ROLES, roles);

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}
  canActivate(ctx: ExecutionContext) {
    const token = bearer(ctx);
    if (!token) throw new UnauthorizedException('Sign in to continue');
    let claims: AdminClaims;
    try {
      claims = jwt.verify<AdminClaims>(token, { secret: env().JWT_ADMIN_SECRET });
      if (claims.typ !== 'admin') throw new Error('wrong token type');
    } catch {
      throw new UnauthorizedException('Your session has expired. Sign in again.');
    }
    const roles = this.reflector.getAllAndOverride<string[]>(ADMIN_ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length && claims.role !== 'admin' && !roles.includes(claims.role)) throw forbidden();
    ctx.switchToHttp().getRequest().admin = claims;
    return true;
  }
}

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): UserClaims => {
  return ctx.switchToHttp().getRequest().user;
});
export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminClaims => {
  return ctx.switchToHttp().getRequest().admin;
});
