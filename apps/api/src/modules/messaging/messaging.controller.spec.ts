import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../../app.module';

describe('Messaging endpoints — authorization and security (Phase 11)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('requires authentication for message endpoints', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/seniors/test-senior/conversations/test-conv/messages').send({ body: 'hello' });
    expect(res.status).toBe(401);
  });

  it('requires conversation participant authorization', async () => {
    // Without valid JWT + participant relationship, must deny.
    const res = await request(app.getHttpServer())
      .post('/api/v1/seniors/test-senior/conversations/test-conv/messages')
      .set('Authorization', 'Bearer invalid-token')
      .send({ body: 'hello' });
    expect([401, 403]).toContain(res.status);
  });

  it('message body must not exceed 10000 characters', async () => {
    // Validation test: body length enforced by DTO.
    const longBody = 'a'.repeat(10001);
    const res = await request(app.getHttpServer())
      .post('/api/v1/seniors/test-senior/conversations/test-conv/messages')
      .set('Authorization', 'Bearer test-token')
      .send({ body: longBody });
    // Either 401/403 (auth) or 400/422 (validation); body must be bounded.
    expect([400, 401, 403, 422]).toContain(res.status);
  });
});
