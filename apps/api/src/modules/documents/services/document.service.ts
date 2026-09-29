import * as crypto from 'crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AuthorizationService } from '../../../auth/authorization.service';
import { StorageService } from '../../../storage/storage.service';

const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/gif',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

/**
 * Phase 18 (L-01): single source of truth for the public shape of a
 * HealthDocument returned to a client.
 *
 * Two things are enforced here for every JSON response path:
 *  - `sizeBytes` is a Prisma `BigInt` and is converted to a JSON number
 *    (Phase 17 / audit A15 — a BigInt throws on JSON serialization).
 *  - `storageKey` (the internal storage path) and `contentHash` (an
 *    integrity hash of the stored bytes) are STRIPPED. They are storage
 *    implementation details with no client-side use; the service layer
 *    keeps using `storageKey` internally for download, so removing it
 *    from responses does not affect any server-side behaviour.
 *
 * Before this helper the three response paths sanitized independently:
 * `getDocument` stripped the fields, `listDocuments` avoided them via a
 * Prisma `select`, and `createDocument` returned the raw row spread
 * (`{ ...document }`) — which leaked `storageKey` and `contentHash` in
 * the upload response.
 */
function toPublicDocument<
  T extends { sizeBytes: bigint; storageKey?: string; contentHash?: string },
>(doc: T): Omit<T, 'storageKey' | 'contentHash' | 'sizeBytes'> & { sizeBytes: number } {
  const { storageKey, contentHash, sizeBytes, ...rest } = doc;
  void storageKey;
  void contentHash;
  return { ...rest, sizeBytes: Number(sizeBytes) };
}

