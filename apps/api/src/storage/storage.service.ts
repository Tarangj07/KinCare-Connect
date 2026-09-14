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

  generateSafeKey(documentId: string, originalName: string): string {
    const random = crypto.randomBytes(16).toString('hex');
    const ext = path.extname(originalName) || '';
    return `${documentId}/${random}${ext}`;
  }

  async upload(fileBuffer: Buffer, storageKey: string, contentType: string): Promise<StorageObject> {
    const targetPath = path.join(this.baseDir, storageKey);
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
    const targetPath = path.join(this.baseDir, storageKey);
    if (!fs.existsSync(targetPath)) {
      throw new InternalServerErrorException('Storage object not found');
    }
    return fs.readFileSync(targetPath);
  }

  async delete(storageKey: string): Promise<void> {
    const targetPath = path.join(this.baseDir, storageKey);
    if (fs.existsSync(targetPath)) {
      fs.unlinkSync(targetPath);
    }
  }

  async exists(storageKey: string): Promise<boolean> {
    return fs.existsSync(path.join(this.baseDir, storageKey));
  }

  computeHash(buffer: Buffer): string {
    return crypto.createHash('sha256').update(buffer).digest('hex');
  }
}
