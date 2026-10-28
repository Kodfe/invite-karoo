import 'dotenv/config';
import 'reflect-metadata';
import path from 'node:path';
import { Readable } from 'node:stream';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { env } from './config/env';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors';

/**
 * Builds the API. `onFunctions` is set inside Cloud Functions, where the platform has already read
 * and parsed the request body (req.body / req.rawBody).
 */
export async function createApp(opts: { onFunctions?: boolean } = {}) {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: env().NODE_ENV === 'test' ? false : ['error', 'warn', 'log'],
    bodyParser: !opts.onFunctions,
  });
  app.set('trust proxy', 1);
  if (opts.onFunctions) {
    // multer (file uploads) reads the request as a stream, but Cloud Functions has consumed it:
    // hand multer the bytes the platform kept in req.rawBody
    app.use((req: Request & { rawBody?: Buffer }, _res: Response, next: NextFunction) => {
      if (req.rawBody && /^multipart\//i.test(req.headers['content-type'] ?? '')) {
        const body = Readable.from([req.rawBody]);
        const r = req as unknown as { pipe: (d: NodeJS.WritableStream) => unknown; unpipe: (d?: NodeJS.WritableStream) => unknown };
        r.pipe = (dest) => body.pipe(dest);
        r.unpipe = (dest) => body.unpipe(dest);
      }
      next();
    });
  }
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({ origin: env().CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean), credentials: false, maxAge: 3600 });
  app.useGlobalFilters(new AllExceptionsFilter());
  if (!opts.onFunctions) app.useBodyParser('json', { limit: '1mb' });
  if (env().STORAGE_DRIVER === 'local') {
    app.useStaticAssets(path.resolve(env().UPLOAD_DIR), { prefix: '/files/', index: false, dotfiles: 'deny' });
  }
  if (env().NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Invite Karoo API').setVersion('1.0').addBearerAuth().build());
    SwaggerModule.setup('docs', app, doc);
  }
  return app;
}

/** local run outside Cloud Functions: npm run dev */
async function bootstrap() {
  const app = await createApp();
  await app.listen(env().PORT, '0.0.0.0');
  new Logger('Boot').log(`Invite Karoo API on :${env().PORT} (${env().NODE_ENV})`);
}

if (require.main === module) {
  bootstrap().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
