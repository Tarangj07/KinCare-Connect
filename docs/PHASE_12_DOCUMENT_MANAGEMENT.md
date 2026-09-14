# Phase 12 — Document Management

## 1. Architecture

Phase 12 adds secure document management for elderly-care health documents. Documents include prescriptions, reports, discharge summaries, care documents, and authorized health records.

The module follows existing API conventions:
- Controller: `DocumentController` at `/seniors/:seniorId/documents`
- Service: `DocumentService` enforces authorization before any database or storage operation
- DTOs: `UploadDocumentDto`, `CreateAccessGrantDto`
- Storage: `StorageService` provides upload/retrieve/delete with safe, non-guessable keys

Storage keys are derived from document IDs with an added random component (not directly guessable). Files are stored in a configurable directory (default: `uploads/`). The `.env` provides `STORAGE_DIR` or falls back to the default.

No external S3/MinIO SDK is installed; the storage boundary uses the filesystem with safe keys. The `.env` includes `S3_BUCKET` and `MINIO_*` variables for future integration; the boundary is designed for easy substitution.

## 2. Database Schema

No schema changes were required. The existing Phase 2 schema provides:
- `HealthDocument`: metadata, content hash, scan status (`pending` by default), storage key
- `DocumentAccess`: explicit grants with expiration (`expiresAt`), granted by (`grantedByUserId`)

Document-level access (`DocumentAccess`) operates additively: a user must still have active care-circle membership for the senior, and grants extend access beyond the base circle authorization.

No migration was created; the existing schema is sufficient.

## 3. Document Lifecycle

1. **Upload / Create**: User uploads via base64-encoded content (`fileContent`). The service validates content type, file size, extension consistency, computes SHA-256 hash (`contentHash`), generates a safe storage key, writes to storage, and creates the `HealthDocument` record with `scanStatus: 'pending'`.
2. **List / Retrieve**: Authorized users (active circle members) can list and retrieve metadata. Document retrieval verifies both circle authorization and document-level access.
3. **Download**: Download requires either being the uploader or having an active `DocumentAccess` grant (not expired). Audit event `document.downloaded` is recorded with safe metadata (title, content type, size) — never file contents.
4. **Access Grants**: `FAMILY_ADMIN` or `DOCTOR` can create/revoke grants. The target user must have active circle membership for the same senior. Duplicate grants are prevented.
5. **Archive (soft delete)**: Only `FAMILY_ADMIN` or `DOCTOR` can archive. The document's `deletedAt` is set. Audit event `document.archived` is recorded.

## 4. Authorization Model

Every endpoint uses `JwtAuthGuard` and `RolesGuard`. At the service layer (`DocumentService`):

- `assertCanAccessSenior` verifies active `CareCircleMember` for the senior.
- Role checks (`FAMILY_ADMIN`, `DOCTOR`, etc.) are applied to upload, archive, and grant operations.
- `verifyDocumentAccess` checks:
  1. Active circle membership for the document's senior
  2. Either uploader identity (`uploadedByUserId === userId`) OR active, non-expired `DocumentAccess` grant

Acting user identity is derived from the JWT (`req.user.sub`), never from request body fields like `userId`, `uploadedByUserId`, or `createdBy`.

## 5. Role Permission Matrix

| Action | FAMILY_ADMIN | FAMILY_MEMBER | CAREGIVER | DOCTOR | OBSERVER |
|---|---|---|---|---|---|
| Upload document | Yes | Yes | Yes | Yes | No |
| List / retrieve metadata | Yes | Yes | Yes | Yes | Yes |
| Download (with grant or as uploader) | Yes | Yes | Yes | Yes | Yes |
| Create access grant | Yes | No | No | Yes | No |
| Revoke access grant | Yes | No | No | Yes | No |
| Archive document | Yes | No | No | Yes | No |

## 6. Access Grants (`DocumentAccess`)

Grants are explicit and additive:
- Created by `FAMILY_ADMIN` or `DOCTOR`.
- Target user must have active care-circle membership for the same senior.
- Self-grants are rejected.
- Expiration (`expiresAt`) is optional; grants without expiration remain open-ended.
- Revocation sets `deletedAt` (soft delete) and records an audit event.
- Listing grants excludes deleted grants.

## 7. File Validation / Security

At upload time (`validateFile`):
- Allowed content types: `application/pdf`, `image/jpeg`, `image/png`, `image/gif`, `text/plain`, `application/msword`, `.docx`
- Maximum file size: 10MB (`MAX_FILE_SIZE_BYTES`)
- Extension/content-type consistency enforced for image files
- Filename normalization: safe storage keys use `crypto.randomBytes(16)` + original extension; no raw filenames are used as storage keys
- Content hash: SHA-256 computed from the file buffer (`storageService.computeHash`)
- Client-provided MIME type is validated against the allowed list, but the actual file buffer is the authoritative content for hash computation

Uploaded content is treated as untrusted; no execution or rendering of HTML/SVG occurs.

