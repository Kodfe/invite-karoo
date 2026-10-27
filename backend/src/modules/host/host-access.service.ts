import { Injectable } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { DB, InjectDb } from '../../db/db';
import { users, weddingAccess, weddings } from '../../db/schema';
import { forbidden, notFound } from '../../common/errors';

export type HostRole = 'owner' | 'cohost' | 'giftdesk';
/**
 * owner  only the wedding's owner (family access, deleting a recorded gift)
 * full   owner + family with full access (replies, reminders, guest list)
 * desk   anyone with access, including "gift desk only" (scanner, gifts, read-only lists)
 */
export type AccessLevel = 'owner' | 'full' | 'desk';

export type HostCtx = {
  w: typeof weddings.$inferSelect;
  role: HostRole;
  phone: string;
  userId: string;
  name: string;
};

/** who may run a wedding's console: the owner's number, or a family member the owner added */
@Injectable()
export class HostAccessService {
  constructor(@InjectDb() private readonly db: DB) {}

  async require(userId: string, weddingId: string, level: AccessLevel = 'full'): Promise<HostCtx> {
    const [u] = await this.db.select().from(users).where(and(eq(users.id, userId), isNull(users.deletedAt))).limit(1);
    if (!u) throw notFound('Account');
    const [w] = await this.db.select().from(weddings).where(eq(weddings.id, weddingId)).limit(1);
    if (!w || !w.handedOverAt || w.status === 'draft') throw notFound('Wedding');
    let role: HostRole | null = w.ownerPhone === u.phone ? 'owner' : null;
    if (!role) {
      const [a] = await this.db
        .select()
        .from(weddingAccess)
        .where(and(eq(weddingAccess.weddingId, w.id), eq(weddingAccess.phone, u.phone), isNull(weddingAccess.removedAt)))
        .limit(1);
      if (a) role = a.role;
    }
    if (!role) throw forbidden('You do not have access to this wedding’s console');
    if (level === 'owner' && role !== 'owner') throw forbidden('Only the wedding’s owner can do this');
    if (level === 'full' && role === 'giftdesk') throw forbidden('Your access is for the gift desk only');
    return { w, role, phone: u.phone, userId: u.id, name: `${u.firstName} ${u.familyName}` };
  }
}
