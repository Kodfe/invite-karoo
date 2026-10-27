import 'dotenv/config';
import 'reflect-metadata';
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
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({ origin: env().CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean), credentials: false });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useBodyParser('json', { limit: '1mb' });
  app.enableShutdownHooks();
  if (env().STORAGE_DRIVER === 'local') {
    app.useStaticAssets(path.resolve(env().UPLOAD_DIR), { prefix: '/files/', index: false, dotfiles: 'deny' });
  }
  if (env().NODE_ENV !== 'production') {
    const doc = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('Invite Karoo API').setVersion('1.0').addBearerAuth().build(),
    );
    SwaggerModule.setup('docs', app, doc);
  }
  return app;
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
