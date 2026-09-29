import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageService } from './storage.service';

const savedNodeEnv = process.env['NODE_ENV'];
const savedStorageDir = process.env['STORAGE_DIR'];

/** Fresh, isolated StorageService with STORAGE_DIR pointed at a temp dir. */
function serviceIn(dir: string): StorageService {
  process.env['STORAGE_DIR'] = dir;
  return new StorageService();
}

/**
 * Phase 18 production hardening.
 *
 * Uploaded documents are protected health information. Two properties are
 * pinned here:
 *  - the storage tree and files are created owner-only (0700 / 0600)
 *    rather than inheriting the process umask (commonly 0755 / 0644);
 *  - a development fallback (`./uploads` inside the app directory) cannot
 *    silently activate in production.
 */
describe('StorageService (Phase 18 hardening)', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ecc-storage-spec-'));
    delete process.env['NODE_ENV'];
    delete process.env['STORAGE_DIR'];
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (savedNodeEnv === undefined) delete process.env['NODE_ENV'];
    else process.env['NODE_ENV'] = savedNodeEnv;
    if (savedStorageDir === undefined) delete process.env['STORAGE_DIR'];
    else process.env['STORAGE_DIR'] = savedStorageDir;
  });

  it('creates the storage directory owner-only (0700)', () => {
    const dir = path.join(tmpRoot, 'docs');
    serviceIn(dir);

    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
  });

  it('writes uploaded documents owner-read/write only (0600)', async () => {
    const dir = path.join(tmpRoot, 'docs');
    const service = serviceIn(dir);
    const key = service.generateSafeKey('senior-1', 'plan.png');

    const stored = await service.upload(Buffer.from('phi-content'), key, 'image/png');

    const written = path.join(dir, key);
    expect(fs.existsSync(written)).toBe(true);
    expect(fs.statSync(written).mode & 0o777).toBe(0o600);
    // Sanity: the bytes really are retrievable through the service.
    expect(stored.contentHash).toHaveLength(64);
    expect((await service.retrieve(key)).toString('utf8')).toBe('phi-content');
  });

  it('creates nested per-document directories owner-only', async () => {
    const dir = path.join(tmpRoot, 'docs');
    const service = serviceIn(dir);
    const key = service.generateSafeKey('senior-2', 'script.pdf');

    await service.upload(Buffer.from('x'), key, 'application/pdf');

    expect(fs.statSync(path.join(dir, 'senior-2')).mode & 0o777).toBe(0o700);
  });

  it('refuses to start in production without an explicit STORAGE_DIR', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['STORAGE_DIR'];

    expect(() => new StorageService()).toThrowError(/STORAGE_DIR is required/);
  });

  it('starts in production when STORAGE_DIR is configured', () => {
    process.env['NODE_ENV'] = 'production';
    const dir = path.join(tmpRoot, 'prod-docs');

    expect(() => serviceIn(dir)).not.toThrow();
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('keeps the development fallback outside production', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['STORAGE_DIR'];

    // The fallback is retained for local development (it is only refused in
    // production). Constructing it is expected to succeed; we do not assert
    // on the cwd-relative path itself, only that production is not required
    // to name the directory in development.
    expect(() => new StorageService()).not.toThrow();
  });

  it('still rejects path traversal and absolute keys', async () => {
    const dir = path.join(tmpRoot, 'docs');
    const service = serviceIn(dir);

    await expect(service.retrieve('../../etc/passwd')).rejects.toThrow(/denied/);
    await expect(service.retrieve('/etc/passwd')).rejects.toThrow(/denied/);
  });

  /**
   * Phase 19: the deployment contract is verified, not assumed. Phase 18 set
   * the modes for everything the service creates, but a directory supplied
   * by an operator or mounted as a volume can already exist with looser
   * permissions.
   */
  describe('pre-existing directory permissions (Phase 19)', () => {
    it('refuses to start in production when the directory is group/other readable', () => {
      const dir = path.join(tmpRoot, 'loose');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.chmodSync(dir, 0o755); // owner-only is the contract; 0755 is not

      process.env['NODE_ENV'] = 'production';
      expect(() => serviceIn(dir)).toThrowError(/protected health information|must not be accessible/);
    });

    it('refuses to start in production when the directory is world-writable', () => {
      const dir = path.join(tmpRoot, 'loose2');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.chmodSync(dir, 0o777);

      process.env['NODE_ENV'] = 'production';
      expect(() => serviceIn(dir)).toThrowError(/must not be accessible/);
    });

    it('accepts an owner-only directory in production', () => {
      const dir = path.join(tmpRoot, 'tight');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.chmodSync(dir, 0o700);

      process.env['NODE_ENV'] = 'production';
      expect(() => serviceIn(dir)).not.toThrow();
    });

    it('does not throw in development, but still warns', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const dir = path.join(tmpRoot, 'loose3');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.chmodSync(dir, 0o755);

      process.env['NODE_ENV'] = 'development';
      expect(() => serviceIn(dir)).not.toThrow();
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0]?.[0])).toContain('must not be accessible');
      warn.mockRestore();
    });

    it('never widens permissions on an existing directory (no silent chmod)', () => {
      const dir = path.join(tmpRoot, 'kept');
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      fs.chmodSync(dir, 0o750);
      process.env['NODE_ENV'] = 'production';

      // Would throw, and the point is the mode is still 0750 afterwards.
      expect(() => serviceIn(dir)).toThrow();
      expect(fs.statSync(dir).mode & 0o777).toBe(0o750);
    });

    it('fails clearly when STORAGE_DIR exists but is a file', () => {
      const file = path.join(tmpRoot, 'not-a-dir');
      fs.writeFileSync(file, 'x');

      process.env['NODE_ENV'] = 'production';
      expect(() => serviceIn(file)).toThrowError(/not a directory/);
    });
  });
});
