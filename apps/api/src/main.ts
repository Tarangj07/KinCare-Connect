import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';
import { MAX_JSON_BODY_BYTES } from './config/body-limit';
import { assertRuntimeConfig } from './config/runtime-config';

async function bootstrap(): Promise<void> {
  // Phase 19: fail before anything is initialised when the configuration
  // cannot support a production run. The message names the offending
  // variables and requirements only — never a value, secret, or connection
  // string. This preserves (and reports earlier) the fail-closed behaviour
  // that Phase 16 established for the JWT secret and Phase 18 for
  // STORAGE_DIR; it does not add or relax any rule.
  assertRuntimeConfig();

  // `bodyParser: false` suppresses Nest's own default registration, and the
  // parsers are then added below with an explicit limit. Doing it this way
  // rather than importing body-parser directly keeps `body-parser` a
  // transitive dependency of @nestjs/platform-express instead of an
  // undeclared direct one.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });

  app.use(cookieParser());
  app.use(helmet());
  app.use(new RequestIdMiddleware().use);
  app.useBodyParser('json', { limit: MAX_JSON_BODY_BYTES });
  app.useBodyParser('urlencoded', { limit: MAX_JSON_BODY_BYTES, extended: true });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.setGlobalPrefix('api/v1');

  // Phase 19: without this, Nest does not register SIGTERM/SIGINT
  // handlers, so `PrismaService.onModuleDestroy` ($disconnect) never runs.
  // A container stop would then drop in-flight queries and leave the
  // PostgreSQL connection to be reaped by the server's own timeouts rather
  // than drained deliberately. With shutdown hooks enabled, a SIGTERM from
  // an orchestrator stops new connections, lets in-flight requests finish,
  // and closes the Prisma pool cleanly before the process exits.
  app.enableShutdownHooks();

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.warn(`[api] listening on :${port}`);
}

void bootstrap();
