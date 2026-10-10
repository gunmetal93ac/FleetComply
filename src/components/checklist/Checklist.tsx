"use client";

import { useState } from "react";
import type { Classification, RegulatoryRule } from "@/lib/rules/types";
import { CHECKLIST_LABELS as L, type ChecklistProgress, type NextActions, type PriorityTier } from "@/lib/workflows/priority";
import { Alert, Badge, Progress, cn } from "@/components/ui";
import { ClassificationBadge } from "@/components/badges";
import { applicabilityStatus, contentReview } from "@/lib/rules/content-review";
import { IconBan, IconBook, IconCheck, IconChevronDown, IconClock, IconZap } from "@/components/icons";

/**
 * The simplified checklist: progress, next action, and one row per action with a large checkbox,
 * a short title, a one-line explanation and everything else collapsed.
 * Shared by the public guide and saved checklists — there is one checklist design, not two.
 */

const HOUR = 3_600_000;
const fmtDue = (d: Date) => d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function timeLeft(due: Date, now: number): { text: string; overdue: boolean } {
  const ms = due.getTime() - now;
  const abs = Math.abs(ms);
  const text = abs < HOUR ? `${Math.max(1, Math.round(abs / 60_000))} min` : abs < 48 * HOUR ? `${Math.round(abs / HOUR)} h` : `${Math.round(abs / (24 * HOUR))} days`;
  return { text: ms < 0 ? `${text} overdue` : `${text} left`, overdue: ms < 0 };
}

/** The computed due date with a countdown, or the rule's own deadline wording when no date can be computed. */
export function DeadlineBadge({ rule, dueAt, now, done }: { rule: RegulatoryRule; dueAt: Date | null; now: number; done?: boolean }) {
  if (!dueAt) return <Badge className="max-w-full whitespace-normal text-left">{rule.deadline.description}</Badge>;
  const left = timeLeft(dueAt, now);
  const soon = dueAt.getTime() - now < 72 * HOUR;
  return (
    <Badge tone={done ? "slate" : left.overdue ? "red" : soon ? "amber" : "slate"} className="max-w-full gap-1 whitespace-normal text-left">
      <IconClock className="h-3 w-3 shrink-0" />
      <span suppressHydrationWarning>Due {fmtDue(dueAt)}{done ? "" : ` · ${left.text}`}</span>
    </Badge>
  );
}

/**
 * Content-review status of the step's guidance. Shown whether or not the step is ticked:
 * completing an action never clears an unresolved regulatory warning.
 */
export function ContentReviewBadge({ rule }: { rule: RegulatoryRule }) {
  const c = contentReview(rule);
  if (c.state === "NONE") return null;
  return <Badge tone={c.state === "REVIEWED" ? "green" : c.state === "REJECTED" ? "red" : "amber"} className="max-w-full whitespace-normal text-left">{c.label}{c.state === "REVIEWED" ? ` · ${c.reviewedAt}` : ""}</Badge>;
}

/** The two separate questions: has the guidance been reviewed, and does it apply to this customer. */
export function ReviewAndApplicability({ rule, classification }: { rule: RegulatoryRule; classification: Classification }) {
  const c = contentReview(rule);
  const a = applicabilityStatus(rule, classification);
  return (
    <div className="space-y-2">
      {c.state !== "NONE" && (
        <Alert tone={c.state === "REVIEWED" ? "green" : c.state === "REJECTED" ? "red" : "amber"} title={c.label}>
          {c.detail}
        </Alert>
      )}
      {(!a.resolved || c.state !== "NONE") && (
        <p className={cn("rounded-lg px-3 py-2 text-sm ring-1 ring-inset", a.resolved ? "bg-slate-50 text-slate-700 ring-slate-200" : "bg-highlight-50/70 text-slate-800 ring-highlight-100")}>
          <span className="font-semibold">{a.label}.</span> {a.detail}
        </p>
      )}
    </div>
  );
}

// ───────────────────────── Progress ─────────────────────────

export function ProgressHeader({ progress, note }: { progress: ChecklistProgress; note?: React.ReactNode }) {
  return (
    <div>
      <p className="text-base font-semibold text-navy-800" aria-live="polite">
        {progress.allDone ? L.allDone : L.progress(progress.done, progress.total, progress.pct)}
      </p>
      <div className="mt-2"><Progress value={progress.pct} /></div>
      {progress.allDone && <p className="mt-2 text-xs text-slate-500">{L.allDoneNote}</p>}
      {note && <div className="mt-2 text-xs text-slate-500">{note}</div>}
    </div>
  );
}

