/**
 * Grant or revoke FleetComply platform-administrator access.
 *
 *   npm.cmd run admin:grant -- someone@example.com
 *   npm.cmd run admin:grant -- someone@example.com --revoke
 *   npm.cmd run admin:grant -- --list
 *
 * Platform administrators can open Regulatory Intelligence and, in later stages, approve
 * changes to the shared compliance library. This is deliberately a command-line step:
 * there is no screen in the application that can grant it, and it is separate from the
 * customer roles (Owner, Admin, …), which only apply inside one company.
 */
import { PrismaClient } from "@prisma/client";

const args = process.argv.slice(2);
const revoke = args.includes("--revoke");
const list = args.includes("--list");
const email = args.find((a) => !a.startsWith("--"))?.trim().toLowerCase();
const prisma = new PrismaClient();

async function main() {
  if (list) {
    const admins = await prisma.user.findMany({ where: { platformAdmin: true }, select: { email: true, name: true, mfaEnabled: true, disabled: true } });
    if (!admins.length) return console.log("No platform administrators.");
    for (const a of admins) console.log(`${a.email} — ${a.name}${a.mfaEnabled ? "" : " (two-step verification OFF)"}${a.disabled ? " (account disabled)" : ""}`);
    return;
  }
  if (!email) throw new Error("Usage: npm.cmd run admin:grant -- <email> [--revoke] | --list");

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`No user with email ${email}. The person must have an account first.`);
  if (user.platformAdmin === !revoke) return console.log(`${email} is already ${revoke ? "not a platform administrator" : "a platform administrator"} — nothing changed.`);

  await prisma.$transaction([
    prisma.user.update({ where: { id: user.id }, data: { platformAdmin: !revoke } }),
    prisma.auditLog.create({
      data: { orgId: user.orgId, actorId: null, action: revoke ? "platform_admin.revoke" : "platform_admin.grant", entityType: "User", entityId: user.id, meta: { email, via: "scripts/grant-platform-admin.ts" } },
    }),
  ]);
  console.log(`${revoke ? "Revoked platform administrator from" : "Granted platform administrator to"} ${email}.`);
  if (!revoke && !user.mfaEnabled) console.log("Recommendation: turn on two-step verification for this account (Settings) before it is used to approve anything.");
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
