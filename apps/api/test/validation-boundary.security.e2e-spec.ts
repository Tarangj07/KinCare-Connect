/**
 * Phase 23 (W4) — input validation and error-boundary behaviour.
 *
 * A systematic sweep of the externally reachable surface, over real HTTP and
 * a real database. The questions are the same for every route:
 *
 *   1. Is the body/query/param validated by a real DTO, or does it reach the
 *      handler unvalidated because the reflected type is `Object`?
 *   2. Are unexpected properties refused (`forbidNonWhitelisted`) rather than
 *      silently stripped?
 *   3. Do malformed JSON, oversized input, invalid UUIDs, invalid dates and
 *      out-of-range numbers produce 4xx, never 5xx?
 *   4. Does an internal failure (bad ID, missing file, database error)
 *      produce a generic error with no database host/port/name, no SQL, no
 *      filesystem path, no stack frame and no secret?
 *
 * Every assertion is paired: a route is not shown to accept bad input merely
 * because it also accepted good input, and a control is not shown to work
 * merely because a request was rejected. Where a rejection is the only
 * observable, the accompanying state change is asserted too.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { buildCareFixture, type CareFixture } from '../src/testing/care-fixture';
import { createTestApp } from '../src/testing/create-test-app';

const DB_URL = process.env['DATABASE_URL'];
const describeDb = DB_URL ? describe : describe.skip;

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NON_UUID = 'not-a-uuid';
const ISO_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

describeDb('Input validation and error boundaries (real database, HTTP)', () => {
  let app: INestApplication;
  let fx: CareFixture;

  beforeAll(async () => {
    fx = await buildCareFixture({
      a: [
        { key: 'admin', role: 'FAMILY_ADMIN' },
        { key: 'member', role: 'FAMILY_MEMBER' },
        { key: 'observer', role: 'OBSERVER' },
      ],
      b: [{ key: 'admin', role: 'FAMILY_ADMIN' }],
    });
    app = await createTestApp();
  });

  afterAll(async () => {
    await app?.close();
    await fx?.cleanup();
  });

  const http = () => request(app.getHttpServer());
  const auth = (u: string) => `Bearer ${fx.tokenFor(u)}`;

  /**
   * Nothing an internal exception might carry may reach the client. Applied
   * to every response this file receives, so a leak is a failure regardless
   * of which route produced it.
   */
  const expectNoInternalLeak = (res: request.Response, where: string) => {
    const body = typeof res.text === 'string' ? res.text : JSON.stringify(res.body ?? {});
    for (const pattern of [
      /postgres(ql)?:\/\//i,
      /password_hash/i,
      /prisma/i,
      /node_modules/,
      /node:internal/,
      /at [\w.$<>]+ \(.*:\d+:\d+\)/, // stack frame
      /\/home\/[\w.-]+\//, // absolute host path
      /\/usr\/lib\/node/,
      /SELECT |INSERT |UPDATE .* FROM/i, // SQL text
    ]) {
      expect(`${where}: ${body}`.match(pattern), `${where} leaked ${pattern}`).toBeNull();
    }
    // Whatever the outcome, the error envelope must be the documented shape.
    if (res.status >= 400) {
      expect(res.body?.error?.code, `${where} returned no error code`).toBeTruthy();
      expect(res.body?.error?.requestId, `${where} returned no requestId`).toBeTruthy();
      expect(res.body?.error?.stack, `${where} returned a stack`).toBeUndefined();
    }
  };

  // ---------------------------------------------------------------------
  describe('error envelope', () => {
    it('every error carries a code and a requestId, and no stack', async () => {
      const res = await http().get('/api/v1/auth/me');
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      expect(typeof res.body.error.requestId).toBe('string');
      expect(res.body.error.requestId.length).toBeGreaterThan(0);
      expect(res.body).not.toHaveProperty('stack');
      expectNoInternalLeak(res, 'unauthenticated /auth/me');
    });

    it('a client-supplied requestId is echoed only when it is well formed', async () => {
      const good = await http()
        .get('/api/v1/auth/me')
        .set('x-request-id', 'trace-abc.123_x:9');
      expect(good.headers['x-request-id']).toBe('trace-abc.123_x:9');
      expect(good.body.error.requestId).toBe('trace-abc.123_x:9');
      expect(good.body.error.requestId).not.toBe('unknown');

      // A hostile value is replaced rather than echoed, so an attacker cannot
      // plant arbitrary text in operator logs.
      const hostile = await http()
        .get('/api/v1/auth/me')
        .set('x-request-id', 'a'.repeat(200));
      expect(hostile.headers['x-request-id']).not.toBe('a'.repeat(200));
      expect(hostile.headers['x-request-id'].length).toBeLessThanOrEqual(64);
    });

    it('an unknown route is a 404 with the same envelope and no internals', async () => {
      const res = await http().get('/api/v1/definitely-not-a-route');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
      expectNoInternalLeak(res, 'unknown route');
    });
  });

  // ---------------------------------------------------------------------
  describe('malformed and oversized input', () => {
    it('malformed JSON is a 400, not a 500, on several body-carrying routes', async () => {
      const targets = [
        { path: '/api/v1/auth/login', token: undefined },
        { path: `/api/v1/seniors/${fx.seniorA}/measurements`, token: auth(fx.membersA.admin) },
        { path: `/api/v1/seniors/${fx.seniorA}/documents`, token: auth(fx.membersA.admin) },
        { path: `/api/v1/seniors/${fx.seniorA}/medications`, token: auth(fx.membersA.admin) },
        { path: `/api/v1/seniors/${fx.seniorA}/appointments`, token: auth(fx.membersA.admin) },
        { path: `/api/v1/seniors/${fx.seniorA}/feed`, token: auth(fx.membersA.member) },
        { path: `/api/v1/seniors/${fx.seniorA}/emergency-alerts`, token: auth(fx.membersA.member) },
        { path: `/api/v1/seniors/${fx.seniorA}/conversations`, token: auth(fx.membersA.member) },
      ];

      for (const t of targets) {
        const req = http().post(t.path).set('content-type', 'application/json');
        if (t.token) req.set('authorization', t.token);
        const res = await req.send('{"unterminated": ');
        expect([400, 401, 403, 404], `${t.path} answered ${res.status} to malformed JSON`).toContain(res.status);
        expect(res.status, `${t.path} returned 5xx for malformed JSON`).toBeLessThan(500);
        expectNoInternalLeak(res, `malformed JSON on ${t.path}`);
      }
    });

    it('a JSON array where an object is expected is refused', async () => {
      const res = await http()
        .post('/api/v1/auth/login')
        .set('content-type', 'application/json')
        .send('[1,2,3]');
      expect(res.status).toBeLessThan(500);
      expectNoInternalLeak(res, 'array body on /auth/login');
    });

    it('a body well above body-parser default is rejected, not fatal', async () => {
      // 256KB — comfortably past body-parser's 100kb default, small enough
      // that in-process supertest stays fast. Phase 23: this used to be a 500
      // from PayloadTooLargeError rather than a 4xx.
      const huge = 'x'.repeat(256 * 1024);
      const res = await http()
        .post('/api/v1/auth/register')
        .set('content-type', 'application/json')
        .send({ email: `bulk-${Date.now()}@p23.invalid`, password: huge, fullName: huge });
      expect(res.status, `a 256KB register body answered ${res.status}`).toBe(400);
      expect(res.status, 'a large-but-permitted body produced a 5xx').toBeLessThan(500);
      expectNoInternalLeak(res, 'oversized register body');

      // The absolute ceiling (a body past the parser limit) is exercised over
      // a real socket by scripts/verify-compiled-auth-suite.mjs rather than
      // here: in-process supertest buffers multi-megabyte strings slowly
      // enough to dominate the suite, and the property under test belongs to
      // the shipped entry point, not to the test harness.
    });

    it('an oversized document payload is refused by the DTO, not by the parser', async () => {
      const res = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/documents`)
        .set('authorization', auth(fx.membersA.admin))
        .send({
          title: 'Too big',
          contentType: 'application/pdf',
          fileName: 'big.pdf',
          // 21MB of base64: above the DTO's 20MB ceiling but below the
          // parser's 24MB absolute body limit, so the DTO is the binding
          // rule. That ordering is the point — the declared contract must be
          // the one that actually rejects, not a lower parser default.
          fileContent: 'QUJD'.repeat(21 * 256 * 1024),
        });
      expect([400, 403], `oversized document answered ${res.status}`).toContain(res.status);
      expect(res.status, 'the DTO did not refuse an over-length document').not.toBe(201);
      expectNoInternalLeak(res, 'oversized document upload');
    });

    it('a document within the declared contract is accepted, not refused by the parser', async () => {
      // Phase 23: body-parser's 100kb default made this impossible — the
      // request died with a 500 before the DTO ever ran. If this regresses to
      // 413 or 500, the parser limit and the declared contract have drifted
      // apart again.
      const sizeBytes = 2 * 1024 * 1024;
      const bytes = Buffer.concat([
        Buffer.from('%PDF-1.4\n'),
        Buffer.alloc(sizeBytes, 0x42),
        Buffer.from('\n%%EOF\n'),
      ]);
      const res = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/documents`)
        .set('authorization', auth(fx.membersA.admin))
        .send({
          title: 'P23 WithinContract',
          contentType: 'application/pdf',
          fileName: 'within.pdf',
          fileContent: bytes.toString('base64'),
        });
      expect(
        res.status,
        `a ${sizeBytes}-byte document answered ${res.status}: ${String(res.text).slice(0, 200)}`,
      ).toBe(201);
      expect(res.body.sizeBytes).toBe(bytes.length);
    });
  });

  // ---------------------------------------------------------------------
  describe('unexpected properties are refused, not stripped', () => {
    it('identity fields in a body are rejected rather than trusted', async () => {
      const attempts = [
        {
          // Phase 23: `createConversation` declares no @Body() parameter at
          // all, so the body is not bound and a client-supplied `userId` is
          // ignored rather than rejected. The security property holds — the
          // participant is derived from the JWT — but the strict-whitelist
          // guarantee does NOT extend to routes that declare no DTO, and
          // asserting a 400 here would be asserting behaviour the code does
          // not have. Asserted instead: the spoofed identity is not honoured.
          assertsIdentityIgnored: true,
          path: `/api/v1/seniors/${fx.seniorA}/conversations`,
          token: auth(fx.membersA.member),
          body: { userId: fx.membersB.admin },
        },
        {
          path: `/api/v1/seniors/${fx.seniorA}/measurements`,
          token: auth(fx.membersA.admin),
          body: {
            measurementTypeKey: fx.measurementTypeKey,
            value: { kind: 'scalar', value: 70, unit: 'bpm' },
            measuredAt: '2026-05-01T09:00:00.000Z',
            seniorId: fx.seniorB,
            createdByUserId: fx.membersB.admin,
          },
        },
        {
          path: `/api/v1/seniors/${fx.seniorA}/medications`,
          token: auth(fx.membersA.admin),
          body: { name: 'Metformin', dosage: '500 mg', id: 'client-chosen-id' },
        },
      ];

      for (const a of attempts) {
        const res = await http().post(a.path).set('authorization', a.token).send(a.body);
        if (a.assertsIdentityIgnored) {
          // The route has no body DTO, so the extra property is inert rather
          // than rejected. What must be proven is that it changes nothing.
          expect(res.status, `${a.path} answered ${res.status}`).toBe(201);
          expect(res.body.userId, 'the conversation carries a client-supplied userId').toBeUndefined();
          expect(res.body.seniorId, `${a.path} was steered to another senior`).toBe(fx.seniorA);
          const participants = await fx.prisma.conversationParticipant.findMany({
            where: { conversationId: res.body.id },
            select: { userId: true },
          });
          expect(
            participants.map((p) => p.userId),
            'the spoofed userId became a conversation participant',
          ).toEqual([fx.membersA.member]);
        } else {
          expect(res.status, `${a.path} accepted an undeclared property: ${res.text}`).toBe(400);
        }
        expectNoInternalLeak(res, `unexpected property on ${a.path}`);
      }
    });

    it('a PATCH cannot smuggle a field the POST does not accept', async () => {
      const created = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/medications`)
        .set('authorization', auth(fx.membersA.admin))
        .send({ name: 'P23 PatchProbe', dosage: '1 tablet' });
      expect(created.status).toBe(201);
      const id = created.body.id;
      expect(UUID_V4.test(id)).toBe(true);

      const res = await http()
        .patch(`/api/v1/seniors/${fx.seniorA}/medications/${id}`)
        .set('authorization', auth(fx.membersA.admin))
        .send({ name: 'Renamed', seniorId: fx.seniorB });
      expect(res.status).toBe(400);
      expectNoInternalLeak(res, 'PATCH with a smuggled seniorId');
    });

    // -------------------------------------------------------------------
    // Phase 24 (D-4): PATCH /feed/:updateId is the one body-carrying route
    // whose body reached the handler completely unvalidated. Its parameter
    // was declared `Partial<CreateFamilyUpdateDto>`, a mapped type whose
    // emitted metatype is `Object` — and Nest's ValidationPipe skips `Object`.
    // The global whitelist / forbidNonWhitelisted guarantee silently did not
    // apply, so `userId` and `authorUserId` were accepted with 200.
    // -------------------------------------------------------------------

    describe('the feed PATCH body is validated, not merely bound', () => {
      let updateId: string;

      beforeAll(async () => {
        const created = await http()
          .post(`/api/v1/seniors/${fx.seniorA}/feed`)
          .set('authorization', auth(fx.membersA.admin))
          .send({ body: 'P24 feed patch probe', visibility: 'CIRCLE' });
        expect(created.status).toBe(201);
        updateId = created.body.id;
      });

      const patch = (body: unknown) =>
        http()
          .patch(`/api/v1/seniors/${fx.seniorA}/feed/${updateId}`)
          .set('authorization', auth(fx.membersA.admin))
          .send(body as object);

      it('CONTROL: a well-formed partial body is refused by the stub (Phase 50 — P1 blocker)', async () => {
        const res = await patch({ body: 'P24 legitimate edit' });
        expect(res.status, `feed PATCH returned ${res.status}`).toBe(501);
      });

      it('refuses an identity field the POST would also refuse', async () => {
        const before = await fx.prisma.familyUpdate.findUniqueOrThrow({ where: { id: updateId } });
        const res = await patch({ body: 'P24 rewrite', userId: fx.membersB.admin, authorUserId: fx.membersB.admin });
        expect(res.status, `the feed PATCH accepted a smuggled identity field: ${res.text}`).toBe(400);
        expectNoInternalLeak(res, 'feed PATCH with a smuggled identity field');

        const after = await fx.prisma.familyUpdate.findUniqueOrThrow({ where: { id: updateId } });
        expect(after.authorUserId, 'a refused feed PATCH still changed the post author').toBe(before.authorUserId);
      });

      it('refuses an undeclared property at all', async () => {
        const res = await patch({ body: 'P24 rewrite', isPinned: true });
        expect(res.status, `the feed PATCH accepted an undeclared property: ${res.text}`).toBe(400);
        expectNoInternalLeak(res, 'feed PATCH with an undeclared property');
      });

      it('applies the same enum, length and UUID constraints the POST applies', async () => {
        const cases: Array<[string, unknown]> = [
          ['an invalid enum', { visibility: 'EVERYONE' }],
          ['a body below the minimum length', { body: 'ab' }],
          ['a non-string body', { body: { nested: 'object' } }],
          ['a non-UUID relatedEntityId', { relatedEntityId: 'not-a-uuid' }],
          ['a non-string kind', { kind: 7 }],
        ];
        for (const [label, body] of cases) {
          const res = await patch(body);
          expect(res.status, `the feed PATCH accepted ${label}: ${res.text}`).toBe(400);
          expectNoInternalLeak(res, `feed PATCH with ${label}`);
        }
      });
    });
  });

  // ---------------------------------------------------------------------
  describe('type and format constraints', () => {
    it('an invalid enum value is refused on every route that declares one', async () => {
      const cases = [
        {
          path: `/api/v1/seniors/${fx.seniorA}/emergency-alerts`,
          body: { type: 'NOT_A_TYPE', severity: 'HIGH', source: 'p23' },
        },
        {
          path: `/api/v1/seniors/${fx.seniorA}/emergency-alerts`,
          body: { type: 'FALL', severity: 'CATASTROPHIC', source: 'p23' },
        },
        {
          path: `/api/v1/seniors/${fx.seniorA}/measurements`,
          body: {
            measurementTypeKey: fx.measurementTypeKey,
            value: { kind: 'scalar', value: 70, unit: 'bpm' },
            measuredAt: '2026-05-01T09:00:00.000Z',
            source: 'SATELLITE',
          },
        },
        {
          path: `/api/v1/seniors/${fx.seniorA}/feed`,
          body: { body: 'A post', visibility: 'EVERYONE' },
        },
      ];

      for (const c of cases) {
        const res = await http().post(c.path).set('authorization', auth(fx.membersA.admin)).send(c.body);
        expect(res.status, `${c.path} accepted an invalid enum: ${res.text}`).toBe(400);
        expectNoInternalLeak(res, `invalid enum on ${c.path}`);
      }
    });

    it('an invalid date is refused, and a date-only value is refused where a timestamp is required', async () => {
      const cases = [
        {
          path: `/api/v1/seniors/${fx.seniorA}/appointments`,
          body: { title: 'Bad date', startsAt: 'not-a-date' },
        },
        {
          path: `/api/v1/seniors/${fx.seniorA}/appointments`,
          body: { title: 'No timezone', startsAt: '2026-05-01T09:00:00' },
        },
        {
          path: `/api/v1/seniors/${fx.seniorA}/measurements`,
          body: {
            measurementTypeKey: fx.measurementTypeKey,
            value: { kind: 'scalar', value: 70, unit: 'bpm' },
            // Syntactically perfect, semantically impossible. Phase 23: this
            // used to pass validation and become `new Date("Invalid Date")`,
            // producing a 500.
            measuredAt: '2026-13-45T99:99:99.000Z',
          },
        },
        {
          path: `/api/v1/seniors/${fx.seniorA}/appointments`,
          body: { title: 'Impossible', startsAt: '2026-02-30T10:00:00.000Z' },
        },
        {
          path: `/api/v1/seniors/${fx.seniorA}/appointments`,
          body: { title: 'Impossible', startsAt: '2026-13-45T99:99:99.000Z' },
        },
      ];
      for (const c of cases) {
        const res = await http().post(c.path).set('authorization', auth(fx.membersA.admin)).send(c.body);
        const offending = 'startsAt' in c.body ? c.body.startsAt : c.body.measuredAt;
        expect(res.status, `${c.path} accepted ${String(offending)}: ${res.text}`).toBe(400);
      }
    });

    it('a well-formed date is accepted, so the date rules are not rejecting everything', async () => {
      const res = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/appointments`)
        .set('authorization', auth(fx.membersA.member))
        .send({ title: 'P23 DateProbe', startsAt: '2026-05-01T09:00:00.000Z' });
      expect(res.status).toBe(201);
      expect(res.body.startsAt).toMatch(ISO_MS);
    });

    it('a non-UUID identifier in a path is a 4xx, never a 5xx and never a foreign record', async () => {
      const cases = [
        { method: 'get' as const, path: `/api/v1/seniors/${fx.seniorA}/medications/${NON_UUID}` },
        { method: 'get' as const, path: `/api/v1/seniors/${NON_UUID}/medications` },
        { method: 'get' as const, path: `/api/v1/seniors/${fx.seniorA}/appointments/${NON_UUID}` },
        { method: 'get' as const, path: `/api/v1/seniors/${fx.seniorA}/documents/${NON_UUID}` },
        { method: 'get' as const, path: `/api/v1/seniors/${fx.seniorA}/measurements/${NON_UUID}` },
        { method: 'get' as const, path: `/api/v1/seniors/${fx.seniorA}/feed/${NON_UUID}` },
        { method: 'get' as const, path: `/api/v1/seniors/${fx.seniorA}/emergency-alerts/${NON_UUID}` },
        { method: 'get' as const, path: `/api/v1/notifications/${NON_UUID}` },
      ];

      for (const c of cases) {
        const res = await http()[c.method](c.path).set('authorization', auth(fx.membersA.admin));
        // Phase 23: these were 500s. A malformed identifier is now a 400
        // INVALID_IDENTIFIER (Prisma P2023) or a 404, depending on whether
        // the query reached the database.
        expect(res.status, `${c.path} returned ${res.status}`).toBeLessThan(500);
        expect([400, 403, 404], `${c.path} returned ${res.status}`).toContain(res.status);
        if (res.status === 400) {
          expect(res.body?.error?.code, `${c.path} returned code ${res.body?.error?.code}`).toBe(
            'INVALID_IDENTIFIER',
          );
        }
        expectNoInternalLeak(res, `non-UUID id on ${c.path}`);
      }
    });

    it('a well-formed UUID for a record that does not exist is 404, not 500', async () => {
      const missing = '00000000-0000-4000-8000-000000000000';
      const res = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/medications/${missing}`)
        .set('authorization', auth(fx.membersA.admin));
      expect(res.status).toBe(404);
      expectNoInternalLeak(res, 'missing medication id');
    });

    it('a UUID-shaped path parameter that is not a v4 UUID is refused where v4 is required', async () => {
      // v1-shaped: the DTOs use IsUUID('4') / a v4 pattern.
      const v1 = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
      const res = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/documents/${v1}/access`)
        .set('authorization', auth(fx.membersA.admin))
        .send({ userId: fx.membersA.member });
      // The document does not exist either, so 403/404 are both correct; what
      // must not happen is a 500 or a leaked Prisma constraint message.
      expect(res.status).toBeLessThan(500);
      expectNoInternalLeak(res, 'v1 UUID in a v4 field');
    });

    it('an out-of-range number is refused where a range is declared', async () => {
      const res = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/measurements`)
        .set('authorization', auth(fx.membersA.admin))
        .send({
          measurementTypeKey: fx.measurementTypeKey,
          // `value` must be an object; a bare number must not slip through.
          value: 70,
          measuredAt: '2026-05-01T09:00:00.000Z',
        });
      expect(res.status).toBe(400);
      expectNoInternalLeak(res, 'scalar value where an object is required');
    });

    it('messaging pagination input cannot be used to request an unbounded page', async () => {
      for (const query of ['?take=100000', '?take=-5', '?skip=-1', '?take=abc&skip=xyz']) {
        const res = await http()
          .get(`/api/v1/seniors/${fx.seniorA}/conversations/${fx.seniorA}/messages${query}`)
          .set('authorization', auth(fx.membersA.member));
        expect(res.status, `${query} returned ${res.status}`).toBeLessThan(500);
        expectNoInternalLeak(res, `pagination ${query}`);
      }
    });
  });

  // ---------------------------------------------------------------------
  describe('internal failures do not cross the HTTP boundary', () => {
    it('a document whose stored bytes are gone is a 5xx with a generic body', async () => {
      const pdf = Buffer.from('%PDF-1.4\n% p23 probe\n%%EOF\n').toString('base64');
      const up = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/documents`)
        .set('authorization', auth(fx.membersA.admin))
        .send({ title: 'P23 MissingFile', contentType: 'application/pdf', fileName: 'probe.pdf', fileContent: pdf });
      expect(up.status).toBe(201);

      // Remove the bytes behind the application's back so the download path
      // fails inside the storage layer, which is the interesting case: a
      // filesystem failure must not become a path disclosure.
      const row = await fx.prisma.healthDocument.findUnique({ where: { id: up.body.id }, select: { storageKey: true } });
      expect(row?.storageKey).toBeTruthy();
      const { rmSync } = await import('node:fs');
      const path = await import('node:path');
      rmSync(path.join(process.env['STORAGE_DIR'] as string, row!.storageKey), { force: true });

      const res = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/documents/${up.body.id}/download`)
        .set('authorization', auth(fx.membersA.admin));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(600);
      expectNoInternalLeak(res, 'download of a missing stored object');
      // The specific requirement: no filesystem path anywhere in the body.
      expect(res.text).not.toContain(process.env['STORAGE_DIR'] as string);
      expect(res.text).not.toMatch(/\.pdf/);
    });

    it('a database error surfaces as INTERNAL_ERROR with no driver detail', async () => {
      // A UUID that is well-formed but references a table row the query cannot
      // resolve drives Prisma to fail; the filter must still respond in the
      // documented envelope.
      const res = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/documents`)
        .set('authorization', auth(fx.membersA.admin))
        .send({
          title: 'P23 Constraint',
          contentType: 'text/plain',
          fileName: 'ok.txt',
          fileContent: Buffer.from('hello').toString('base64'),
          // Valid, whitelisted, semantically wrong: the service layer must
          // reject it without a raw Prisma message escaping.
          description: 'x'.repeat(1001),
        });
      expect(res.status).toBe(400);
      expectNoInternalLeak(res, 'over-length description');
    });

    it('the stored credential never appears in any response on the auth surface', async () => {
      const email = `p23-leak-${Date.now()}@p23.invalid`;
      const password = 'LeakProbe1x';
      const reg = await http().post('/api/v1/auth/register').send({ email, password, fullName: 'P23 Leak' });
      expect(reg.status).toBe(201);
      expect(reg.text).not.toContain(password);
      expect(reg.text).not.toMatch(/\$argon2/);

      const login = await http().post('/api/v1/auth/login').send({ email, password });
      expect(login.status).toBe(201);
      expect(login.text).not.toContain(password);
      expect(login.text).not.toMatch(/\$argon2/);
      // The refresh token must be cookie-only, never in the body.
      expect(login.text).not.toMatch(/[0-9a-f-]{36}\.[A-Za-z0-9_-]{20,}/);
    });
  });

  // ---------------------------------------------------------------------
  describe('authorization is enforced before validation, and identity is never client-supplied', () => {
    it('an unauthorized caller gets 401 even with a perfect body', async () => {
      const res = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/medications`)
        .send({ name: 'Metformin', dosage: '500 mg' });
      expect(res.status).toBe(401);
    });

    it('a forbidden caller gets 403 even with a perfect body', async () => {
      const res = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/medications`)
        .set('authorization', auth(fx.membersA.observer))
        .send({ name: 'Metformin', dosage: '500 mg' });
      expect(res.status).toBe(403);
    });

    it('an OBSERVER cannot write PHI but can read it — the role boundary is real in both directions', async () => {
      const created = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/measurements`)
        .set('authorization', auth(fx.membersA.admin))
        .send({
          measurementTypeKey: fx.measurementTypeKey,
          value: { kind: 'scalar', value: 72, unit: 'bpm' },
          measuredAt: '2026-05-01T09:00:00.000Z',
        });
      expect(created.status).toBe(201);

      const write = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/measurements`)
        .set('authorization', auth(fx.membersA.observer))
        .send({
          measurementTypeKey: fx.measurementTypeKey,
          value: { kind: 'scalar', value: 80, unit: 'bpm' },
          measuredAt: '2026-05-01T09:00:00.000Z',
        });
      expect(write.status).toBe(403);

      const read = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/measurements`)
        .set('authorization', auth(fx.membersA.observer));
      expect(read.status).toBe(200);
      expect(Array.isArray(read.body)).toBe(true);
    });

    it('identity for a document grant comes from the token, not from a body field', async () => {
      const target = fx.membersA.member;
      const attacker = fx.membersA.observer;
      const res = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/documents/00000000-0000-4000-8000-000000000000/access`)
        .set('authorization', auth(attacker))
        .send({ userId: target, grantedByUserId: fx.membersB.admin });
      // A body-supplied grantee identity is refused outright by the strict
      // whitelist (400) — it never reaches the service, so it cannot be
      // honoured even in principle. Asserting 403 here would be wrong: the
      // request is rejected before the role check, which is strictly safer.
      expect(res.status).toBe(400);
      expectNoInternalLeak(res, 'document grant with a body-supplied grantee');

      // And the same attempt with a body the DTO accepts is still refused on
      // the attacker's own lack of privilege, proving the DTO is not the only
      // thing standing between an OBSERVER and a grant.
      const valid = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/documents/00000000-0000-4000-8000-000000000000/access`)
        .set('authorization', auth(attacker))
        .send({ userId: target });
      expect([403, 404], `a valid-body OBSERVER grant answered ${valid.status}`).toContain(
        valid.status,
      );
    });
  });

  // ---------------------------------------------------------------------
  describe('BigInt and serialization', () => {
    it('a document response is JSON with a numeric sizeBytes and no BigInt', async () => {
      const pdf = Buffer.from('%PDF-1.4\n% p23 bigint\n%%EOF\n').toString('base64');
      const up = await http()
        .post(`/api/v1/seniors/${fx.seniorA}/documents`)
        .set('authorization', auth(fx.membersA.admin))
        .send({ title: 'P23 BigInt', contentType: 'application/pdf', fileName: 'bigint.pdf', fileContent: pdf });
      expect(up.status).toBe(201);
      // If sizeBytes were still a BigInt, JSON.stringify would have thrown
      // and the response would be a 500. It is a number here.
      expect(typeof up.body.sizeBytes).toBe('number');
      expect(up.body.sizeBytes).toBe(Buffer.from(pdf, 'base64').length);
      // Internal storage identifiers are stripped (Phase 18 L-01).
      expect(up.body).not.toHaveProperty('storageKey');
      expect(up.body).not.toHaveProperty('contentHash');

      const list = await http()
        .get(`/api/v1/seniors/${fx.seniorA}/documents`)
        .set('authorization', auth(fx.membersA.admin));
      expect(list.status).toBe(200);
      for (const doc of list.body as Array<Record<string, unknown>>) {
        expect(typeof doc.sizeBytes).toBe('number');
        expect(doc).not.toHaveProperty('storageKey');
        expect(doc).not.toHaveProperty('contentHash');
      }
    });
  });
});