// ───────────────────────── Next action ─────────────────────────

export interface NextItem {
  id: string;
  title: string;
  tier: PriorityTier;
  rule: RegulatoryRule;
  dueAt: Date | null;
}

export function NextActionPanel({ next, now, emergency }: { next: NextActions<NextItem>; now: number; emergency: boolean }) {
  if (next.allDone) return null;
  const link = (i: NextItem) => (
    <li key={i.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <a href={`#step-${i.id}`} className="font-semibold text-navy-800 underline decoration-navy-200 underline-offset-2 hover:decoration-navy-800">{i.title}</a>
      {i.tier <= 3 && <TierBadge tier={i.tier} />}
      {i.dueAt && <DeadlineBadge rule={i.rule} dueAt={i.dueAt} now={now} />}
    </li>
  );
  return (
    <section
      aria-label={L.nextAction}
      className={cn("rounded-xl p-4 ring-1 ring-inset", emergency ? "bg-red-50/70 ring-red-200" : "bg-highlight-50/60 ring-highlight-100")}
    >
      <h2 className={cn("flex items-center gap-2 text-xs font-bold uppercase tracking-wider", emergency ? "text-red-800" : "text-highlight-700")}>
        <IconZap className="h-4 w-4" /> {L.nextAction}
        {next.primary.length > 1 && <span className="font-semibold normal-case tracking-normal">— {L.nextTogether.toLowerCase()}</span>}
      </h2>
      {next.primary.length > 0 ? (
        <ul className="mt-2 space-y-2 text-base">{next.primary.map(link)}</ul>
      ) : (
        <p className="mt-2 text-sm text-slate-700">Every remaining action is blocked. Resolve what is blocking them below.</p>
      )}
      {next.alsoUrgent.length > 0 && (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-600">{L.alsoUrgent}</h3>
          <ul className="mt-1.5 space-y-1.5 text-sm">{next.alsoUrgent.map(link)}</ul>
        </>
      )}
      {next.blocked.length > 0 && (
        <>
          <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-600">{L.blocked}</h3>
          <ul className="mt-1.5 space-y-1.5 text-sm text-slate-700">
            {next.blocked.map((b) => (
              <li key={b.item.id}>
                <a href={`#step-${b.item.id}`} className="font-medium text-navy-800 hover:underline">{b.item.title}</a> — {b.reason}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

// ───────────────────────── Sections ─────────────────────────

const TIER_TONE: Record<PriorityTier, { badge: "red" | "amber" | "blue" | "slate"; stripe: string; chip: string }> = {
  1: { badge: "red", stripe: "border-l-red-500", chip: "bg-red-600 text-white" },
  2: { badge: "red", stripe: "border-l-red-400", chip: "bg-red-600 text-white" },
  3: { badge: "amber", stripe: "border-l-highlight-400", chip: "bg-highlight-400 text-navy-900" },
  4: { badge: "blue", stripe: "border-l-brand-400", chip: "bg-navy-800 text-white" },
  5: { badge: "slate", stripe: "border-l-slate-300", chip: "bg-slate-500 text-white" },
};

export function TierBadge({ tier }: { tier: PriorityTier }) {
  return (
    <Badge tone={TIER_TONE[tier].badge} className="gap-1">
      {tier === 2 && <IconBan className="h-3 w-3" />}
      {L.tier[tier].short}
    </Badge>
  );
}

/** Heading for an emergency priority group. */
export function TierHeading({ tier, count }: { tier: PriorityTier; count: number }) {
  return (
    <div className="mb-3 flex items-start gap-3">
      <span className={cn("inline-flex h-8 min-w-8 shrink-0 items-center justify-center rounded-lg px-2 text-xs font-bold shadow-sm", TIER_TONE[tier].chip)}>{tier}</span>
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-800">
          {L.tier[tier].name} <span className="font-normal normal-case tracking-normal text-slate-500">· {count}</span>
        </h2>
        <p className="text-sm text-slate-600">{L.tier[tier].blurb}</p>
      </div>
    </div>
  );
}

/** Heading for a workflow stage (routine checklists). */
export function StageHeading({ n, title }: { n: number; title: string }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-navy-800 text-xs font-bold text-white shadow-sm">{n}</span>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-navy-800">{title}</h2>
    </div>
  );
}

// ───────────────────────── One action ─────────────────────────

export function ActionRow({
  id,
  title,
  summary,
  tier,
  checked,
  onToggle,
  busy,
  disabledReason,
  informational,
  badges,
  alwaysVisible,
  lazy,
  error,
  children,
}: {
  id: string;
  title: string;
  /** One line under the title. */
  summary: string;
  tier: PriorityTier;
  checked: boolean;
  onToggle?: () => void;
  busy?: boolean;
  /** When set, the checkbox is shown but cannot be changed; the text says why. */
  disabledReason?: string;
  /** Not something to do (for example a not-applicable rule): no checkbox is shown. */
  informational?: boolean;
  badges?: React.ReactNode;
  /** Content kept open above the collapsed details — used for immediate-safety instructions. */
  alwaysVisible?: React.ReactNode;
  /** Render the details only once opened (saved checklists, where each step carries forms). */
  lazy?: boolean;
  error?: string | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const disabled = !!disabledReason || busy || !onToggle;
  return (
    <li id={`step-${id}`} className="scroll-mt-24">
      <div className={cn("overflow-hidden rounded-xl border border-l-4 border-slate-200 bg-white shadow-card", TIER_TONE[tier].stripe, checked && "bg-slate-50/80")}>
        <div className="flex items-start gap-3 p-4">
          {!informational && (
            <button
              type="button"
              role="checkbox"
              aria-checked={checked}
              aria-label={`${checked ? "Completed" : "Mark as completed"}: ${title}`}
              title={disabledReason ?? (checked ? "Uncheck" : "Mark as completed")}
              disabled={disabled}
              onClick={onToggle}
              className={cn(
                "no-print flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2",
                checked ? "border-accent-500 bg-accent-500 text-white" : "border-slate-300 bg-white text-transparent hover:border-accent-500 hover:text-accent-500",
                disabled && "cursor-not-allowed opacity-60",
                busy && "animate-pulse",
              )}
            >
              <IconCheck className="h-6 w-6" />
            </button>
          )}
          <div className="min-w-0 flex-1">
            <p className={cn("text-base font-semibold leading-snug", checked ? "text-slate-500 line-through decoration-slate-300" : informational ? "text-slate-500" : "text-navy-800")}>{title}</p>
            <p className="mt-1 text-sm text-slate-600">{summary}</p>
            {badges && <div className="mt-2 flex flex-wrap gap-1.5">{badges}</div>}
            {error && <p className="mt-2 text-sm text-red-700" role="alert">{error}</p>}
          </div>
        </div>
        {alwaysVisible && <div className="border-t border-slate-100 px-4 py-3 text-sm sm:pl-[4.25rem]">{alwaysVisible}</div>}
        <details data-step className="group border-t border-slate-100" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium text-brand-700 hover:bg-slate-50">
            {L.details}
            <IconChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition group-open:rotate-180" />
          </summary>
          {(!lazy || open) && <div className="border-t border-slate-100 bg-gradient-to-b from-slate-50/60 to-white px-4 py-5 text-sm">{children}</div>}
        </details>
      </div>
    </li>
  );
}

/** The numbered required-action list from the rule. */
export function RequiredActions({ rule }: { rule: RegulatoryRule }) {
  return (
    <ol className="space-y-2">
      {rule.requiredAction.map((x, k) => (
        <li key={x} className="flex gap-2.5">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-brand-50 text-[11px] font-semibold text-brand-700">{k + 1}</span>
          <span>{x}</span>
        </li>
      ))}
    </ol>
  );
}

export function SourceLinks({ rule }: { rule: RegulatoryRule }) {
  return (
    <ul className="space-y-1">
      {rule.sources.map((s) => (
        <li key={s.citation}>
          {s.url.startsWith("http") ? (
            <a className="inline-flex items-center gap-1 font-medium text-brand-700 underline decoration-brand-200 underline-offset-2 hover:decoration-brand-700" href={s.url} target="_blank" rel="noreferrer noopener">
              <IconBook className="h-3.5 w-3.5 shrink-0" />{s.citation}
            </a>
          ) : s.citation}
        </li>
      ))}
    </ul>
  );
}

const JURISDICTION_LABEL: Record<RegulatoryRule["jurisdiction"], string> = { FEDERAL: "Federal", STATE: "State", COMPANY: "Company" };

/** Everything the rule says, for the expanded view. Nothing from the catalog is left out. */
export function RuleDetails({
  rule: r,
  classification,
  reasons,
  dueAt,
  basis,
  hideActions,
}: {
  rule: RegulatoryRule;
  classification: Classification;
  reasons: string[];
  dueAt: Date | null;
  /** Why the step sits where it does in the list. */
  basis?: string;
  /** The required actions are already shown above the fold. */
  hideActions?: boolean;
}) {
  const why = reasons.filter((x) => !x.startsWith("Requires Regulatory Verification"));
  return (
    <div className="space-y-5">
      {r.warning && <Alert tone="red" title="Warning">{r.warning}</Alert>}
      <ReviewAndApplicability rule={r} classification={classification} />
      {classification === "UNABLE_TO_DETERMINE" && <Alert tone="amber" title="Unable to determine">{why.join(" ")}</Alert>}

      <div className="flex flex-wrap gap-1.5">
        <ClassificationBadge value={classification} />
        <Badge>{JURISDICTION_LABEL[r.jurisdiction]}{r.jurisdiction !== "COMPANY" ? ` · ${r.authority}` : ""}</Badge>
      </div>

      {!hideActions && <Field title="Required action" dot="bg-brand-500"><RequiredActions rule={r} /></Field>}
      <Field title="Reason" dot="bg-navy-300">
        <p>{r.purpose}</p>
        {classification !== "UNABLE_TO_DETERMINE" && why.length > 0 && <p className="mt-1 text-slate-600">{why.join(" ")}</p>}
        {basis && <p className="mt-1 text-xs text-slate-500">Position in this checklist: {basis}</p>}
      </Field>

      <div className="grid gap-5 md:grid-cols-2">
        <Field title="Regulation" dot="bg-brand-500">
          <SourceLinks rule={r} />
          <p className="mt-1.5 text-xs text-slate-500">
            {r.kind === "LEGAL" ? "Legal requirement" : r.kind === "BEST_PRACTICE" ? "Recommended practice — not required by the cited rule" : "Company policy"} ·{" "}
            {r.commerceScope === "INTERSTATE_ONLY" ? "Interstate (intrastate per state adoption)" : r.commerceScope === "ALL_COMMERCE" ? "Interstate and intrastate" : "Applies regardless of commerce type"} ·
            last checked against the official text {r.lastVerified ?? "— not verified"}
          </p>
        </Field>
        <Field title="Deadline" dot="bg-highlight-400">
          <p>{r.deadline.description}</p>
          {dueAt && (
            <p className="mt-1 font-semibold text-navy-800" suppressHydrationWarning>
              Due {fmtDue(dueAt)}
              <span className="font-normal text-slate-500">{r.deadline.offsetBusinessDays ? " (weekends skipped; federal holidays not counted — the legal deadline may be later)" : ""}</span>
            </p>
          )}
        </Field>
        <Field title="Required documentation" dot="bg-violet-400">
          <ul className="space-y-1">
            {r.documentation.map((x) => (
              <li key={x} className="flex gap-2"><span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-slate-400" />{x}</li>
            ))}
          </ul>
          {r.retention.length > 0 && (
            <p className="mt-2 text-slate-600">
              <span className="font-medium text-slate-700">Keep: </span>
              {r.retention.map((x) => `${x.record} — ${x.period}${x.citation ? ` (${x.citation})` : ""}`).join("; ")}
            </p>
          )}
        </Field>
        <Field title="Exceptions" dot="bg-slate-400">{r.exceptions}</Field>
      </div>
      <Field title="Applicability" dot="bg-slate-400">{r.applicability}</Field>
      <Field title="Verification" dot="bg-accent-500">
        <p className="rounded-lg bg-accent-50/70 px-3 py-2 text-slate-700 ring-1 ring-inset ring-accent-100">{r.verification}</p>
      </Field>
    </div>
  );
}

export function Field({ title, dot, children }: { title: string; dot: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-navy-700">
        <span className={cn("h-1.5 w-1.5 rounded-full", dot)} />
        {title}
      </h3>
      <div className="text-slate-700">{children}</div>
    </section>
  );
}
