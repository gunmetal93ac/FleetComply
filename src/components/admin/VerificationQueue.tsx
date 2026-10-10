import Link from "next/link";
import { prisma } from "@/lib/db";
import { prismaVerificationStore } from "@/lib/regulatory/verification-store";
import { buildQueue, flagReverification, openFindings, STATUS_LABEL, VERIFICATION_STATUSES, type PriorityLevel, type VerificationStatus } from "@/lib/regulatory/verification";
import { WORKFLOWS } from "@/lib/workflows/definitions";
import type { WorkflowKey } from "@/lib/rules/types";
import { Badge, Card, CardBody, CardHeader, CardTitle, cn, type Tone } from "@/components/ui";

export interface QueueSearch {
  vst?: string; // review status
  vw?: string; // workflow
  vsafe?: string; // "1" = safety-sensitive only
  vem?: string; // "1" = emergency-relevant only
}

export const STATUS_TONE: Record<VerificationStatus, Tone> = {
  NOT_REVIEWED: "slate",
  REVIEW_REQUIRED: "amber",
  SOURCE_CHECKED: "blue",
  CORRECTION_REQUESTED: "red",
  APPROVED_AWAITING_PUBLICATION: "purple",
  REVIEWED_PUBLISHED: "green",
  REVERIFICATION_REQUIRED: "red",
};
export const LEVEL_TONE: Record<PriorityLevel, Tone> = { HIGHEST: "red", HIGH: "amber", NORMAL: "blue", LOW: "slate" };
const LEVEL_LABEL: Record<PriorityLevel, string> = { HIGHEST: "Highest", HIGH: "High", NORMAL: "Normal", LOW: "Low" };

/**
 * Regulatory Verification Queue — every step whose guidance is pending review, most important
 * first. Administrator-only (the page enforces it). Listing and priority are by fixed rules; the
 * order says what to look at first, not whether a step is right.
 */
