import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { RequestIdMiddleware } from './common/middleware/request-id.middleware';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // Trust X-Forwarded-* headers only when behind a known proxy.
  // The express instance is the default; we keep the default of 0 hops
  // and document that the deployment platform must set trust proxy.

  app.use(helmet());
  app.use(new RequestIdMiddleware().use);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  app.setGlobalPrefix('api/v1');

  const port = Number.parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.warn(`[api] listening on :${port}`);
}

void bootstrap();
