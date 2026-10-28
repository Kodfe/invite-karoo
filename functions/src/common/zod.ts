import { BadRequestException, PipeTransform } from '@nestjs/common';
import { z, ZodType } from 'zod';
import { AppError } from './errors';

/** `@Body(new Zod(schema)) body: z.infer<typeof schema>` — validates and strips unknown keys */
export class Zod<T extends ZodType> implements PipeTransform {
  constructor(private readonly schema: T) {}
  transform(value: unknown): z.infer<T> {
    const r = this.schema.safeParse(value ?? {});
    if (r.success) return r.data;
    const fields: Record<string, string> = {};
    for (const issue of r.error.issues) {
      const key = issue.path.join('.') || '_';
      if (!fields[key]) fields[key] = issue.message;
    }
    throw new AppError('VALIDATION', 'Some fields need attention', 422, fields);
  }
}

/** a Firestore document id */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
export const zId = z.string().regex(ID_RE, 'Not a valid id');
/** @deprecated name kept for older call sites: ids are Firestore ids now */
export const zUuid = zId;

/** `@Param('id', IdPipe)` */
export class IdPipe implements PipeTransform {
  transform(v: string) {
    if (typeof v !== 'string' || !ID_RE.test(v)) throw new BadRequestException('Not a valid id');
    return v;
  }
}
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm (24 hour)');
export const zPage = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
