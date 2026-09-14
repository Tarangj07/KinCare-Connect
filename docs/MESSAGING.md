# Phase 11 — Secure Messaging (Authorization & Security)

## Authorization model (two layers)

1. **Active CareCircleMember**: user must have `status = ACTIVE` in a `CareCircleMember` row for the senior's care circle (`assertCanAccessSenior`).
2. **ConversationParticipant**: user must have an active (`leftAt` is null) `ConversationParticipant` row for the specific `conversationId`. CareCircle membership alone does **not** grant conversation access.

Both layers must pass. The authorization service checks the first layer; the messaging service checks the second layer explicitly.

## Security protections

- **Sender identity** derived exclusively from `req.user.sub` (JWT payload). The `senderUserId` is never accepted from the request body.
- **Conversation identity** derived exclusively from the route (`:conversationId`). A `conversationId` in the body is never used for authorization.
- **Senior substitution** prevented: the conversation must belong to the senior in the route (`conversation.seniorId == seniorId`).
- **Participant substitution** prevented: only participants with `leftAt = null` may access the conversation.
- **Message body** is never placed in audit log metadata (only `conversationId`, `replyToId`, `hasBody: true`).
- **Notification payloads** reference only message/conversation IDs; message body is never included.

## API endpoints

| Method | Path | Description |
|---|---|---|
| POST | `/seniors/:seniorId/conversations` | Create conversation (auto-adds creator as participant) |
| GET | `/seniors/:seniorId/conversations` | List conversations (requires active participant) |
| GET | `/seniors/:seniorId/conversations/:conversationId` | Get conversation details |
| POST | `/seniors/:seniorId/conversations/:conversationId/messages` | Send message |
| GET | `/seniors/:seniorId/conversations/:conversationId/messages` | List messages with pagination (`skip`, `take`) |
| POST | `/seniors/:seniorId/conversations/:conversationId/read` | Mark conversation as read |
| POST | `/seniors/:seniorId/conversations/:conversationId/participants` | Add participant (`targetUserId` required) |

## Audit events

- `messaging.conversation.created`
- `messaging.participant.added`
- `messaging.message.created`

Audit metadata excludes message bodies.

## Notification event boundary

Notification payload includes only:
- `conversationId`
- `messageId`
- `senderUserId`
- `seniorId`

Message body is excluded.

## Known limitations

- No E2E encryption, attachments, reactions, typing indicators, presence, message search, AI processing, or mobile UI.
- Conversation creation does not enforce role-based restrictions; all active circle members may create conversations.
- Read/unread is basic (`lastReadAt` only); no per-message read receipts.
