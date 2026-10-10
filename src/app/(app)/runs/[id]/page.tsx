import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireTenant } from "@/lib/auth/session";
import { loadRun } from "@/lib/runs";
import { can } from "@/lib/auth/rbac";
import { ChecklistView, type ViewItem } from "@/components/workflows/ChecklistView";
import { RunScenarioDetails } from "@/components/workflows/RunScenarioDetails";
import { WORKFLOWS, type Answers } from "@/lib/workflows/definitions";
import type { Facts, WorkflowKey } from "@/lib/rules/types";
import { isEmergency } from "@/lib/workflows/priority";
import { Alert, Badge, Button, PageHeader } from "@/components/ui";
import { SampleBadge } from "@/components/badges";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, r } = await requireTenant();
  const { run, items, summary } = await loadRun(r, id);
  const team = await prisma.user.findMany({ where: { orgId: user.orgId, disabled: false }, select: { id: true, name: true, role: true }, orderBy: { name: "asc" } });
  const names = Object.fromEntries(team.map((t) => [t.id, t.name]));

  const viewItems: ViewItem[] = items.map((i) => ({
    id: i.id,
    stage: i.stage,
    title: i.title,
    classification: i.classification,
    reasons: i.reasons,
    blocksSafetySensitive: i.blocksSafetySensitive,
    status: i.status,
    dueAt: i.dueAt?.toISOString() ?? null,
    assigneeId: i.assigneeId,
    notes: i.notes,
    completionDate: i.completionDate,
    completedBy: i.completedById ? names[i.completedById] ?? "Former user" : null,
    verifiedBy: i.verifiedById ? names[i.verifiedById] ?? "Former user" : null,
    verifiedAt: i.verifiedAt?.toISOString() ?? null,
    naReason: i.naReason,
    blockedReason: i.blockedReason,
    overrideFlag: i.overrideFlag,
    rule: i.ruleSnapshot,
    documents: i.documents.map((d) => ({ id: d.id, filename: d.filename, size: d.size, createdAt: d.createdAt.toISOString(), version: d.version })),
    events: i.events.map((e) => ({ id: e.id, kind: e.kind, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, actor: names[e.actorId] ?? "Former user", at: e.at.toISOString() })),
  }));

  const warnings = (run.warnings as string[]) ?? [];
  return (
    <>
      <p className="mb-2 text-sm"><Link href="/runs" className="text-brand-700">← All workflow runs</Link></p>
      <PageHeader
        title={run.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>Started {run.createdAt.toLocaleDateString()} · last updated {run.updatedAt.toLocaleDateString()} · rule catalog {run.catalogVersion}</span>
            {run.status === "APPROVED" ? <Badge tone="green">Approved</Badge> : <Badge tone="blue">Active</Badge>}
            {run.driver?.isSample && <SampleBadge />}
          </span>
        }
        actions={
          <>
            <a href={`/api/runs/${run.id}/export`}><Button variant="outline" size="sm">Export CSV</Button></a>
            <Link href={`/runs/${run.id}/report`}><Button variant="outline" size="sm">Compliance report</Button></Link>
          </>
        }
      />
      {warnings.length > 0 && (
        <div className="mb-4 space-y-2">
          {warnings.map((w) => <Alert key={w}>{w}</Alert>)}
        </div>
      )}
      {run.workflowKey in WORKFLOWS && (
        <RunScenarioDetails
          runId={run.id}
          workflowKey={run.workflowKey as WorkflowKey}
          answers={(run.answers ?? {}) as Answers}
          canEdit={run.status === "ACTIVE" && can(user.role, "run:create")}
          lockedReason={run.status !== "ACTIVE" ? "This checklist is approved. Reopen it to edit the answers." : undefined}
        />
      )}
      <ChecklistView
        runId={run.id}
        runStatus={run.status}
        emergency={isEmergency(run.workflowKey, (run.facts ?? {}) as Facts)}
        items={viewItems}
        team={team.map((t) => ({ id: t.id, name: t.name }))}
        summary={{
          progressPct: summary.progressPct,
          resolved: summary.resolved,
          mustResolve: summary.mustResolve,
          blockers: summary.blockersOutstanding.length,
          overdue: summary.overdue.length,
          undetermined: summary.undetermined.length,
          pendingVerification: summary.pendingVerification.length,
          safetySensitiveCleared: summary.safetySensitiveCleared,
          readyForReview: summary.readyForReview,
          issues: summary.issues,
        }}
        canVerify={can(user.role, "item:verify")}
        canEdit={can(user.role, "item:update")}
        canUpload={can(user.role, "document:upload")}
        canApprove={can(user.role, "run:approve")}
        approval={run.approvedAt ? { by: names[run.approvedById!] ?? "Former user", at: run.approvedAt.toISOString(), note: run.approvalNote } : null}
      />
    </>
  );
}
