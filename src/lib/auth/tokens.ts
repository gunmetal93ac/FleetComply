import { createHash, randomBytes } from "node:crypto";

/** Session tokens: the cookie holds the raw token; the database stores only its SHA-256. */
export function newSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const MFA_PENDING_TTL_MS = 5 * 60 * 1000; // 5 minutes to enter the code
