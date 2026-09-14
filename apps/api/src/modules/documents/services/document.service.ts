import * as crypto from 'crypto';
import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AuthorizationService } from '../../auth/authorization.service';
import { StorageService } from '../../storage/storage.service';

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

  private validateFile(fileName: string, contentType: string, fileBuffer: Buffer): void {
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      throw new ForbiddenException(`Content type ${contentType} is not allowed.`);
    }
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      throw new ForbiddenException(`File exceeds maximum size of ${MAX_FILE_SIZE_BYTES} bytes.`);
    }
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
        deletedAt: null,
        expiresAt: { gte: new Date() },
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
        metadata: { title: data.title, category: data.category || null, contentType: data.contentType, sizeBytes: fileBuffer.length, storageKey: safeKey },
      },
    });
    return document;
  }

  async listDocuments(seniorId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    return this.prisma.healthDocument.findMany({
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
    return doc;
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
    return { document: doc, fileContent: fileBuffer.toString('base64'), contentType: doc.contentType, fileName: doc.title + (doc.contentType.startsWith('image/') ? '.png' : '.pdf') };
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
      where: { documentId, userId: targetUserId, deletedAt: null },
    });
    if (existing) {
      throw new ForbiddenException('Access grant already exists for this user.');
    }
    const grant = await this.prisma.documentAccess.create({
      data: {
        documentId,
        userId: targetUserId,
        seniorId,
        grantedByUserId: userId,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
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
  }

  async listGrants(seniorId: string, documentId: string, userId: string) {
    await this.verificationForSenior(seniorId, userId);
    const doc = await this.prisma.healthDocument.findFirst({ where: { id: documentId, seniorId, deletedAt: null } });
    if (!doc) throw new NotFoundException('Document not found.');
    return this.prisma.documentAccess.findMany({
      where: { documentId, deletedAt: null },
      include: { user: { select: { fullName: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async revokeGrant(seniorId: string, documentId: string, grantId: string, userId: string) {
    await this.authorizationService.assertCanAccessSenior(userId, seniorId);
    const role = await this.authorizationService.getMemberRole(userId, seniorId);
    if (role !== 'FAMILY_ADMIN' && role !== 'DOCTOR') {
      throw new ForbiddenException('Only FAMILY_ADMIN or DOCTOR can revoke document access.');
    }
    const grant = await this.prisma.documentAccess.findFirst({ where: { id: grantId, documentId, deletedAt: null } });
    if (!grant) throw new NotFoundException('Access grant not found.');
    await this.prisma.documentAccess.update({
      where: { id: grantId },
      data: { deletedAt: new Date() },
    });
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
