import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

/**
 * Body for adding a participant to a conversation.
 *
 * Phase 25 (F-3). The handler used to declare
 * `@Body('targetUserId') targetUserId: string`. A keyed body parameter is
 * extracted from the request body by Nest BEFORE `ValidationPipe` runs, so the
 * whole-object `whitelist` and `forbidNonWhitelisted` never see the rest of
 * the object, and the named field is validated only by the `typeof` check the
 * handler wrote itself. That also made the route invisible to the Phase 24
 * (D-4) compiled-artifact gate, which looked for whole-body bindings only.
 *
 * Binding the body to a DTO is the contract every other body route in this
 * service already uses. The field name and the UUID requirement are unchanged
 * from what the service already enforced downstream
 * (`MessagingService.addParticipant` checks the same UUID v4 shape), so the
 * change moves the check to the edge and additionally makes an unexpected
 * property in the body a 400 rather than a silent no-op.
 */
export class AddConversationParticipantDto {
  @IsString({ message: 'Target userId is required.' })
  @IsNotEmpty({ message: 'Target userId cannot be empty.' })
  @IsUUID('4', { message: 'Invalid UUID for userId.' })
  targetUserId!: string;
}
