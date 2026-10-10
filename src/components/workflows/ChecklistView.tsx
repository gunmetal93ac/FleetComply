"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveAction, checkAction, itemAction, reopenAction, statusAction } from "@/app/actions/runs";
import { allowedTransitions, isCheckedOff, STATUS_LABEL, type ItemStatus } from "@/lib/workflows/status";
import { CHECKLIST_LABELS as L, checklistProgress, isActionable, nextActions, orderForDisplay, priorityOf, type PriorityTier } from "@/lib/workflows/priority";
import { ActionRow, ContentReviewBadge, DeadlineBadge, ReviewAndApplicability, NextActionPanel, ProgressHeader, RequiredActions, StageHeading, TierBadge, TierHeading, type NextItem } from "@/components/checklist/Checklist";
import { APPROVAL_DISCLAIMER } from "@/lib/workflows/review";
import type { Classification, RegulatoryRule } from "@/lib/rules/types";
import { Alert, Badge, Button, Card, CardBody, CardHeader, CardTitle, Input, Label, Progress, Select, Textarea, cn } from "@/components/ui";
import { BlockerBadge, ClassificationBadge, StatusBadge, VerificationBadge } from "@/components/badges";

export interface ViewItem {
  id: string;
  stage: string;
  title: string;
  classification: Classification;
  reasons: string[];
  blocksSafetySensitive: boolean;
  status: ItemStatus;
  dueAt: string | null;
  assigneeId: string | null;
  notes: string | null;
  completionDate: string | null;
  completedBy: string | null;
  verifiedBy: string | null;
  verifiedAt: string | null;
  naReason: string | null;
  blockedReason: string | null;
  overrideFlag: boolean;
  rule: RegulatoryRule;
  documents: Array<{ id: string; filename: string; size: number; createdAt: string; version: number }>;
  events: Array<{ id: string; kind: string; fromStatus: string | null; toStatus: string | null; note: string | null; actor: string; at: string }>;
}

interface Summary {
  progressPct: number;
  resolved: number;
  mustResolve: number;
  blockers: number;
  overdue: number;
  undetermined: number;
  pendingVerification: number;
  safetySensitiveCleared: boolean;
  readyForReview: boolean;
  issues: string[];
}

type Filter = "all" | "open" | "blockers" | "pending" | "na";

const ACTION_LABEL: Partial<Record<ItemStatus, string>> = {
  IN_PROGRESS: "Start / reopen",
  PENDING_VERIFICATION: "Submit for verification",
  COMPLETED: "Verify & complete",
  NOT_APPLICABLE: "Mark not applicable",
  BLOCKED: "Mark blocked",
  NOT_STARTED: "Reset to not started",
};
const NEEDS_REASON: ItemStatus[] = ["NOT_APPLICABLE", "BLOCKED"];

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—");

type Action = ViewItem & { ruleId: string; due: Date | null };