@Injectable()
export class DocumentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorizationService: AuthorizationService,
    private readonly storageService: StorageService,
  ) {}

  private guardPreDecodeSize(base64String: string): void {
    // Basic base64 format validation before size estimation
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64String.replace(/\s/g, ''))) {
      throw new ForbiddenException('File content is not valid base64.');
    }
    // Remove whitespace to get actual base64 length
    const trimmed = base64String.replace(/\s/g, '');
    // Base64 length: each 4 chars -> 3 bytes. Account for padding.
    // A safe upper-bound: if trimmed length exceeds (MAX * 4/3) + 32 padding/slack, reject.
    const maxBase64Length = Math.ceil((MAX_FILE_SIZE_BYTES * 4) / 3) + 32;
    if (trimmed.length > maxBase64Length) {
      throw new ForbiddenException('File base64 exceeds maximum allowed size before decode.');
    }
    // Additional check: approximate decoded size
    const approximateDecoded = Math.floor((trimmed.length * 3) / 4) - (trimmed.endsWith('==') ? 2 : trimmed.endsWith('=') ? 1 : 0);
    if (approximateDecoded > MAX_FILE_SIZE_BYTES) {
      throw new ForbiddenException('File exceeds maximum size of 10MB.');
    }
  }

  private inspectMagicBytes(fileBuffer: Buffer, contentType: string): void {
    const firstBytes = fileBuffer.slice(0, 8);
    const hex = firstBytes.toString('hex');
    const pngHeader = '89504e470d0a1a0a';
    const gif87a = '474946383761';
    const gif89a = '474946383961';
    const jpeg = 'ffd8ff';
    const pdf = '255044462d'; // %PDF-
    const docLegacy = 'd0cf11e0'; // legacy DOC/OLE2 header

    if (contentType === 'application/pdf') {
      if (!hex.startsWith(pdf)) {
        throw new ForbiddenException('File content does not match PDF signature.');
      }
      return;
    }

    if (contentType === 'image/png') {
      if (!hex.startsWith(pngHeader)) {
        throw new ForbiddenException('File content does not match PNG signature.');
      }
      return;
    }

    if (contentType === 'image/gif') {
      if (!hex.startsWith(gif87a) && !hex.startsWith(gif89a)) {
        throw new ForbiddenException('File content does not match GIF signature.');
      }
      return;
    }

    if (contentType === 'image/jpeg') {
      // JPEG starts with ffd8ff; allow variations in first 3 bytes after header
      if (!hex.startsWith(jpeg)) {
        throw new ForbiddenException('File content does not match JPEG signature.');
      }
      return;
    }

    if (contentType === 'application/msword' || contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      // Legacy DOC uses OLE2 header d0cf11e0; .docx is a ZIP-based format with PK header
      if (contentType === 'application/msword' && !hex.startsWith(docLegacy)) {
        throw new ForbiddenException('File content does not match DOC signature.');
      }
      // For .docx, check ZIP header (PK) at start
      if (contentType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        const zipHeader = '504b0304';
        if (!hex.startsWith(zipHeader)) {
          throw new ForbiddenException('File content does not match DOCX (ZIP) signature.');
        }
      }
      return;
    }

    // For text/plain, no reliable binary signature; boundary preserved: untrusted, no malware claim.
    // For other types, no signature enforced but still untrusted.
  }

  private validateFile(fileName: string, contentType: string, fileBuffer: Buffer): void {
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new ForbiddenException(`Content type ${contentType} is not allowed.`);
    }
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      throw new ForbiddenException(`File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes.`);
    }
    this.inspectMagicBytes(fileBuffer, contentType);
    const ext = fileName.split('.').pop()?.toLowerCase() || '';
    const expectedExt = contentType.split('/').pop() || '';
    if (contentType.startsWith('image/')) {
      const allowed = ['jpeg', 'jpg', 'png', 'gif'];
      if (!allowed.includes(ext) && !allowed.includes(expectedExt)) {
        throw new ForbiddenException('File extension does not match content type for images.');
      }
    }
  }

  private async verifyDocumentAccess(userId: string, documentId: string): Promise<boolean> {
    const doc = await this.prisma.healthDocument.findFirst({
      where: { id: documentId, deletedAt: null },
      include: { senior: { include: { careCircles: true } } },
    });
    if (!doc) return false;
    const canAccessSenior = await this.authorizationService.canAccessSenior(userId, doc.seniorId);
    if (!canAccessSenior) return false;
    const isUploader = doc.uploadedByUserId === userId;
    if (isUploader) return true;
    const grant = await this.prisma.documentAccess.findFirst({
      where: {
        documentId,
        userId,
        seniorId: doc.seniorId,
        OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
      },
    });
    return !!grant;
  }

  async createDocument(
    seniorId: string,
    userId: string,
    data: { title: string; category?: string; description?: string; contentType: string; fileName: string; fileContent: string },
  ) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'FAMILY_MEMBER' && role !== 'CAREGIVER' && role !== 'DOCTOR') {
      throw new ForbiddenException('Insufficient privileges to upload documents for this senior.');
    }
    this.guardPreDecodeSize(data.fileContent);
    const fileBuffer = Buffer.from(data.fileContent, 'base64');
    this.validateFile(data.fileName, data.contentType, fileBuffer);
    const safeKey = this.storageService.generateSafeKey(seniorId, data.fileName);
    const hash = this.storageService.computeHash(fileBuffer);
    await this.storageService.upload(fileBuffer, safeKey, data.contentType);
    const document = await this.prisma.healthDocument.create({
      data: {
        seniorId,
        uploadedByUserId: userId,
        title: data.title,
        category: data.category || null,
        contentType: data.contentType,
        sizeBytes: BigInt(fileBuffer.length),
        storageKey: safeKey,
        contentHash: hash,
        description: data.description || null,
        scanStatus: 'pending',
      },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'document.created',
        resourceType: 'health_document',
        resourceId: document.id,
        seniorId,
        metadata: { title: data.title, category: data.category || null, contentType: data.contentType, sizeBytes: fileBuffer.length },
      },
    });
    // Phase 18 (L-01): route every response through the shared serializer so
    // the upload response can no longer leak the internal `storageKey` /
    // `contentHash` the way `{ ...document }` did. `sizeBytes` is also a
    // Prisma BigInt and must become a JSON number (Phase 17 / audit A15).
    return toPublicDocument(document);
  }

  async listDocuments(seniorId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const docs = await this.prisma.healthDocument.findMany({
      where: { seniorId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        category: true,
        contentType: true,
        sizeBytes: true,
        createdAt: true,
        deletedAt: true,
        scanStatus: true,
        uploadedBy: { select: { id: true, fullName: true } },
      },
    });
    // Phase 18 (L-01): shared serializer — BigInt-safe and guaranteed free of
    // internal storage identifiers.
    return docs.map((d) => toPublicDocument(d));
  }

  async getDocument(seniorId: string, documentId: string, userId: string) {
    const canAccess = await this.verifyDocumentAccess(userId, documentId);
    if (!canAccess) {
      throw new ForbiddenException('Access denied to this document.');
    }
    const doc = await this.prisma.healthDocument.findFirst({
      where: { id: documentId, seniorId, deletedAt: null },
      include: { uploadedBy: { select: { id: true, fullName: true } } },
    });
    if (!doc) throw new NotFoundException('Document not found.');
    // Phase 18 (L-01): shared serializer strips the internal `storageKey` and
    // `contentHash` and converts the BigInt `sizeBytes` to a JSON number.
    return toPublicDocument(doc);
  }

  async downloadDocument(seniorId: string, documentId: string, userId: string) {
    const canAccess = await this.verifyDocumentAccess(userId, documentId);
    if (!canAccess) {
      throw new ForbiddenException('Access denied to download this document.');
    }
    const doc = await this.prisma.healthDocument.findFirst({
      where: { id: documentId, seniorId, deletedAt: null },
    });
    if (!doc) throw new NotFoundException('Document not found.');
    const fileBuffer = await this.storageService.retrieve(doc.storageKey);
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'document.downloaded',
        resourceType: 'health_document',
        resourceId: documentId,
        seniorId,
        metadata: { title: doc.title, contentType: doc.contentType, sizeBytes: fileBuffer.length },
      },
    });
    return {
      id: doc.id,
      title: doc.title,
      contentType: doc.contentType,
      fileName: doc.title + (doc.contentType.startsWith('image/') ? '.png' : '.pdf'),
      fileContent: fileBuffer.toString('base64'),
      sizeBytes: Number(doc.sizeBytes),
      createdAt: doc.createdAt,
    };
  }

  async archiveDocument(seniorId: string, documentId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
      throw new ForbiddenException('Only FAMILY_ADMIN or DOCTOR can archive documents.');
    }
    const doc = await this.prisma.healthDocument.findFirst({ where: { id: documentId, seniorId, deletedAt: null } });
    if (!doc) throw new NotFoundException('Document not found.');
    await this.prisma.healthDocument.update({
      where: { id: documentId },
      data: { deletedAt: new Date() },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'document.archived',
        resourceType: 'health_document',
        resourceId: documentId,
        seniorId,
        metadata: { title: doc.title },
      },
    });
    return { message: 'Document archived.', documentId };
  }

  async grantAccess(seniorId: string, documentId: string, userId: string, targetUserId: string, expiresAt?: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
      throw new ForbiddenException('Only FAMILY_ADMIN or DOCTOR can grant document access.');
    }
    if (userId === targetUserId) {
      throw new ForbiddenException('Cannot grant access to yourself.');
    }
    const doc = await this.prisma.healthDocument.findFirst({ where: { id: documentId, seniorId, deletedAt: null } });
    if (!doc) throw new NotFoundException('Document not found.');
    const targetCanAccess = await this.authorizationService.canAccessSenior(targetUserId, seniorId);
    if (!targetCanAccess) {
      throw new ForbiddenException('Target user must have active care-circle membership for this senior.');
    }
    const existing = await this.prisma.documentAccess.findFirst({
      where: { documentId, userId: targetUserId },
    });
    if (existing) {
      throw new ForbiddenException('Access grant already exists for this user.');
    }
    let grant;
    try {
      interface TransactionClient {
        documentAccess: {
          findFirst: (args: { where: { documentId: string; userId: string } }) => Promise<any>;
          create: (args: { data: any }) => Promise<any>;
        };
      }
      grant = await this.prisma.$transaction(async (tx: TransactionClient) => {
        // Re-check inside transaction to catch concurrent insertion
        const existingInTx = await tx.documentAccess.findFirst({
          where: { documentId, userId: targetUserId },
        });
        if (existingInTx) {
          throw new ForbiddenException('Access grant already exists for this user.');
        }
        return await tx.documentAccess.create({
          data: {
            documentId,
            userId: targetUserId,
            seniorId,
            grantedByUserId: userId,
            expiresAt: expiresAt ? new Date(expiresAt) : null,
          },
        });
      });
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          actorType: 'USER',
          action: 'document.access_granted',
          resourceType: 'document_access',
          resourceId: grant.id,
          seniorId,
          metadata: { documentId, targetUserId, expiresAt: expiresAt || null },
        },
      });
      return grant;
    } catch (err) {
      if (err instanceof ForbiddenException) {
        throw err;
      }
      // Handle Prisma unique constraint violation (P2002) cleanly
      if (err && typeof err === 'object' && 'code' in err && (err as any).code === 'P2002') {
        throw new ForbiddenException('Access grant already exists for this user.');
      }
      throw err;
    }
  }

  async listGrants(seniorId: string, documentId: string, userId: string) {
    // Phase 18 (L-02): the grant list is access-control metadata (who may
    // open this document, and until when), not document content.
    //
    // Phase 16 finding A11 identified this endpoint as requiring "only
    // senior access (any role incl. OBSERVER)"; the Phase 16 remediation
    // removed the grantee PII (emails/names) but left the authorization
    // level untouched, so any active circle member — including OBSERVER,
    // and including members with no grant on the document at all — could
    // enumerate the access topology of documents they cannot open.
    //
    // The rule applied here is the one already used by the mutating grant
    // operations (grantAccess / revokeGrant) and by archiveDocument, plus
    // the uploader, who is already a privileged party for their own
    // document in `verifyDocumentAccess`:
    //     FAMILY_ADMIN | DOCTOR | uploader
    // No new authorization model is introduced; this reuses the existing
    // CareCircle ACL via getMemberRole. Enforced in the service layer, so
    // it applies regardless of the route or any controller decorator.
    await this.verificationForSenior(seniorId, userId);
    const doc = await this.prisma.healthDocument.findFirst({ where: { id: documentId, seniorId, deletedAt: null } });
    if (!doc) throw new NotFoundException('Document not found.');

    const isUploader = doc.uploadedByUserId === userId;
    if (!isUploader) {
      const role = await this.authorizationService.getMemberRole(userId, seniorId);
      if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
        throw new ForbiddenException('Not permitted to view access grants for this document.');
      }
    }

    return this.prisma.documentAccess.findMany({
      where: { documentId, seniorId },
      // Phase 16 (A11): grantee identity comes back by id only — the
      // DocumentAccess model has no user relation, and enumerating
      // grantee emails/names through this read path is PII leakage.
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeGrant(seniorId: string, documentId: string, grantId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
      throw new ForbiddenException('Only FAMILY_ADMIN or DOCTOR can revoke document access.');
    }
    const grant = await this.prisma.documentAccess.findFirst({
      where: { id: grantId, documentId, seniorId },
    });
    if (!grant) throw new NotFoundException('Access grant not found.');
    // DocumentAccess has no deletedAt column; revocation removes the
    // grant row (the revoke event itself is preserved in the audit log).
    await this.prisma.documentAccess.delete({ where: { id: grantId } });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        actorType: 'USER',
        action: 'document.access_revoked',
        resourceType: 'document_access',
        resourceId: grantId,
        seniorId,
        metadata: { documentId, targetUserId: grant.userId },
      },
    });
    return { message: 'Access grant revoked.', grantId };
  }

  private async verificationForSenior(seniorId: string, userId: string): Promise<void> {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
  }
}
