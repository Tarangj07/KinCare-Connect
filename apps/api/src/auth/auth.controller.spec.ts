import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';

const DB_URL = process.env['DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

describeDb('Auth endpoints (integration)', () => {
  let app: INestApplication;
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
    await app.init();
  });
  afterEach(async () => { await app.close(); });
  it('register endpoint responds', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/register').send({ email: `new-test-${Date.now()}@example.com`, password: 'StrongPass1!', fullName: 'New Tester' });
    expect(res.status).toBe(201);
  });
  it('login endpoint responds', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'nonexistent@nowhere.com', password: 'StrongPass1!' });
    expect(res.status).toBe(401);
  });
  it('me endpoint requires authentication (no unauthenticated stub)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  // Phase 16 (H11/A16): login must deliver the access token in the body and
  // set the httpOnly refresh cookie — previously access was computed and
  // discarded, leaving mobile sessions inoperative.
  it('successful login returns an access token and a refresh cookie', async () => {
    const email = `login-flow-${Date.now()}@example.com`;
    const reg = await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'StrongPass1!', fullName: 'Login Flow' });
    expect(reg.status).toBe(201);

    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'StrongPass1!' });
    expect(res.status).toBe(201);
    expect(typeof res.body.access).toBe('string');
    expect(res.body.access.length).toBeGreaterThan(20);
    expect(res.body.user).toMatchObject({ email });

    const setCookie = (res.headers['set-cookie'] ?? []) as unknown as string[];
    const refreshCookie = setCookie.find((c) => c.startsWith('refresh='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toMatch(/HttpOnly/i);
    expect(refreshCookie).toMatch(/Path=\/api\/v1\/auth\/refresh/i);
    expect(refreshCookie).toMatch(/SameSite=Strict/i);
  });

  it('me returns 200 with the JWT-derived identity when authenticated', async () => {
    const email = `me-flow-${Date.now()}@example.com`;
    await request(app.getHttpServer())
      .post('/api/v1/auth/register')
      .send({ email, password: 'StrongPass1!', fullName: 'Me Flow' });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ email, password: 'StrongPass1!' });
    const res = await request(app.getHttpServer()).get('/api/v1/auth/me').set('Authorization', `Bearer ${login.body.access}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ email });
    expect(typeof res.body.id).toBe('string');
    expect(res.body.id.length).toBeGreaterThan(0);
  });
});
