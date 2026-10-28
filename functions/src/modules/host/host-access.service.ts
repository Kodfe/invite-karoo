import { Injectable } from '@nestjs/common';
import { forbidden, notFound } from '../../common/errors';
import { col } from '../../db/paths';
import { Access, User, Wedding } from '../../db/models';
import { getDoc, getRows } from '../../db/store';

export type HostRole = 'owner' | 'cohost' | 'giftdesk';
/**
 * owner  only the wedding's owner (family access, deleting a recorded gift)
 * full   owner + family with full access (replies, reminders, guest list)
 * desk   anyone with access, including "gift desk only" (scanner, gifts, read-only lists)
 */
export type AccessLevel = 'owner' | 'full' | 'desk';

export type HostCtx = {
  w: Wedding;
  role: HostRole;
  phone: string;
  userId: string;
  name: string;
};

/** who may run a wedding's console: the owner's number, or a family member the owner added */
@Injectable()
export class HostAccessService {
  async require(userId: string, weddingId: string, level: AccessLevel = 'full'): Promise<HostCtx> {
    const [u, w] = await Promise.all([getDoc<User>(col.users().doc(userId)), getDoc<Wedding>(col.weddings().doc(weddingId))]);
    if (!u || u.deletedAt) throw notFound('Account');
    if (!w || !w.handedOverAt || w.status === 'draft') throw notFound('Wedding');
    let role: HostRole | null = w.ownerPhone === u.phone ? 'owner' : null;
    if (!role) {
      const [a] = await getRows<Access>(col.access(w.id).where('phone', '==', u.phone).where('removedAt', '==', null).limit(1));
      if (a) role = a.role;
    }
    if (!role) throw forbidden('You do not have access to this wedding’s console');
    if (level === 'owner' && role !== 'owner') throw forbidden('Only the wedding’s owner can do this');
    if (level === 'full' && role === 'giftdesk') throw forbidden('Your access is for the gift desk only');
    return { w, role, phone: u.phone, userId: u.id, name: `${u.firstName} ${u.familyName}` };
  }
}