## 8. Malware / Antivirus Scanning Boundary

The `HealthDocument.scanStatus` field exists (`pending`, etc.). On creation, `scanStatus` is set to `'pending'` and `scanCompletedAt` is null. No external antivirus scanning provider is integrated in this phase. The storage layer stores the file but does not claim it is malware-free. The audit and notification payloads never include file contents or scanning results.

Boundary documentation:
- Uploaded files are not falsely marked clean.
- Scanning infrastructure is documented as future work.
- No malware scanning SaaS integration exists in the repository.

## 9. Download Security

Download (`GET /seniors/:seniorId/documents/:documentId/download`) enforces:
1. Authentication (`JwtAuthGuard`)
2. Senior authorization (`assertCanAccessSenior`)
3. Document-level authorization (`verifyDocumentAccess`)

The storage layer (`StorageService`) does not expose raw filesystem paths to clients; clients receive only the document metadata and a base64-encoded file payload in the download response. No unrestricted permanent public URLs are returned.

## 10. Audit Events

Audit events use the existing `AuditLog` model. Events added in Phase 12:
- `document.created` — includes title, category, content type, size, storage key (never file content)
- `document.downloaded` — includes title, content type, size (never file content or signed URLs)
- `document.access_granted` — includes documentId, target user, expiration
- `document.access_revoked` — includes documentId, target user
- `document.archived` — includes document title

No file contents, extracted text, OCR text, or raw storage URLs appear in audit metadata.

## 11. Notification Boundary

Notifications reuse the existing `NotificationModule`. The `NotificationService` creates `Notification` records with kind `document.created`, `document.access_granted`, or `document.access_revoked`. Payloads contain only safe identifiers (`documentId`, `seniorId`, `userId`) and event types — no file contents, no document metadata beyond the identifier.

No external notification providers (email, SMS, push) are implemented in this phase.

## 12. API Endpoints

All endpoints are prefixed with `/api/v1` (global prefix in `main.ts`).

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/seniors/:seniorId/documents` | JWT + active circle | Upload/create document |
| GET | `/seniors/:seniorId/documents` | JWT + active circle | List permitted documents |
| GET | `/seniors/:seniorId/documents/:documentId` | JWT + doc access | Retrieve document metadata |
| GET | `/seniors/:seniorId/documents/:documentId/download` | JWT + doc access | Controlled download |
| POST | `/seniors/:seniorId/documents/:documentId/access` | JWT + admin/doctor | Create access grant |
| GET | `/seniors/:seniorId/documents/:documentId/access` | JWT + active circle | List grants |
| DELETE | `/seniors/:seniorId/documents/:documentId/access/:grantId` | JWT + admin/doctor | Revoke grant |
| PATCH | `/seniors/:seniorId/documents/:documentId/archive` | JWT + admin/doctor | Soft-archive document |

## 13. Privacy Rules

- No file contents are logged in audit metadata.
- No file contents appear in notification payloads.
- No raw storage paths or unrestricted URLs are returned.
- Only minimum metadata (id, title, category, contentType, sizeBytes, scanStatus, createdAt) is returned in API responses.
- Document download requires active authorization; document substitution attacks are prevented by checking both `documentId` and `seniorId` against the database.

## 14. Threat Considerations

- **IDOR / BOLA**: Document substitution (`GET /documents/:wrong-id`) is prevented by checking `deletedAt`, `seniorId`, and authorization (`verifyDocumentAccess`). Senior substitution is prevented by requiring both `seniorId` param validation and authorization.
- **Access-grant substitution**: The grant ID (`grantId`) is verified against the document (`documentId`) before revocation.
- **Cross-circle isolation**: `verifyDocumentAccess` checks `canAccessSenior` against the document's `seniorId`; grants are limited to users with active membership for the same senior.
- **User substitution**: `uploadedByUserId`, `grantedByUserId`, and `actorUserId` are derived from the JWT (`req.user.sub`), never from the request body.
- **Unsafe filenames**: Storage keys are safe (`random` + safe directory structure), not derived directly from user filenames.

## 15. Known Limitations

- No malware scanning provider integrated; `scanStatus` remains `pending`.
- Storage uses filesystem (`uploads/`) rather than MinIO/S3 SDK (no S3 SDK installed). The `.env` includes S3/MinIO variables for future substitution; the `StorageService` interface supports it.
- File upload uses base64 encoding (`fileContent` in DTO). A future phase could add multipart/form-data with `multer`.
- Download returns a base64-encoded string in JSON rather than a binary stream; suitable for API consumers but could be optimized.
- No OCR or AI document analysis (Phase 20 boundary).
- No external EHR integrations.

## 16. Security Findings

No critical security findings for Phase 12. The authorization model enforces circle-level and document-level checks at the service layer. Audit events contain only safe metadata. Storage keys are non-guessable. Malicious uploads are blocked by content-type allowlists and file-size limits. Client-provided identity fields are never trusted.
