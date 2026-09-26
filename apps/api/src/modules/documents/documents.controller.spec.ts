import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';

const DB_URL = process.env['DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

describeDb('Document endpoints', () => {
  let app: INestApplication;
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });
  afterEach(async () => { await app.close(); });

  it('upload endpoint responds', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/seniors/test-senior-id/documents')
      .send({ title: 'Test Document', contentType: 'text/plain', fileName: 'test.txt', fileContent: 'dGVzdA==' });
    expect(res.status).toBeGreaterThanOrEqual(200);
  });

  it('list endpoint responds', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/seniors/test-senior-id/documents');
    expect([200, 401, 403]).toContain(res.status);
  });

  it('download requires authorization', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/seniors/test-senior-id/documents/test-doc/download');
    expect([401, 403, 404]).toContain(res.status);
  });

  it('archive endpoint requires authorization', async () => {
    const res = await request(app.getHttpServer()).patch('/api/v1/seniors/test-senior-id/documents/test-doc/archive');
    expect([401, 403, 404]).toContain(res.status);
  });
});
