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
    // Phase 17 (A15): `sizeBytes` is a Prisma BigInt — return it as a JSON
    // number (same as downloadDocument) so responses serialize. The audit
    // entry above no longer duplicates the internal storageKey either.
    return { ...document, sizeBytes: Number(document.sizeBytes) };
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
    // Phase 17 (A15): BigInt columns are not JSON-serializable.
    return docs.map((d) => ({ ...d, sizeBytes: Number(d.sizeBytes) }));
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
    // Phase 17 (A15): BigInt is not JSON-serializable; strip internal
    // storage identifiers from the response.
    const { storageKey, contentHash, ...publicDoc } = doc;
    void storageKey; void contentHash;
    return { ...publicDoc, sizeBytes: Number(doc.sizeBytes) };
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
    await this.verificationForSenior(seniorId, userId);
    const doc = await this.prisma.healthDocument.findFirst({ where: { id: documentId, seniorId, deletedAt: null } });
    if (!doc) throw new NotFoundException('Document not found.');
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
