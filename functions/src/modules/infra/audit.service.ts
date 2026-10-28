import { Injectable } from '@nestjs/common';
import { col } from '../../db/paths';
import { F } from '../../db/store';

@Injectable()
export class AuditService {
  async log(actor: { type: 'user' | 'admin' | 'system'; id?: string | null }, action: string, weddingId: string | null, data?: Record<string, unknown>) {
    await col.auditLog().doc().set({ actorType: actor.type, actorId: actor.id ?? null, action, weddingId, data: data ?? null, createdAt: F.now() });
  }
}