export async function VerificationQueue({ sp, basePath }: { sp: QueueSearch & Record<string, string | undefined>; basePath: string }) {
  const store = prismaVerificationStore(prisma);
  // Published guidance whose cited sections changed since the review is moved to "reverification required" here.
  await flagReverification(store);
  const [states, corrections] = await Promise.all([store.listStates(), store.listCorrectionVersions()]);
  const queue = buildQueue(states, corrections);
  const assignees = await prisma.user.findMany({ where: { id: { in: states.map((s) => s.assigneeId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const nameOf = new Map(assignees.map((u) => [u.id, u.name]));

  const shown = queue.filter(
    (i) => (!sp.vst || i.status === sp.vst) && (!sp.vw || i.rule.workflows.includes(sp.vw as WorkflowKey)) && (sp.vsafe !== "1" || i.safetySensitive) && (sp.vem !== "1" || i.emergencyRelevant),
  );
  const workflows = [...new Set(queue.flatMap((i) => i.rule.workflows))].sort();
  const qs = (patch: Partial<QueueSearch>) => {
    const next = { ...sp, ...patch };
    const s = Object.entries(next).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&");
    return `${basePath}${s ? `?${s}` : ""}#verification`;
  };
  const count = (st: VerificationStatus) => queue.filter((i) => i.status === st).length;

  return (
    <Card id="verification" className="scroll-mt-24">
      <CardHeader className="space-y-3">
        <CardTitle>Regulatory Verification Queue ({shown.length}{shown.length !== queue.length ? ` of ${queue.length}` : ""})</CardTitle>
        <p className="text-sm text-slate-600">
          Steps whose guidance has not been reviewed and approved by an administrator. Retrieving a source is evidence, not approval; approving does not change what customers see until you publish;
          and neither says anything about whether a particular customer qualifies.
        </p>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <Filter label="Review status">
            <Chip href={qs({ vst: undefined })} active={!sp.vst}>All</Chip>
            {VERIFICATION_STATUSES.filter((s) => count(s) > 0).map((s) => <Chip key={s} href={qs({ vst: s })} active={sp.vst === s}>{STATUS_LABEL[s]} · {count(s)}</Chip>)}
          </Filter>
          <Filter label="Show">
            <Chip href={qs({ vsafe: sp.vsafe === "1" ? undefined : "1" })} active={sp.vsafe === "1"}>Safety-sensitive only</Chip>
            <Chip href={qs({ vem: sp.vem === "1" ? undefined : "1" })} active={sp.vem === "1"}>Emergency workflows only</Chip>
          </Filter>
          <Filter label="Workflow">
            <Chip href={qs({ vw: undefined })} active={!sp.vw}>All</Chip>
            {workflows.map((w) => <Chip key={w} href={qs({ vw: w })} active={sp.vw === w}>{WORKFLOWS[w]?.title ?? w}</Chip>)}
          </Filter>
        </div>
      </CardHeader>
      <CardBody className="p-0">
        {shown.length === 0 && <p className="px-5 py-6 text-sm text-slate-500">Nothing matches these filters.</p>}
        <ul className="divide-y divide-slate-100">
          {shown.map((i) => {
            // Findings still awaiting an administrator: not informational, not removed by a draft correction, not yet dealt with.
            const problems = openFindings(i.findings, i.state.findingReviews, i.state.proposedCorrection ? "PROPOSED" : "CURRENT");
            return (
              <li key={i.rule.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/admin/regulatory/verification/${encodeURIComponent(i.rule.id)}`} className="font-semibold text-navy-800 hover:text-brand-700">{i.live.title}</Link>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {i.rule.workflows.map((w) => WORKFLOWS[w]?.title ?? w).join(" · ")}
                      {i.scenarios.length > 0 && <> — {i.scenarios.slice(0, 3).map((s, k) => <span key={s.n}>{k > 0 && ", "}<Link className="text-brand-700 hover:underline" href={s.href}>{s.title}</Link></span>)}{i.scenarios.length > 3 && ` and ${i.scenarios.length - 3} more`}</>}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge tone={STATUS_TONE[i.status]}>{STATUS_LABEL[i.status]}</Badge>
                      <Badge tone={LEVEL_TONE[i.priority.level]}>{LEVEL_LABEL[i.priority.level]} priority</Badge>
                      {i.safetySensitive && <Badge tone="red">Safety-sensitive</Badge>}
                      {i.exemption && <Badge tone="amber">Exemption claim</Badge>}
                      {problems.length > 0 && <Badge tone="amber">{problems.length} open finding{problems.length === 1 ? "" : "s"}</Badge>}
                    </div>
                    <p className="mt-2 text-sm text-slate-700"><span className="font-medium">Claim:</span> {i.live.requiredAction[0]}{i.live.requiredAction.length > 1 && ` (+${i.live.requiredAction.length - 1} more)`}</p>
                    <p className="mt-1 text-xs text-slate-600"><span className="font-medium">Cites:</span> {i.live.sources.map((s) => s.citation).join("; ")}</p>
                    <p className="mt-1 text-xs text-slate-600"><span className="font-medium">Why review is needed:</span> {i.rule.verificationNote ?? "—"}</p>
                    {i.priority.reasons.length > 0 && <p className="mt-1 text-xs text-slate-500">Priority: {i.priority.reasons.join(" · ")}</p>}
                  </div>
                  <div className="shrink-0 text-right text-xs text-slate-500">
                    <p>Last checked: <span className="font-medium text-slate-700">{i.lastChecked ?? "never"}</span></p>
                    <p>Reviewer: <span className="font-medium text-slate-700">{i.state.assigneeId ? nameOf.get(i.state.assigneeId) ?? "Former user" : "unassigned"}</span></p>
                    <Link href={`/admin/regulatory/verification/${encodeURIComponent(i.rule.id)}`} className="mt-2 inline-block rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">Review</Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </CardBody>
    </Card>
  );
}

function Filter({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-1"><span className="mr-1 font-medium text-slate-500">{label}</span>{children}</div>;
}
function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return <Link href={href} className={cn("rounded-full px-2.5 py-1 font-medium", active ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>{children}</Link>;
}
