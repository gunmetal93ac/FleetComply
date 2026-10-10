import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword, verifyPassword } from "../src/lib/auth/password";
import { base32Encode, hotp, totp, verifyTotp } from "../src/lib/auth/totp";
import { hashToken, newSessionToken } from "../src/lib/auth/tokens";
import { LocalEncryptedDiskAdapter } from "../src/lib/storage/adapter";

test("password hashing round-trips and rejects wrong passwords and short passwords", async () => {
  const h = await hashPassword("correct horse battery");
  assert.ok(h.startsWith("scrypt$"));
  assert.equal(await verifyPassword("correct horse battery", h), true);
  assert.equal(await verifyPassword("wrong horse battery!", h), false);
  await assert.rejects(hashPassword("short"));
});

test("TOTP matches RFC 4226/6238 reference vectors", () => {
  const secret = Buffer.from("12345678901234567890");
  assert.equal(hotp(secret, 0), "755224");
  assert.equal(hotp(secret, 1), "287082");
  // RFC 6238 SHA-1 vector at T=59s → 94287082 (8 digits) → last 6 = 287082
  assert.equal(totp(base32Encode(secret), 59_000), "287082");
  assert.equal(verifyTotp(base32Encode(secret), "287082", 59_000), true);
  assert.equal(verifyTotp(base32Encode(secret), "000000", 59_000), false);
});

test("session tokens are stored only as hashes", () => {
  const { token, tokenHash } = newSessionToken();
  assert.notEqual(token, tokenHash);
  assert.equal(hashToken(token), tokenHash);
});

test("local storage adapter encrypts at rest and blocks path traversal", async () => {
  const dir = await mkdtemp(join(tmpdir(), "fc-"));
  const key = randomBytes(32).toString("base64");
  const s = new LocalEncryptedDiskAdapter(dir, key);
  const data = Buffer.from("SAMPLE MVR — fictional driver");
  await s.put("org_A/doc1", data, "text/plain");
  const raw = await readFile(join(dir, "org_A/doc1"));
  assert.equal(raw.includes(data), false);
  assert.deepEqual(await s.get("org_A/doc1"), data);
  await assert.rejects(s.put("../escape", data, "text/plain"));
  assert.equal(s.production, false);
});
