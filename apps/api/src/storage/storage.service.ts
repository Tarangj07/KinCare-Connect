import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Injectable, InternalServerErrorException } from '@nestjs/common';

export interface StorageObject {
  key: string;
  sizeBytes: number;
  contentType: string;
  contentHash: string;
}

@Injectable()
export class StorageService {
  private readonly baseDir = process.env['STORAGE_DIR'] ?? path.resolve(process.cwd(), 'uploads');

  constructor() {
    if (!fs.existsSync(this.baseDir)) {
      fs.mkdirSync(this.baseDir, { recursive: true });
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
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(targetPath, fileBuffer);
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
