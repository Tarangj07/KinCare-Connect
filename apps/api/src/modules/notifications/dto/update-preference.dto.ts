import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Body of `PATCH /api/v1/notification-preferences`.
 *
 * Phase 24 (D-4). The handler declared an inline type literal,
 * `@Body() body: { channel?: string; kind?: string; enabled?: boolean }`,
 * which emits `Object` into `design:paramtypes`. Nest's `ValidationPipe`
 * skips `Object`, so the route bound and echoed an entirely unvalidated
 * body: no whitelist, no `forbidNonWhitelisted`, no type or length bound on
 * anything the caller sent.
 *
 * The endpoint is a Phase 8 stub and the body is not persisted, so this is
 * not a data-integrity defect today. It is included because the route is live
 * and body-carrying, and because the invariant now enforced by
 * `verify-route-authorization.mjs` — every *mounted* route that binds a
 * whole request body binds it to a DTO class Nest will actually validate —
 * has no exception for stubs. The unmounted `CareTaskController` is exempt
 * only because it is not reachable.
 */
export class UpdateNotificationPreferenceDto {
  @IsIn(['EMAIL', 'SMS', 'PUSH', 'IN_APP'])
  @IsOptional()
  channel?: string;

  @IsString()
  @MaxLength(64)
  @IsOptional()
  kind?: string;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
