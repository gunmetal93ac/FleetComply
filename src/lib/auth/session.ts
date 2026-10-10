import "server-only";
import { cookies, headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma, repo } from "../db";
import { hashToken, MFA_PENDING_TTL_MS, newSessionToken, SESSION_TTL_MS } from "./tokens";
import type { Role } from "./rbac";
import { assertCan, isPlatformAdmin, type Permission } from "./rbac";

export const SESSION_COOKIE = "fc_session";

export interface CurrentUser {
  id: string;
  orgId: string;
  email: string;
  name: string;
  role: Role;
  mfaEnabled: boolean;
  /** FleetComply operator flag — separate from the customer `role`. */
  platformAdmin: boolean;
  org: { id: string; name: string; isSample: boolean; baseState: string | null; preEmploymentAlcoholTesting: boolean };
}

async function setCookie(token: string, maxAgeMs: number) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.COOKIE_SECURE === "true",
    path: "/",
    maxAge: Math.floor(maxAgeMs / 1000),
  });
}

export async function createSession(userId: string, opts: { mfaPending: boolean }) {
  const { token, tokenHash } = newSessionToken();
  const h = await headers();
  const ttl = opts.mfaPending ? MFA_PENDING_TTL_MS : SESSION_TTL_MS;
  await prisma.session.create({
    data: {
      userId,
      tokenHash,
      mfaPending: opts.mfaPending,
      expiresAt: new Date(Date.now() + ttl),
      ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
    },
  });
  await setCookie(token, ttl);
}

async function rawSession() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { org: true } } },
  });
  if (!s || s.expiresAt < new Date() || s.user.disabled) return null;
  return s;
}

/** Session waiting for the second factor. */
export async function getPendingMfaSession() {
  const s = await rawSession();
  return s?.mfaPending ? s : null;
}

/** Upgrade an MFA-pending session: rotate the token so the pre-MFA token can't be reused. */
export async function completeMfa(sessionId: string, userId: string) {
  await prisma.session.delete({ where: { id: sessionId } });
  await createSession(userId, { mfaPending: false });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const s = await rawSession();
  if (!s || s.mfaPending) return null;
  const u = s.user;
  return {
    id: u.id,
    orgId: u.orgId,
    email: u.email,
    name: u.name,
    role: u.role as Role,
    mfaEnabled: u.mfaEnabled,
    platformAdmin: u.platformAdmin,
    org: {
      id: u.org.id,
      name: u.org.name,
      isSample: u.org.isSample,
      baseState: u.org.baseState,
      preEmploymentAlcoholTesting: u.org.preEmploymentAlcoholTesting,
    },
  };
}

export async function requireUser(permission?: Permission): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (permission) assertCan(u.role, permission);
  return u;
}

/**
 * Server-side gate for Regulatory Intelligence. Signed-out visitors go to login; signed-in
 * users who are not platform administrators get a 404, so the area's existence is not
 * disclosed. Hiding the navigation link is not relied on.
 */
export async function requirePlatformAdmin(): Promise<CurrentUser> {
  const u = await getCurrentUser();
  if (!u) redirect("/login");
  if (!isPlatformAdmin(u)) notFound();
  return u;
}

/** Convenience: authenticated user + their tenant repository. */
export async function requireTenant(permission?: Permission) {
  const user = await requireUser(permission);
  return { user, r: repo(user.orgId) };
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  jar.delete(SESSION_COOKIE);
}
