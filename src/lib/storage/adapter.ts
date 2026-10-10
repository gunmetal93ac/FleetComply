import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { decrypt, encrypt, parseKey } from "./crypto";

export interface StorageAdapter {
  readonly name: string;
  /** True only for adapters suitable for production data. */
  readonly production: boolean;
  put(key: string, data: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
}

/**
 * DEVELOPMENT ADAPTER — encrypted files on local disk.
 * Not for production: no replication, no backups, single machine.
 */
export class LocalEncryptedDiskAdapter implements StorageAdapter {
  readonly name = "local-encrypted-disk (development only)";
  readonly production = false;
  private readonly root: string;
  private readonly key: Buffer;

  constructor(root: string, keyB64: string | undefined) {
    this.root = resolve(root);
    this.key = parseKey(keyB64);
  }

  private path(key: string) {
    if (!/^[A-Za-z0-9/_\-.]+$/.test(key) || key.includes("..")) throw new Error("Invalid storage key");
    const p = resolve(join(this.root, key));
    if (!p.startsWith(this.root)) throw new Error("Invalid storage key");
    return p;
  }

  async put(key: string, data: Buffer, _contentType?: string): Promise<void> {
    const p = this.path(key);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, encrypt(data, this.key), { mode: 0o600 });
  }

  async get(key: string): Promise<Buffer> {
    return decrypt(await readFile(this.path(key)), this.key);
  }
}

/**
 * Placeholder for the production adapter (S3-compatible, SSE-KMS, short-lived
 * signed URLs, access logging). Intentionally not implemented in Phase 1.
 */
export class S3AdapterNotConfigured implements StorageAdapter {
  readonly name = "s3 (not configured)";
  readonly production = true;
  async put(): Promise<void> {
    throw new Error("S3 storage adapter is not implemented yet. Set STORAGE_DRIVER=local for development.");
  }
  async get(): Promise<Buffer> {
    throw new Error("S3 storage adapter is not implemented yet.");
  }
}

export function storageFromEnv(env = process.env): StorageAdapter {
  if ((env.STORAGE_DRIVER ?? "local") === "local")
    return new LocalEncryptedDiskAdapter(env.STORAGE_LOCAL_DIR ?? "./.data/uploads", env.STORAGE_ENCRYPTION_KEY);
  return new S3AdapterNotConfigured();
}
