import { describe, expect, it, beforeEach } from 'vitest';
import { ForbiddenException, NotFoundException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AuthorizationService } from '../../../auth/authorization.service';
import { StorageService } from '../../../storage/storage.service';
import { DocumentService } from './document.service';

describe('DocumentService security', () => {
  let service: DocumentService;
  let mockPrisma: any;
  let mockAuth: any;
  let mockStorage: any;

  beforeEach(() => {
    mockPrisma = {
      healthDocument: {
        findFirst: async (opts: any) => {
          const id = opts.where?.id;
          const seniorId = opts.where?.seniorId;
          const deletedAt = opts.where?.deletedAt;
          if (id === 'doc-a' && (seniorId === 'senior-a' || seniorId === undefined) && deletedAt === null) {
            return { id: 'doc-a', seniorId: 'senior-a', deletedAt: null, uploadedByUserId: 'user-a', title: 'Doc A', contentType: 'text/plain', sizeBytes: BigInt(100), storageKey: 'key/senior-a/Doc A.png' };
          }
          if (id === 'doc-b' && (seniorId === 'senior-b' || seniorId === undefined) && deletedAt === null) {
            return { id: 'doc-b', seniorId: 'senior-b', deletedAt: null, uploadedByUserId: 'user-b', title: 'Doc B', contentType: 'image/png', sizeBytes: BigInt(200), storageKey: 'key/senior-b/Doc B.png' };
          }
          return null;
        },
        create: async (opts: any) => ({ id: 'new-doc', ...opts.data }),
        findMany: async () => [],
        update: async () => ({}),
      },
      documentAccess: {
        findFirst: async (opts: any) => {
          // DocumentAccess has no deletedAt column (real Prisma schema);
          // revocation deletes the row outright.
          if (opts.where.id === 'grant-a' && opts.where.documentId === 'doc-a' && opts.where.seniorId === 'senior-a') {
            return { id: 'grant-a', documentId: 'doc-a', userId: 'user-c', seniorId: 'senior-a', grantedByUserId: 'user-a' };
          }
          return null;
        },
        findMany: async () => [],
        create: async (opts: any) => ({ id: 'new-grant', ...opts.data }),
        update: async () => ({}),
        delete: async (opts: any) => ({ id: opts.where.id }),
      },
      auditLog: {
        create: async () => ({ id: 'audit-1' }),
      },
    };

    mockAuth = {
      assertCanAccessSenior: async (userId: string, seniorId: string) => {
        if (userId === 'user-b' && seniorId === 'senior-b') throw new ForbiddenException('Access denied');
        if (userId === 'user-b' && seniorId === 'senior-a') throw new ForbiddenException('Access denied');
      },
      canAccessSenior: async (userId: string, seniorId: string) => {
        // user-b cannot access senior-a; user-c can access senior-a
        if (userId === 'user-b' && seniorId === 'senior-a') return false;
        return true;
      },
      getMemberRole: async (userId: string, seniorId: string) => {
        if (userId === 'admin-a') return 'FAMILY_ADMIN';
        if (userId === 'doctor-a') return 'DOCTOR';
        if (userId === 'observer-b') return 'OBSERVER';
        if (userId === 'user-c') return 'FAMILY_MEMBER';
        return 'FAMILY_MEMBER';
      },
    };

    mockStorage = {
      generateSafeKey: (seniorId: string, fileName: string) => `key/${seniorId}/${fileName}`,
      computeHash: () => 'hash123',
      upload: async () => ({ key: 'key', sizeBytes: 100, contentType: 'text/plain', contentHash: 'hash123' }),
      retrieve: async (key: string) => Buffer.from('test'),
      delete: async () => undefined,
      exists: async () => true,
    };

    mockPrisma.$transaction = async (cb: any) => cb(mockPrisma);

    service = new DocumentService(mockPrisma as any, mockAuth as any, mockStorage as any);
  });

  describe('F01 — revokeGrant authorization', () => {
    it('authorized FAMILY_ADMIN can revoke same-senior grant', async () => {
      const result = await service.revokeGrant('senior-a', 'doc-a', 'grant-a', 'admin-a');
      expect(result.message).toBe('Access grant revoked.');
    });

    it('DOCTOR can revoke same-senior grant', async () => {
      const result = await service.revokeGrant('senior-a', 'doc-a', 'grant-a', 'doctor-a');
      expect(result.message).toBe('Access grant revoked.');
    });

    it('cannot revoke grant for different senior (cross-senior bypass)', async () => {
      // The lookup binds seniorId; if grant is for senior-a but senior-b is passed, findFirst returns null
      await expect(service.revokeGrant('senior-b', 'doc-a', 'grant-a', 'admin-a')).rejects.toThrow(NotFoundException);
    });
  });

  describe('F02 — pre-decode base64 size guard', () => {
    it('valid <=10MB payload passes', async () => {
      const smallBase64 = Buffer.from('hello').toString('base64');
      const result = await service.createDocument('senior-a', 'user-a', {
        title: 'Small',
        contentType: 'text/plain',
        fileName: 'small.txt',
        fileContent: smallBase64,
      });
      expect(result.id).toBeDefined();
    });

    it('oversized base64 rejected before decode', async () => {
      // Create a base64 string that represents >10MB (approx 13.4MB base64 chars)
      const huge = 'A'.repeat(14 * 1024 * 1024);
      await expect(service.createDocument('senior-a', 'user-a', {
        title: 'Huge',
        contentType: 'text/plain',
        fileName: 'huge.txt',
        fileContent: huge,
      })).rejects.toThrow(ForbiddenException);
    });

    it('malformed base64 rejected', async () => {
      await expect(service.createDocument('senior-a', 'user-a', {
        title: 'Bad',
        contentType: 'text/plain',
        fileName: 'bad.txt',
        fileContent: '!!!not-base64!!!',
      })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('F03 — bounded content-signature validation', () => {
    it('PDF with correct header passes', async () => {
      const pdfBuffer = Buffer.from('%PDF-1.4 hello');
      const base64 = pdfBuffer.toString('base64');
      const result = await service.createDocument('senior-a', 'user-a', {
        title: 'PDF',
        contentType: 'application/pdf',
        fileName: 'file.pdf',
        fileContent: base64,
      });
      expect(result.id).toBeDefined();
    });

    it('MIME/signature mismatch rejected', async () => {
      // Claim PNG but provide text content
      const base64 = Buffer.from('not an image at all').toString('base64');
      await expect(service.createDocument('senior-a', 'user-a', {
        title: 'Fake PNG',
        contentType: 'image/png',
        fileName: 'fake.png',
        fileContent: base64,
      })).rejects.toThrow(ForbiddenException);
    });
  });

  describe('F05 — StorageService path traversal defense', () => {
    it('malicious storage key with ../ is rejected', async () => {
      const { StorageService } = await import('../../../storage/storage.service');
      const storage = new StorageService();
      await expect(
        storage.retrieve('../etc/passwd'),
      ).rejects.toThrow(InternalServerErrorException);
    });

    it('absolute path is rejected', async () => {
      const { StorageService } = await import('../../../storage/storage.service');
      const storage = new StorageService();
      await expect(
        storage.retrieve('/etc/passwd'),
      ).rejects.toThrow(InternalServerErrorException);
    });
  });

  describe('F06 — download response restricts internal fields', () => {
    it('download response exposes only allowed public fields and excludes internal fields', async () => {
      const docResult = await service.downloadDocument('senior-a', 'doc-a', 'user-a') as any;
      // Allowed public fields must exist
      expect(docResult.id).toBe('doc-a');
      expect(docResult.title).toBe('Doc A');
      expect(docResult.contentType).toBe('text/plain');
      expect(docResult.fileName).toBeDefined();
      expect(docResult.fileContent).toBeDefined();
      expect(typeof docResult.sizeBytes).toBe('number');
      // Internal fields must be absent
      expect(docResult.storageKey).toBeUndefined();
      expect(docResult.contentHash).toBeUndefined();
      expect(docResult.uploadedByUserId).toBeUndefined();
      expect(docResult.seniorId).toBeUndefined();
      // Must not expose full HealthDocument object
      expect(docResult.document).toBeUndefined();
    });
  });

  describe('F04 — duplicate DocumentAccess race', () => {
    it('handles Prisma P2002 unique-constraint error cleanly', async () => {
      // Temporarily override mock to simulate P2002
      const originalCreate = mockPrisma.documentAccess.create;
      mockPrisma.documentAccess.create = async () => {
        const err = new Error('Unique constraint failed');
        (err as any).code = 'P2002';
        throw err;
      };
      await expect(service.grantAccess('senior-a', 'doc-a', 'admin-a', 'user-c', '2025-12-31T00:00:00.000Z')).rejects.toThrow(ForbiddenException);
      mockPrisma.documentAccess.create = originalCreate;
    });
  });

  describe('F10 — controller role defense-in-depth agreement', () => {
    it('service authorization remains authoritative for upload', async () => {
      // Even if controller allows role, service checks senior access
      await expect(service.createDocument('senior-b', 'user-b', {
        title: 'Attempt',
        contentType: 'text/plain',
        fileName: 'test.txt',
        fileContent: 'dGVzdA==',
      })).rejects.toThrow(ForbiddenException);
    });
  });
});
