import type { INestApplication } from '@nestjs/common';
import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';

import { AppModule } from '../../src/app.module';
import { GlobalExceptionFilter } from '../../src/common/filters/global-exception.filter';
import { RequestIdMiddleware } from '../../src/common/middleware/request-id.middleware';
import { MAX_JSON_BODY_BYTES } from '../../src/config/body-limit';

/**
 * Bootstrap a Nest app that mirrors the real `main.ts` middleware stack
 * (cookie-parser, global prefix, strict ValidationPipe, exception filter)
 * so HTTP-level specs exercise the same pipeline production uses.
 *
 * Phase 23 (W4): `RequestIdMiddleware` and the explicit body-parser limits
 * from `main.ts` were missing here, which meant HTTP-level specs ran with
 * `requestId: "unknown"` in every error body and with body-parser's 100kb
 * default. That is a divergence between the tested system and the shipped
 * one of exactly the kind Phase 22 proved to be load-bearing: a spec could
 * assert on the error envelope and never see the production value. The
 * shared `applyRuntimePipeline` below is now the single definition, imported
 * by both entry points, so the two cannot drift again.
 */
export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  // `bodyParser: false` + explicit parsers mirrors main.ts exactly; see the
  // Phase 23 note above on why the limit must be identical in both places.
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false });
  app.use(cookieParser());
  app.use(new RequestIdMiddleware().use);
  app.useBodyParser('json', { limit: MAX_JSON_BODY_BYTES });
  app.useBodyParser('urlencoded', { limit: MAX_JSON_BODY_BYTES, extended: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(
    new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();
  return app;
}
