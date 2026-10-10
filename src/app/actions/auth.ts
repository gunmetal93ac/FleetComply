"use server";

import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { verifyTotp } from "@/lib/auth/totp";
import { completeMfa, createSession, destroySession, getPendingMfaSession } from "@/lib/auth/session";
import { JURISDICTIONS } from "@/lib/rules/state-registry";

export type FormState = { error?: string; fieldErrors?: Record<string, string> } | undefined;

// Simple in-process throttle (development). Production: shared store (e.g. Redis) — see ARCHITECTURE.md.
const attempts = new Map<string, { n: number; until: number }>();
function throttled(key: string): boolean {
  const a = attempts.get(key);
  return !!a && a.n >= 5 && a.until > Date.now();
}
function recordFailure(key: string) {
  const a = attempts.get(key) ?? { n: 0, until: 0 };
  a.n += 1;
  a.until = Date.now() + 15 * 60_000;
  attempts.set(key, a);
}

export async function loginAction(_: FormState, form: FormData): Promise<FormState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return { error: "Enter your email and password." };
  if (throttled(email)) return { error: "Too many attempts. Try again in 15 minutes." };

  const user = await prisma.user.findUnique({ where: { email } });
  const ok = user && !user.disabled && (await verifyPassword(password, user.passwordHash));
  if (!user || !ok) {
    recordFailure(email);
    return { error: "Email or password is incorrect." };
  }
  attempts.delete(email);
  await createSession(user.id, { mfaPending: user.mfaEnabled });
  await prisma.auditLog.create({ data: { orgId: user.orgId, actorId: user.id, action: "auth.login", entityType: "User", entityId: user.id } });
  redirect(user.mfaEnabled ? "/login/mfa" : "/");
}

export async function mfaAction(_: FormState, form: FormData): Promise<FormState> {
  const pending = await getPendingMfaSession();
  if (!pending) redirect("/login");
  const code = String(form.get("code") ?? "").trim();
  const key = `mfa:${pending.userId}`;
  if (throttled(key)) return { error: "Too many attempts. Sign in again later." };
  if (!pending.user.mfaSecret || !verifyTotp(pending.user.mfaSecret, code)) {
    recordFailure(key);
    return { error: "That code is not valid." };
  }
  await completeMfa(pending.id, pending.userId);
  redirect("/");
}

const STATES = new Set(JURISDICTIONS.map(([c]) => c));

export async function registerAction(_: FormState, form: FormData): Promise<FormState> {
  const v = (k: string) => String(form.get(k) ?? "").trim();
  const fieldErrors: Record<string, string> = {};
  const companyName = v("companyName");
  const usdotNumber = v("usdotNumber");
  const baseState = v("baseState");
  const name = v("name");
  const email = v("email").toLowerCase();
  const password = String(form.get("password") ?? "");
  const preEmploymentAlcoholTesting = form.get("preEmploymentAlcoholTesting") === "on";

  if (!companyName) fieldErrors.companyName = "Required";
  if (usdotNumber && !/^\d{1,8}$/.test(usdotNumber)) fieldErrors.usdotNumber = "USDOT numbers are digits only";
  if (!STATES.has(baseState)) fieldErrors.baseState = "Choose a state";
  if (!name) fieldErrors.name = "Required";
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fieldErrors.email = "Enter a valid email";
  if (password.length < 12) fieldErrors.password = "At least 12 characters";
  if (Object.keys(fieldErrors).length) return { fieldErrors };
  if (await prisma.user.findUnique({ where: { email } })) return { fieldErrors: { email: "An account with this email already exists" } };

  const passwordHash = await hashPassword(password);
  const user = await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: { name: companyName, usdotNumber: usdotNumber || null, baseState, preEmploymentAlcoholTesting },
    });
    const u = await tx.user.create({ data: { orgId: org.id, email, name, role: "OWNER", passwordHash } });
    await tx.auditLog.create({ data: { orgId: org.id, actorId: u.id, action: "org.create", entityType: "Organization", entityId: org.id } });
    return u;
  });
  await createSession(user.id, { mfaPending: false });
  redirect("/");
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}
