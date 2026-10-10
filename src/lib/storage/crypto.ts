import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

/**
 * AES-256-GCM envelope for files at rest in the local development adapter.
 * Layout: [12-byte IV][16-byte auth tag][ciphertext].
 * Production should use the object store's server-side encryption with a KMS key
 * (see docs/ARCHITECTURE.md) in addition to TLS in transit.
 */
export function parseKey(b64: string | undefined): Buffer {
  if (!b64) throw new Error("STORAGE_ENCRYPTION_KEY is not set");
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) throw new Error("STORAGE_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decrypt(blob: Buffer, key: Buffer): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

export function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
