import { Injectable, InternalServerErrorException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

export interface StorageObject {
  key: string;
  sizeBytes: number;
  contentType: string;
  contentHash: string;
}

/**
 * Phase 18: stored documents are protected health information, so the
 * backing directory is created owner-only and every file is written
 * owner-read/write only. Without explicit modes the process umask decides
 * (commonly 0755 for directories and 0644 for files), which leaves
 * medical records readable by every other account on the host.
 */
const STORAGE_DIR_MODE = 0o700;
const STORAGE_FILE_MODE = 0o600;

@Injectable()
export class StorageService {
  private readonly baseDir: string;

  constructor() {
    const configured = process.env['STORAGE_DIR'];

    // Phase 18 (production hardening): a development fallback must not
    // silently activate in production. Writing medical records into
    // `<cwd>/uploads` inside the application directory risks shipping them
    // in a container image, exposing them through any static file handler,
    // and depending on the process umask. Production therefore must name
    // its storage location explicitly. This mirrors the existing
    // fail-fast treatment of JWT_ACCESS_SECRET in security-config.ts.
    if (!configured && process.env['NODE_ENV'] === 'production') {
      throw new Error(
        'STORAGE_DIR is required when NODE_ENV=production. Refusing to start with the ' +
          'development default (./uploads) because document contents are protected health information.',
      );
    }

    this.baseDir = configured ?? path.resolve(process.cwd(), 'uploads');

    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true, mode: STORAGE_DIR_MODE });
    }

    // Phase 19 (deployment readiness): verify the deployment contract
    // rather than assume it. Phase 18 sets the modes above for anything
    // this process creates, but a directory provisioned by an operator or
    // baked into a volume can already exist with looser permissions, and a
    // path that exists but is not a directory would fail later at the first
    // upload with a confusing error.
    //
    // In production both conditions are fatal, because they mean either
    // protected health information is exposed to other accounts or storage
    // is not usable. In development the permission finding is advisory so
    // local iteration is not blocked. Nothing here widens permissions: the
    // Phase 18 modes are unchanged, and an existing directory is never
    // silently chmod-ed.
    const stats = fs.statSync(this.baseDir);
    if (!stats.isDirectory()) {
      throw new Error('STORAGE_DIR exists but is not a directory.');
    }

    // Owner read+write and nothing else. Group/other bits are the concern.
    const permissionBits = stats.mode & 0o777;
    if ((permissionBits & 0o077) !== 0) {
      const message =
        `STORAGE_DIR has permissions ${permissionBits.toString(8).padStart(4, '0')}; ` +
        'documents are protected health information and must not be accessible to ' +
        'group or other users. Restrict it, e.g. chmod 700 <STORAGE_DIR>.';
      if (process.env['NODE_ENV'] === 'production') {
        throw new Error(message);
      }
      // eslint-disable-next-line no-console
      console.warn(`[storage] ${message}`);
    }
  }

  private resolveContainment(storageKey: string): string {
    // Normalize and resolve against baseDir, rejecting absolute paths and traversal
    const safeKey = storageKey.replace(/\\/g, '/');
    // Reject absolute paths
    if (safeKey.startsWith('/')) {
      throw new InternalServerErrorException('Storage access denied: invalid key');
    }
    // Reject any parent-directory traversal sequences in the raw key
    if (safeKey.includes('../') || safeKey.includes('..\\') || safeKey === '..' || safeKey.endsWith('/..')) {
      throw new InternalServerErrorException('Storage access denied: invalid key');
    }
    const targetPath = path.resolve(this.baseDir, safeKey);
    const basePath = path.resolve(this.baseDir);
    // Ensure target is within baseDir
    if (!targetPath.startsWith(basePath + path.sep) && targetPath !== basePath) {
      throw new InternalServerErrorException('Storage access denied: invalid key');
    }
    return targetPath;
  }

  generateSafeKey(documentId: string, originalName: string): string {
    const random = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(originalName) || '';
    return `${documentId}/${random}${ext}`;
  }

  async upload(fileBuffer: Buffer, storageKey: string, contentType: string): Promise<StorageObject> {
    const targetPath = this.resolveContainment(storageKey);
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: STORAGE_DIR_MODE });
    }
    fs.writeFileSync(targetPath, fileBuffer, { mode: STORAGE_FILE_MODE });
    const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    return {
      key: storageKey,
      sizeBytes: fileBuffer.length,
      contentType,
      contentHash: hash,
    };
  }

  async retrieve(storageKey: string): Promise<Buffer> {
    const targetPath = this.resolveContainment(storageKey);
    if (!fs.existsSync(targetPath)) {
      throw new InternalServerErrorException('Storage object not found');
    }
    return fs.readFileSync(targetPath);
  }

  async delete(storageKey: string): Promise<void> {
    const targetPath = this.resolveContainment(storageKey);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    const targetPath = this.resolveContainment(storageKey);
    return fs.existsSync(targetPath);
  }

  computeHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}