export function ChecklistView(props: {
  runId: string;
  runStatus: string;
  /** Group by urgency instead of by workflow stage (accidents, out-of-service orders, breakdowns). */
  emergency?: boolean;
  items: ViewItem[];
  team: Array<{ id: string; name: string }>;
  summary: Summary;
  canVerify: boolean;
  canEdit: boolean;
  canUpload: boolean;
  canApprove: boolean;
  approval: { by: string; at: string; note: string | null } | null;
}) {
  const { items, runId, runStatus, canEdit } = props;
  const emergency = !!props.emergency;
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rowError, setRowError] = useState<{ id: string; message: string } | null>(null);
  const [, start] = useTransition();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  const locked = runStatus !== "ACTIVE";

  // `dueAt` here is what the priority module reads; the wire format keeps the ISO string.
  const all = useMemo(() => items.map((i) => ({ ...i, ruleId: i.rule.id, due: i.dueAt ? new Date(i.dueAt) : null })), [items]);
  const asPriority = (i: Action) => ({ ruleId: i.ruleId, rule: i.rule, classification: i.classification, dueAt: i.due, ref: i });
  const actions = useMemo(
    () => orderForDisplay(all.filter((i) => isActionable(i) && i.status !== "NOT_APPLICABLE").map(asPriority), emergency).map((p) => p.ref),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [all, emergency],
  );
  const notApplicable = all.filter((i) => !isActionable(i) || i.status === "NOT_APPLICABLE");
  const tierOf = new Map(actions.map((i) => [i.id, priorityOf(asPriority(i))] as const));

  const progress = checklistProgress(actions, (i) => isCheckedOff(i.status));
  const awaiting = actions.filter((i) => i.status === "PENDING_VERIFICATION").length;
  const nextRaw = nextActions(actions.map(asPriority), (p) => ({ done: isCheckedOff(p.ref.status), blockedReason: p.ref.status === "BLOCKED" ? p.ref.blockedReason ?? "Marked as blocked." : null }), new Date(now));
  const toNext = (p: ReturnType<typeof asPriority>): NextItem => ({ id: p.ref.id, title: p.ref.title, tier: tierOf.get(p.ref.id)!.tier, rule: p.rule, dueAt: p.dueAt });
  const next = { allDone: nextRaw.allDone, primary: nextRaw.primary.map(toNext), alsoUrgent: nextRaw.alsoUrgent.map(toNext), blocked: nextRaw.blocked.map((b) => ({ item: toNext(b.item), reason: b.reason })) };

  const shown = actions.filter((i) => {
    if (filter === "open") return !isCheckedOff(i.status);
    if (filter === "blockers") return i.blocksSafetySensitive && i.status !== "COMPLETED";
    if (filter === "pending") return i.status === "PENDING_VERIFICATION";
    if (filter === "na") return false;
    return true;
  });
  const groups: Array<{ key: string; heading: React.ReactNode; items: Action[] }> = emergency
    ? ([1, 2, 3, 4, 5] as PriorityTier[])
        .map((t) => ({ t, items: shown.filter((i) => tierOf.get(i.id)!.tier === t) }))
        .filter((g) => g.items.length)
        .map((g) => ({ key: `tier-${g.t}`, heading: <TierHeading tier={g.t} count={g.items.length} />, items: g.items }))
    : [...new Set(shown.map((i) => i.stage))].map((stage, si) => ({ key: stage, heading: <StageHeading n={si + 1} title={stage} />, items: shown.filter((i) => i.stage === stage) }));

  const toggle = (i: Action) => {
    setBusyId(i.id);
    setRowError(null);
    start(async () => {
      const res = await checkAction(runId, i.id, !isCheckedOff(i.status));
      if (!res.ok) setRowError({ id: i.id, message: res.error });
      setBusyId(null);
      router.refresh();
    });
  };

  return (
    <div className="space-y-5">
      <SummaryBar {...props}>
        <ProgressHeader
          progress={progress}
          note={awaiting > 0 ? `${awaiting} checked off and awaiting verification by a Safety Manager, Admin or Owner.` : undefined}
        />
        <NextActionPanel next={next} now={now} emergency={emergency} />
      </SummaryBar>

      <div className="no-print flex flex-wrap gap-1.5">
        {(["all", "open", "blockers", "pending", "na"] as Filter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={cn("min-h-9 rounded-full px-3 py-1.5 text-xs font-medium", filter === f ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}
          >
            {{ all: "All actions", open: "Remaining", blockers: "Restrictions", pending: "Awaiting verification", na: "Not applicable" }[f]}
          </button>
        ))}
      </div>

      {filter !== "na" && groups.length === 0 && <p className="rounded-xl border border-slate-200 bg-white px-5 py-6 text-sm text-slate-500">Nothing in this view.</p>}
      {groups.map((g) => (
        <section key={g.key}>
          {g.heading}
          <ol className="space-y-3">
            {g.items.map((i) => {
              const p = tierOf.get(i.id)!;
              const checked = isCheckedOff(i.status);
              return (
                <ActionRow
                  key={i.id}
                  id={i.id}
                  title={i.title}
                  summary={i.rule.purpose}
                  tier={p.tier}
                  checked={checked}
                  onToggle={() => toggle(i)}
                  busy={busyId === i.id}
                  disabledReason={locked ? "This checklist is approved. Reopen it to make changes." : !canEdit ? "Your role cannot change checklist items." : undefined}
                  error={rowError?.id === i.id ? rowError.message : null}
                  lazy
                  badges={
                    <>
                      {p.tier <= 3 && <TierBadge tier={p.tier} />}
                      {i.status !== "NOT_STARTED" && <StatusBadge value={i.status} />}
                      {i.classification === "UNABLE_TO_DETERMINE" && <Badge tone="amber">{L.needsDecision}</Badge>}
                      <ContentReviewBadge rule={i.rule} />
                      {(i.due || p.tier <= 3) && <DeadlineBadge rule={i.rule} dueAt={i.due} now={now} done={checked} />}
                    </>
                  }
                  alwaysVisible={p.tier === 1 ? <RequiredActions rule={i.rule} /> : undefined}
                >
                  <p className="mb-3 text-xs text-slate-500">Position in this checklist: {p.basis}</p>
                  <ItemDetail item={i} {...props} />
                </ActionRow>
              );
            })}
          </ol>
        </section>
      ))}

      {(filter === "na" || filter === "all") && notApplicable.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{L.notApplicable} · {notApplicable.length}</h2>
          <ol className="space-y-3">
            {notApplicable.map((i) => (
              <ActionRow key={i.id} id={i.id} title={i.title} summary={i.naReason ? `Marked not applicable: ${i.naReason}` : i.reasons[0] ?? i.rule.purpose} tier={5} checked={false} informational lazy badges={i.status !== "NOT_APPLICABLE" ? <StatusBadge value={i.status} /> : undefined}>
                <ItemDetail item={i} {...props} />
              </ActionRow>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
function SummaryBar({ runId, runStatus, summary, canApprove, approval, children }: Parameters<typeof ChecklistView>[0] & { children: React.ReactNode }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <Card>
      <CardBody className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0 space-y-4">
          {children}
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-slate-600">{summary.resolved} of {summary.mustResolve} required items verified or resolved</span>
            {summary.blockers > 0 ? (
              <Badge tone="red">{summary.blockers} blocking safety-sensitive work</Badge>
            ) : (
              <Badge tone="green">No open blockers on this checklist</Badge>
            )}
            {summary.overdue > 0 && <Badge tone="red">{summary.overdue} overdue</Badge>}
            {summary.undetermined > 0 && <Badge tone="amber">{summary.undetermined} need a decision</Badge>}
            {summary.pendingVerification > 0 && <Badge tone="amber">{summary.pendingVerification} awaiting verification</Badge>}
          </div>
          {!summary.safetySensitiveCleared && (
            <p className="text-sm text-red-700">
              Do not allow safety-sensitive functions until every blocking item is <strong>verified</strong> complete — a checked box alone does not clear it.
            </p>
          )}
        </div>
        <div className="lg:w-[300px]">
          {runStatus === "APPROVED" && approval ? (
            <div className="text-sm">
              <p className="font-semibold text-green-800">Reviewed & approved by {approval.by}</p>
              <p className="text-slate-600">{fmtDate(approval.at)}</p>
              {approval.note && <p className="mt-1 text-slate-700">“{approval.note}”</p>}
              {canApprove && (
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  disabled={pending}
                  onClick={() => {
                    const reason = prompt("Why are you reopening this workflow?") ?? "";
                    start(async () => {
                      const r = await reopenAction(runId, reason);
                      if (!r.ok) setErr(r.error);
                      router.refresh();
                    });
                  }}
                >
                  Reopen
                </Button>
              )}
            </div>
          ) : canApprove ? (
            <div className="space-y-2">
              <Label htmlFor="approval-note">Final review</Label>
              <Textarea id="approval-note" placeholder="What did you check? (required)" value={note} onChange={(e) => setNote(e.target.value)} disabled={!summary.readyForReview} />
              <Button
                size="sm"
                disabled={!summary.readyForReview || pending}
                onClick={() =>
                  start(async () => {
                    setErr(null);
                    const r = await approveAction(runId, note);
                    if (!r.ok) setErr(r.error);
                    router.refresh();
                  })
                }
              >
                Approve after review
              </Button>
              {!summary.readyForReview && <p className="text-xs text-slate-500">Available once every required item is completed (verified) or resolved.</p>}
              <p className="text-xs text-slate-500">{APPROVAL_DISCLAIMER}</p>
            </div>
          ) : (
            <p className="text-sm text-slate-500">A Safety Manager, Admin or Owner approves this workflow.</p>
          )}
          {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
        </div>
      </CardBody>
    </Card>
  );
}

function ItemDetail({ item, runId, runStatus, team, canVerify, canEdit, canUpload }: { item: ViewItem } & Omit<Parameters<typeof ChecklistView>[0], "items">) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [completionDate, setCompletionDate] = useState(item.completionDate ?? "");
  const [notes, setNotes] = useState(item.notes ?? "");
  const [due, setDue] = useState(item.dueAt ? item.dueAt.slice(0, 10) : "");
  const [uploading, setUploading] = useState(false);
  const r = item.rule;
  const locked = runStatus !== "ACTIVE";

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Failed");
      else {
        setReason("");
        router.refresh();
      }
    });

  async function upload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    form.set("itemId", item.id);
    setUploading(true);
    setError(null);
    const res = await fetch("/api/documents/upload", { method: "POST", body: form });
    setUploading(false);
    if (!res.ok) setError((await res.json().catch(() => ({}))).error ?? "Upload failed");
    else {
      (e.target as HTMLFormElement).reset();
      router.refresh();
    }
  }

  const transitions = allowedTransitions(item.status).filter((t) => t !== "COMPLETED" || canVerify);

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge value={item.status} />
          <ClassificationBadge value={item.classification} />
          <VerificationBadge status={r.verificationStatus} />
          {item.blocksSafetySensitive && <BlockerBadge />}
        </div>
        <CardTitle className="mt-2 text-lg">{item.title}</CardTitle>
        <p className="text-xs text-slate-500">{r.authority} · {r.jurisdiction === "FEDERAL" ? "Federal" : r.jurisdiction === "STATE" ? "State" : "Company"} · rule {r.id} v{r.version} · record: {r.recordCategory.replaceAll("_", " ").toLowerCase()}</p>
      </CardHeader>
      <CardBody className="space-y-5 text-sm">
        {r.warning && item.status !== "NOT_APPLICABLE" && <Alert tone="red" title="Warning">{r.warning}</Alert>}
        <ReviewAndApplicability rule={r} classification={item.classification} />

        <Section title="Why this is on your checklist">
          <ul className="list-disc space-y-1 pl-5">{item.reasons.map((x) => <li key={x}>{x}</li>)}</ul>
        </Section>
        <Section title="Purpose">{r.purpose}</Section>
        <Section title="Applicability">{r.applicability}</Section>
        <Section title="Required action">
          <ol className="list-decimal space-y-1 pl-5">{r.requiredAction.map((x) => <li key={x}>{x}</li>)}</ol>
        </Section>
        <Section title="Required documentation">
          <ul className="list-disc space-y-1 pl-5">{r.documentation.map((x) => <li key={x}>{x}</li>)}</ul>
        </Section>
        <Section title="Deadline">
          <p>{r.deadline.description}</p>
          {item.dueAt && <p className="mt-1 font-medium">Due: {fmtDate(item.dueAt)}{r.deadline.offsetBusinessDays ? " (weekends skipped; holidays not counted — the legal deadline may be later)" : ""}</p>}
        </Section>
        <Section title="Retention">
          <table className="w-full table-fixed break-words text-left text-sm">
            <thead><tr className="text-xs text-slate-500"><th className="py-1 pr-3">Record</th><th className="py-1 pr-3">Keep for</th><th className="py-1">Source</th></tr></thead>
            <tbody>{r.retention.map((x) => <tr key={x.record} className="border-t border-slate-100"><td className="py-1 pr-3">{x.record}</td><td className="py-1 pr-3">{x.period}</td><td className="py-1">{x.citation ?? "—"}</td></tr>)}</tbody>
          </table>
        </Section>
        <Section title="Regulatory reference">
          <ul className="space-y-1">
            {r.sources.map((s) => (
              <li key={s.citation}>
                {s.url.startsWith("http") ? <a className="text-brand-700 underline" href={s.url} target="_blank" rel="noreferrer noopener">{s.citation}</a> : s.citation}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-slate-500">Effective {r.effectiveDate} · last verified {r.lastVerified ?? "not verified"}</p>
        </Section>
        <Section title="Exceptions">{r.exceptions}</Section>
        <Section title="How to verify">{r.verification}</Section>

        <hr className="border-slate-200" />

        {/* ── Status ── */}
        <div className="space-y-3">
          <h3 className="font-semibold">Status</h3>
          {item.naReason && <p>Not applicable because: {item.naReason}{item.overrideFlag && <Badge tone="amber" className="ml-2">User override</Badge>}</p>}
          {item.blockedReason && <p className="text-red-700">Blocked: {item.blockedReason}</p>}
          {item.completedBy && <p>Submitted by {item.completedBy}{item.completionDate ? ` · completed on ${item.completionDate}` : ""}</p>}
          {item.verifiedBy && <p className="text-green-800">Verified by {item.verifiedBy} · {fmtDate(item.verifiedAt)}</p>}
          {canEdit && !locked && (
            <>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="completionDate">Completion date</Label>
                  <Input id="completionDate" type="date" value={completionDate} onChange={(e) => setCompletionDate(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="reason">Reason / note for this change</Label>
                  <Input id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Required for N/A, blocked, rejection, reopen" />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {transitions.map((t) => (
                  <Button
                    key={t}
                    size="sm"
                    variant={t === "COMPLETED" ? "primary" : t === "NOT_APPLICABLE" || t === "BLOCKED" ? "outline" : "secondary"}
                    disabled={pending || (NEEDS_REASON.includes(t) && !reason.trim())}
                    onClick={() => run(() => statusAction(runId, item.id, t, reason || undefined, completionDate || undefined))}
                  >
                    {item.status === "PENDING_VERIFICATION" && t === "IN_PROGRESS" ? "Reject — send back" : ACTION_LABEL[t] ?? STATUS_LABEL[t]}
                  </Button>
                ))}
              </div>
            </>
          )}
          {locked && <p className="text-slate-500">This workflow is approved. Reopen it to make changes.</p>}
        </div>

        {/* ── Assignment & deadline ── */}
        {canEdit && !locked && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="assignee">Responsible person</Label>
              <Select
                id="assignee"
                value={item.assigneeId ?? ""}
                disabled={pending}
                onChange={(e) => run(() => itemAction(runId, item.id, { kind: "assign", assigneeId: e.target.value || null }))}
              >
                <option value="">Unassigned</option>
                {team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="due">Internal deadline</Label>
              <div className="flex gap-2">
                <Input id="due" type="date" value={due} onChange={(e) => setDue(e.target.value)} />
                <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => itemAction(runId, item.id, { kind: "deadline", dueAt: due ? `${due}T23:59:00` : null }))}>Save</Button>
              </div>
              <p className="mt-1 text-xs text-slate-500">Changing this does not change the legal deadline above.</p>
            </div>
          </div>
        )}

        {/* ── Notes ── */}
        <div>
          <Label htmlFor="notes">Notes</Label>
          <Textarea id="notes" value={notes} onChange={(e) => setNotes(e.target.value)} disabled={!canEdit || locked} />
          {canEdit && !locked && (
            <Button size="sm" variant="outline" className="mt-2" disabled={pending || notes === (item.notes ?? "")} onClick={() => run(() => itemAction(runId, item.id, { kind: "notes", notes }))}>
              Save notes
            </Button>
          )}
        </div>

        {/* ── Evidence ── */}
        <div>
          <h3 className="font-semibold">Supporting documents</h3>
          {item.documents.length === 0 ? <p className="text-slate-500">None attached.</p> : (
            <ul className="mt-1 space-y-1">
              {item.documents.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2">
                  <a className="text-brand-700 underline" href={`/api/documents/${d.id}`}>{d.filename}</a>
                  <span className="text-xs text-slate-500">v{d.version} · {(d.size / 1024).toFixed(0)} KB · {new Date(d.createdAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          )}
          {canUpload && !locked && (
            <form onSubmit={upload} className="mt-2 flex flex-wrap items-end gap-2">
              <Input name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,.heic,.tif,.tiff,.doc,.docx,.txt" className="max-w-xs" />
              <Input name="expiresOn" type="date" className="w-40" title="Document expiration (optional)" />
              <Button size="sm" type="submit" disabled={uploading}>{uploading ? "Uploading…" : "Upload"}</Button>
            </form>
          )}
          <p className="mt-1 text-xs text-slate-500">Uploading a file does not mark the item complete — submit it for verification when ready.</p>
        </div>

        {error && <Alert tone="red">{error}</Alert>}

        {/* ── History ── */}
        <div>
          <h3 className="font-semibold">History</h3>
          {item.events.length === 0 ? <p className="text-slate-500">No changes yet.</p> : (
            <ol className="mt-1 space-y-1 text-xs text-slate-600">
              {item.events.map((e) => (
                <li key={e.id}>
                  <span className="font-medium text-slate-800">{fmtDate(e.at)}</span> · {e.actor} ·{" "}
                  {e.kind === "STATUS" ? `${STATUS_LABEL[e.fromStatus as ItemStatus]} → ${STATUS_LABEL[e.toStatus as ItemStatus]}` : e.kind.toLowerCase()}
                  {e.note && <> — “{e.note}”</>}
                </li>
              ))}
            </ol>
          )}
        </div>
      </CardBody>
    </Card>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="text-slate-800">{children}</div>
    </section>
  );
}
