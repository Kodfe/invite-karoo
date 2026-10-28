import 'dotenv/config';
import 'reflect-metadata';
import fs from 'node:fs';
import path from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { env } from './config/env';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/errors';
import { runMigrations } from './db/migrate';

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: env().NODE_ENV === 'test' ? false : ['error', 'warn', 'log'],
  });
  app.set('trust proxy', 1);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'cross-origin' },
      // the API itself sends JSON; the policy matters for the Admin Dashboard served at /admin
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'data:'],
          imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
          mediaSrc: ["'self'", 'blob:', 'https:'],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: env().NODE_ENV === 'production' ? [] : null,
        },
      },
    }),
  );
  app.enableCors({ origin: env().CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean), credentials: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();
  if (env().STORAGE_DRIVER === 'local') {
    app.useStaticAssets(path.resolve(env().UPLOAD_DIR), { prefix: '/files/', index: false, dotfiles: 'deny' });
  }
  serveAdmin(app);
  if (env().NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Invite Karoo API').setVersion('1.0').addBearerAuth().build(),
    );
    SwaggerModule.setup('docs', app, doc);
  }
  return app;
}

/** The Admin Dashboard is a static single-page app (hash routing), built from admin/ into ADMIN_DIR. */
function serveAdmin(app: NestExpressApplication) {
  const dir = path.resolve(env().ADMIN_DIR);
  if (!fs.existsSync(path.join(dir, 'index.html'))) return;
  app.useStaticAssets(dir, {
    prefix: '/admin/',
    index: 'index.html',
    dotfiles: 'deny',
    // hashed bundles can be cached for good; index.html must always be fresh
    setHeaders: (res, file) => res.setHeader('Cache-Control', file.endsWith('index.html') ? 'no-cache' : file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'),
  });
  const http = app.getHttpAdapter().getInstance();
  http.get('/', (_req: unknown, res: { redirect: (code: number, url: string) => void }) => res.redirect(302, '/admin/'));
  http.get('/admin', (_req: unknown, res: { redirect: (code: number, url: string) => void }) => res.redirect(301, '/admin/'));
}

async function bootstrap() {
  // migrations run on every start, so a deploy never serves an old schema
  await runMigrations();
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
