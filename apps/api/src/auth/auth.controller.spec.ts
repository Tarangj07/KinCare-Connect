import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';

describe('Auth endpoints (integration)', () => {
  let app: INestApplication;
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });
  afterEach(async () => { await app.close(); });
  it('register endpoint responds', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email: 'new-test@example.com', password: 'StrongPass1!', fullName: 'New Tester' });
    expect(res.status).toBe(201);
  });
  it('login endpoint responds', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'nonexistent@nowhere.com', password: 'StrongPass1!' });
    expect(res.status).toBe(401);
  });
  it('me endpoint responds', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
    expect([200, 401, 403]).toContain(res.status);
  });
});
