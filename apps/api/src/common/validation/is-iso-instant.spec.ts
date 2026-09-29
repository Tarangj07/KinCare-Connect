/**
 * Phase 23 (W4) — ISO-instant validation.
 *
 * The defect this guards against is subtle enough to be worth stating
 * plainly: JavaScript does not reject a day that does not exist. It rolls it
 * forward. `new Date('2026-02-30T10:00:00.000Z')` is 2 March, and
 * `Date.parse` returns a perfectly valid number, so a validator built on
 * "does it parse?" accepts it — and a caller who asked for 30 February
 * silently gets 2 March persisted.
 */
import { describe, expect, it } from 'vitest';

import { isParsableIsoInstant } from './is-iso-instant';

describe('isParsableIsoInstant (Phase 23 W4)', () => {
  it('accepts a well-formed instant', () => {
    for (const value of [
      '2026-05-01T09:00:00.000Z',
      '1970-01-01T00:00:00.000Z',
      '2026-12-31T23:59:59.999Z',
      '2024-02-29T12:00:00.000Z', // a real leap day
    ]) {
      expect(isParsableIsoInstant(value), value).toBe(true);
    }
  });

  it('rejects a day that does not exist rather than rolling it forward', () => {
    // The exact case the shape-only regex let through.
    for (const value of ['2026-02-30T10:00:00.000Z', '2025-02-29T10:00:00.000Z', '2026-04-31T00:00:00.000Z']) {
      expect(isParsableIsoInstant(value), value).toBe(false);
      // And confirm the premise: JavaScript really does roll these forward,
      // which is why "does it parse?" was not sufficient.
      expect(Number.isNaN(Date.parse(value)), `${value} unexpectedly failed to parse`).toBe(false);
    }
  });

  it('rejects out-of-range components', () => {
    for (const value of [
      '2026-13-45T99:99:99.000Z', // the case that produced HTTP 500
      '2026-00-01T00:00:00.000Z',
      '2026-01-00T00:00:00.000Z',
      '2026-05-01T24:00:00.000Z',
      '2026-05-01T09:60:00.000Z',
      '2026-05-01T09:00:61.000Z',
    ]) {
      expect(isParsableIsoInstant(value), value).toBe(false);
    }
  });

  it('requires the exact pinned shape, including an explicit UTC zone', () => {
    // A zone-less or offset-bearing value is rejected even though it is a
    // valid instant: the DTO contract is `...Z` with milliseconds, and a
    // caller must not be able to omit the timezone.
    for (const value of [
      '2026-05-01T09:00:00',
      '2026-05-01T09:00:00Z',
      '2026-05-01T09:00:00.000+05:30',
      '2026-05-01',
      '2026-05-01T09:00:00.000z',
      ' 2026-05-01T09:00:00.000Z',
      '2026-05-01T09:00:00.000Z ',
      '',
    ]) {
      expect(isParsableIsoInstant(value), JSON.stringify(value)).toBe(false);
    }
  });

  it('rejects non-strings', () => {
    for (const value of [undefined, null, 1234, new Date(), {}, []]) {
      expect(isParsableIsoInstant(value)).toBe(false);
    }
  });
});
