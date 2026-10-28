import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { getStorage } from 'firebase-admin/storage';
import { env } from '../../config/env';
import { AppError } from '../../common/errors';
import { firebaseApp } from './firebase';

export type Stored = { key: string; url: string; name: string; size: number; contentType: string };

const ALLOWED: Record<string, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
  pdf: ['application/pdf'],
  audio: ['audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/wav', 'audio/ogg', 'audio/webm'],
  video: ['video/mp4', 'video/quicktime'],
  sheet: [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/xml',
    'text/xml',
    'application/octet-stream',
  ],
};
const LIMIT_MB: Record<string, number> = { image: 10, pdf: 15, audio: 20, video: 60, sheet: 10 };

/**
 * Files live under keys like `weddings/<id>/cover/<uuid>.jpg`.
 *   local     ./uploads, served at /files/<key> (development)
 *   firebase  Firebase Storage, served by an unguessable download-token URL
 */
@Injectable()
export class StorageService {
  check(kind: keyof typeof ALLOWED, file: { mimetype: string; size: number; originalname: string }) {
    const okType = ALLOWED[kind].includes(file.mimetype) || (kind === 'sheet' && /\.(xlsx?|csv|xml)$/i.test(file.originalname));
    if (!okType) throw new AppError('BAD_FILE_TYPE', `That file type is not allowed here (${file.mimetype})`, 415);
    if (file.size > LIMIT_MB[kind] * 1024 * 1024) throw new AppError('FILE_TOO_LARGE', `Files here can be at most ${LIMIT_MB[kind]} MB`, 413);
  }

  async put(folder: string, file: { buffer: Buffer; mimetype: string; originalname: string; size: number }): Promise<Stored> {
    const ext = path.extname(file.originalname).toLowerCase().replace(/[^.a-z0-9]/g, '') || '';
    const key = `${folder.replace(/^\/|\/$/g, '')}/${randomUUID()}${ext}`;
    const e = env();
    if (e.STORAGE_DRIVER === 'firebase') {
      const app = firebaseApp();
      if (!app) throw new AppError('STORAGE_NOT_CONFIGURED', 'File storage is not configured', 500);
      const token = randomUUID();
      const bucket = getStorage(app).bucket();
      await bucket.file(key).save(file.buffer, {
        contentType: file.mimetype,
        metadata: { metadata: { firebaseStorageDownloadTokens: token } },
        resumable: false,
      });
      const url = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(key)}?alt=media&token=${token}`;
      return { key, url, name: file.originalname, size: file.size, contentType: file.mimetype };
    }
    const full = path.resolve(e.UPLOAD_DIR, key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, file.buffer);
    return { key, url: `${e.PUBLIC_URL}/files/${key}`, name: file.originalname, size: file.size, contentType: file.mimetype };
  }

  async read(key: string): Promise<Buffer> {
    if (env().STORAGE_DRIVER === 'firebase') {
      const app = firebaseApp();
      if (!app) throw new AppError('STORAGE_NOT_CONFIGURED', 'File storage is not configured', 500);
      const [buf] = await getStorage(app).bucket().file(key).download();
      return buf;
    }
    return readFile(path.resolve(env().UPLOAD_DIR, key));
  }

  async remove(key: string) {
    try {
      if (env().STORAGE_DRIVER === 'firebase') {
        const app = firebaseApp();
        if (app) await getStorage(app).bucket().file(key).delete({ ignoreNotFound: true });
      } else {
        await unlink(path.resolve(env().UPLOAD_DIR, key));
      }
    } catch {
      /* already gone */
    }
  }
}
