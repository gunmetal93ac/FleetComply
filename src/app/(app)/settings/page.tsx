import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";
import { can, ROLE_LABEL, type Role } from "@/lib/auth/rbac";
import { AddUserForm, MfaSetup, OrgForm } from "@/components/settings/SettingsForms";
import { Card, CardBody, CardHeader, CardTitle, PageHeader } from "@/components/ui";

export default async function SettingsPage() {
  const user = await requireUser();
  const [org, team, audit] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: user.orgId } }),
    prisma.user.findMany({ where: { orgId: user.orgId }, orderBy: { name: "asc" } }),
    can(user.role, "audit:read") ? prisma.auditLog.findMany({ where: { orgId: user.orgId }, orderBy: { at: "desc" }, take: 25 }) : Promise.resolve([]),
  ]);
  const names = Object.fromEntries(team.map((t) => [t.id, t.name]));
  return (
    <>
      <PageHeader title="Settings" />
      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Company profile</CardTitle></CardHeader>
          <CardBody><OrgForm org={org} disabled={!can(user.role, "org:manage")} /></CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>Your security</CardTitle></CardHeader>
          <CardBody><MfaSetup enabled={user.mfaEnabled} email={user.email} /></CardBody>
        </Card>
        <Card>
          <CardHeader><CardTitle>Team</CardTitle></CardHeader>
          <CardBody className="space-y-4">
            <ul className="space-y-1 text-sm">
              {team.map((t) => (
                <li key={t.id} className="flex justify-between"><span>{t.name} <span className="text-slate-500">· {t.email}</span></span><span className="text-slate-600">{ROLE_LABEL[t.role as Role]}{t.mfaEnabled ? " · MFA" : ""}</span></li>
              ))}
            </ul>
            {can(user.role, "user:manage") && <AddUserForm />}
            <p className="text-xs text-slate-500">Only Safety Managers, Admins and Owners can verify checklist items or approve workflows. The person who submits an item cannot verify it.</p>
          </CardBody>
        </Card>
        {can(user.role, "audit:read") && (
          <Card>
            <CardHeader><CardTitle>Recent audit log</CardTitle></CardHeader>
            <CardBody>
              <ol className="space-y-1 text-xs text-slate-600">
                {audit.map((a) => <li key={a.id}>{a.at.toLocaleString()} · {a.actorId ? names[a.actorId] ?? "Former user" : "system"} · {a.action} · {a.entityType}</li>)}
              </ol>
            </CardBody>
          </Card>
        )}
      </div>
    </>
  );
}
