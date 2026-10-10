"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { hashPassword } from "@/lib/auth/password";
import { generateTotpSecret, verifyTotp } from "@/lib/auth/totp";
import type { Role } from "@/lib/auth/rbac";
import { JURISDICTIONS } from "@/lib/rules/state-registry";

export type SettingsState = { ok?: string; error?: string; secret?: string } | undefined;
const ROLES: Role[] = ["ADMIN", "SAFETY_MANAGER", "HR", "DISPATCH", "VIEWER"];

export async function updateOrgAction(_: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser("org:manage");
  const name = String(form.get("name") ?? "").trim();
  const usdotNumber = String(form.get("usdotNumber") ?? "").trim();
  const baseState = String(form.get("baseState") ?? "");
  if (!name) return { error: "Company name is required." };
  if (usdotNumber && !/^\d{1,8}$/.test(usdotNumber)) return { error: "USDOT numbers are digits only." };
  if (!JURISDICTIONS.some(([c]) => c === baseState)) return { error: "Choose a base state." };
  const preEmploymentAlcoholTesting = form.get("preEmploymentAlcoholTesting") === "on";
  await prisma.organization.update({ where: { id: user.orgId }, data: { name, usdotNumber: usdotNumber || null, baseState, preEmploymentAlcoholTesting } });
  await prisma.auditLog.create({ data: { orgId: user.orgId, actorId: user.id, action: "org.update", entityType: "Organization", entityId: user.orgId, meta: { preEmploymentAlcoholTesting } } });
  revalidatePath("/settings");
  return { ok: "Company profile saved. New workflows will use these settings; existing checklists are not changed." };
}

export async function addUserAction(_: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser("user:manage");
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const name = String(form.get("name") ?? "").trim();
  const role = String(form.get("role") ?? "") as Role;
  const password = String(form.get("password") ?? "");
  if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { error: "Enter a name and a valid email." };
  if (!ROLES.includes(role)) return { error: "Choose a role." };
  if (password.length < 12) return { error: "Temporary password must be at least 12 characters." };
  if (await prisma.user.findUnique({ where: { email } })) return { error: "A user with that email already exists." };
  const u = await prisma.user.create({ data: { orgId: user.orgId, email, name, role, passwordHash: await hashPassword(password) } });
  await prisma.auditLog.create({ data: { orgId: user.orgId, actorId: user.id, action: "user.create", entityType: "User", entityId: u.id, meta: { role } } });
  revalidatePath("/settings");
  return { ok: `${name} added. Share the temporary password securely; email invitations are planned.` };
}

export async function startMfaAction(): Promise<SettingsState> {
  const user = await requireUser();
  const secret = generateTotpSecret();
  // Stored but not enabled until a code is confirmed.
  await prisma.user.update({ where: { id: user.id }, data: { mfaSecret: secret, mfaEnabled: false } });
  return { secret };
}

export async function confirmMfaAction(_: SettingsState, form: FormData): Promise<SettingsState> {
  const user = await requireUser();
  const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const code = String(form.get("code") ?? "").trim();
  if (!row.mfaSecret || !verifyTotp(row.mfaSecret, code)) return { error: "That code didn't match. Check your device clock and try again." };
  await prisma.user.update({ where: { id: user.id }, data: { mfaEnabled: true } });
  await prisma.auditLog.create({ data: { orgId: user.orgId, actorId: user.id, action: "auth.mfa_enabled", entityType: "User", entityId: user.id } });
  revalidatePath("/settings");
  return { ok: "Two-step verification is on." };
}
