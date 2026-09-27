/**
 * Document management security integration — Phase 17.
 *
 * Replaces the src/ smoke spec's vacuous `>= 200` assertion with
 * behavioural HTTP coverage against a real database:
 *
 *  - upload role boundaries (CAREGIVER allowed, OBSERVER denied);
 *  - cross-senior denial on upload, read, download and grant;
 *  - the two-layer document access model (uploader OR explicit grant,
 *    never bare circle membership) for get/download;
 *  - expired grants stop authorizing downloads;
 *  - grant listing exposes grantee ids only, never emails (Phase 16 A11);
 *  - archive/revoke restricted to FAMILY_ADMIN/DOCTOR;
 *  - content-type + magic-byte validation;
 *  - download audit trail (document.downloaded with JWT actor);
 *  - authentication gate on every route.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCareFixture, type CareFixture } from '../src/testing/care-fixture';
import { createTestApp } from '../src/testing/create-test-app';

const DB_URL = process.env['DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

const PNG_1x1 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

describeDb('Documents security (real database, HTTP)', () => {
  let app: INestApplication;
  let fx: CareFixture;

  beforeAll(async () => {
    fx = await buildCareFixture({
      a: [
        { key: 'admin', role: 'FAMILY_ADMIN' },
        { key: 'member', role: 'FAMILY_MEMBER' },
        { key: 'caregiver', role: 'CAREGIVER' },
        { key: 'doctor', role: 'DOCTOR' },
        { key: 'observer', role: 'OBSERVER' },
        { key: 'expired', role: 'CAREGIVER', endsAtPast: true },
      ],
      b: [{ key: 'admin', role: 'FAMILY_ADMIN' }],
    });
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await fx?.cleanup();
  });

  async function uploadPdf(seniorId: string, userId: string, title = 'Care plan') {
    return request(app.getHttpServer())
      .post(`/api/v1/seniors/${seniorId}/documents`)
      .set('Authorization', `Bearer ${fx.tokenFor(userId)}`)
      .send({ title, contentType: 'image/png', fileName: 'plan.png', fileContent: PNG_1x1 });
  }

  async function uploadText(seniorId: string, userId: string, title: string, content: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/seniors/${seniorId}/documents`)
      .set('Authorization', `Bearer ${fx.tokenFor(userId)}`)
      .send({
        title,
        contentType: 'text/plain',
        fileName: 'notes.txt',
        fileContent: Buffer.from(content, 'utf8').toString('base64'),
      });
  }

  it('circle members with write roles can upload; OBSERVER and expired membership are denied', async () => {
    const ok = await uploadText(fx.seniorA, fx.membersA.caregiver, 'Vitals note', 'bp 120/80');
    expect(ok.status).toBe(201);
    expect(ok.body.id).toBeTruthy();

    const adminUpload = await uploadPdf(fx.seniorA, fx.membersA.admin);
    expect(adminUpload.status).toBe(201);

    const obsDenied = await uploadText(fx.seniorA, fx.membersA.observer, 'x', 'y');
    expect(obsDenied.status).toBe(403);

    // Phase 16 H10: engagement ended → no access to the senior at all.
    const expiredDenied = await uploadText(fx.seniorA, fx.membersA.expired, 'x', 'y');
    expect(expiredDenied.status).toBe(403);
  });

  it('outsider cannot upload into another senior scope (cross-senior)', async () => {
    const res = await uploadText(fx.seniorB, fx.membersA.admin, 'x', 'y');
    expect(res.status).toBe(403);
  });

  it('circle members can list documents; listing exposes no storage keys (metadata only)', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/documents`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.observer)}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    for (const doc of res.body) {
      expect(doc).not.toHaveProperty('storageKey');
      expect(doc).not.toHaveProperty('contentHash');
    }
  });

  it('get/download enforce uploader-or-grant; a bare circle member is denied but the uploader succeeds', async () => {
    const uploaded = await uploadText(
      fx.seniorA,
      fx.membersA.caregiver,
      'Private script',
      'MEDS-RAN-LOW',
    );
    expect(uploaded.status).toBe(201);
    const docId = uploaded.body.id;

    // Circle member who neither uploaded nor was granted → denied.
    const denied = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/documents/${docId}`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.member)}`);
    expect(denied.status).toBe(403);

    // Uploader gets metadata (no storage internals).
    const mine = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/documents/${docId}`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.caregiver)}`);
    expect(mine.status).toBe(200);
    expect(mine.body).not.toHaveProperty('storageKey');

    // Download returns content for the uploader and writes an audit row.
    const dl = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/documents/${docId}/download`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.caregiver)}`);
    expect(dl.status).toBe(200);
    expect(Buffer.from(dl.body.fileContent, 'base64').toString('utf8')).toBe('MEDS-RAN-LOW');

    const audit = await fx.prisma.auditLog.findFirst({
      where: {
        action: 'document.downloaded',
        resourceId: docId,
        actorUserId: fx.membersA.caregiver,
      },
    });
    expect(audit).not.toBeNull();
    expect(JSON.stringify(audit?.metadata)).not.toContain('MEDS-RAN-LOW'); // content not logged

    const deniedDl = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/documents/${docId}/download`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.member)}`);
    expect(deniedDl.status).toBe(403);
  });

  it('explicit grants authorize reads; expired grants do not; outsider grants are impossible', async () => {
    const uploaded = await uploadText(
      fx.seniorA,
      fx.membersA.doctor,
      'Referral letter',
      'ortho follow-up',
    );
    const docId = uploaded.body.id;

    // OBSERVER (circle member, no upload role) may be granted access.
    const grant = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/documents/${docId}/access`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.doctor)}`)
      .send({ userId: fx.membersA.observer });
    expect(grant.status).toBe(201);

    const read = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/documents/${docId}`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.observer)}`);
    expect(read.status).toBe(200);

    // Cannot grant an outsider to the senior's circle.
    const badGrant = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/documents/${docId}/access`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.doctor)}`)
      .send({ userId: fx.membersB.admin });
    expect(badGrant.status).toBe(403);

    // Expire the grant in-place; access must stop.
    await fx.prisma.documentAccess.update({
      where: { id: grant.body.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });
    const afterExpiry = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/documents/${docId}/download`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.observer)}`);
    expect(afterExpiry.status).toBe(403);
  });

  it('grant listing exposes grantee ids only — no emails/names (Phase 16 A11 PII fix)', async () => {
    const uploaded = await uploadText(
      fx.seniorA,
      fx.membersA.admin,
      'Insurance card',
      'policy 123',
    );
    const docId = uploaded.body.id;
    await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/documents/${docId}/access`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.admin)}`)
      .send({ userId: fx.membersA.observer });

    const list = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/documents/${docId}/access`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.admin)}`);
    expect(list.status).toBe(200);
    expect(list.body.length).toBeGreaterThan(0);
    for (const g of list.body) {
      expect(g).not.toHaveProperty('user');
      expect(JSON.stringify(g)).not.toContain('@example.com');
    }
  });

  it('grant/revoke/archive are FAMILY_ADMIN/DOCTOR only; caregiver is denied; cross-senior substitution denied', async () => {
    const uploaded = await uploadText(
      fx.seniorA,
      fx.membersA.admin,
      'Old prescription',
      'stop 5mg',
    );
    const docId = uploaded.body.id;

    const careDenied = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/documents/${docId}/access`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.caregiver)}`)
      .send({ userId: fx.membersA.member });
    expect(careDenied.status).toBe(403);

    // Substitute seniorB route with a seniorA document id → not found (403/404).
    const cross = await request(app.getHttpServer())
      .patch(`/api/v1/seniors/${fx.seniorB}/documents/${docId}/archive`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.admin)}`);
    // admin of A is outsider to B → circle check denies before lookup.
    expect(cross.status).toBe(403);

    // Caregiver cannot archive even inside the right circle.
    const archiveCare = await request(app.getHttpServer())
      .patch(`/api/v1/seniors/${fx.seniorA}/documents/${docId}/archive`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.caregiver)}`);
    expect(archiveCare.status).toBe(403);

    // Admin can archive; afterwards the doc disappears from listings.
    const archive = await request(app.getHttpServer())
      .patch(`/api/v1/seniors/${fx.seniorA}/documents/${docId}/archive`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.admin)}`);
    expect(archive.status).toBe(200);
    const list = await request(app.getHttpServer())
      .get(`/api/v1/seniors/${fx.seniorA}/documents`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.admin)}`);
    expect(list.body.map((d: { id: string }) => d.id)).not.toContain(docId);
  });

  it('content validation: declared content type must match magic bytes', async () => {
    const fakePng = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/documents`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.admin)}`)
      .send({
        title: 'Evil',
        contentType: 'image/png',
        fileName: 'evil.png',
        fileContent: Buffer.from('not a png').toString('base64'),
      });
    expect(fakePng.status).toBe(403);
    expect(fakePng.body.error.message).toMatch(/PNG signature/);

    const badType = await request(app.getHttpServer())
      .post(`/api/v1/seniors/${fx.seniorA}/documents`)
      .set('Authorization', `Bearer ${fx.tokenFor(fx.membersA.admin)}`)
      .send({
        title: 'Evil',
        contentType: 'application/x-msdownload',
        fileName: 'evil.exe',
        fileContent: 'AAAA',
      });
    expect(badType.status).toBe(400);
  });

  it('every document route demands authentication', async () => {
    const paths = [
      ['get', `/api/v1/seniors/${fx.seniorA}/documents`],
      ['get', `/api/v1/seniors/${fx.seniorA}/documents/some-doc`],
      ['get', `/api/v1/seniors/${fx.seniorA}/documents/some-doc/download`],
      ['post', `/api/v1/seniors/${fx.seniorA}/documents`],
    ] as const;
    for (const [method, p] of paths) {
      const req = request(app.getHttpServer())[method](p);
      const res = method === 'post' ? await req.send({}) : await req;
      expect(res.status).toBe(401);
    }
  });
});
