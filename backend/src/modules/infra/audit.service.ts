import { Injectable } from '@nestjs/common';
import { DB, DbOrTx, InjectDb } from '../../db/db';
import { auditLog } from '../../db/schema';

@Injectable()
export class AuditService {
  constructor(@InjectDb() private readonly db: DB) {}

  async log(
    actor: { type: 'user' | 'admin' | 'system'; id?: string | null },
    action: string,
    weddingId: string | null,
    data?: Record<string, unknown>,
    db: DbOrTx = this.db,
  ) {
    await db.insert(auditLog).values({ actorType: actor.type, actorId: actor.id ?? null, action, weddingId, data });
  }
}
