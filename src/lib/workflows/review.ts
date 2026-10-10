import type { Classification } from "../rules/types";
import { MUST_RESOLVE } from "../rules/engine";
import { can, type Role } from "../auth/rbac";
import type { ItemStatus } from "./status";

export interface ReviewItem {
  id: string;
  title: string;
  classification: Classification;
  status: ItemStatus;
  blocksSafetySensitive: boolean;
  dueAt: Date | null;
  verificationStatus: "VERIFIED" | "REQUIRES_VERIFICATION";
  overrideFlag?: boolean; // required item marked N/A by a user
  evidenceCount: number;
}

export interface RunSummary {
  total: number;
  byStatus: Record<ItemStatus, number>;
  mustResolve: number;
  resolved: number;
  progressPct: number;
  outstanding: ReviewItem[];
  pendingVerification: ReviewItem[];
  blockersOutstanding: ReviewItem[];
  overdue: ReviewItem[];
  undetermined: ReviewItem[];
  unverifiedSources: ReviewItem[];
  overrides: ReviewItem[];
  completedWithoutDocuments: ReviewItem[];
  /** Every blocking item verified complete — safety-sensitive work is not prohibited by THIS checklist. */
  safetySensitiveCleared: boolean;
  /** Every must-resolve item is Completed or Not Applicable — ready for human approval. */
  readyForReview: boolean;
  issues: string[];
}

const isResolved = (s: ItemStatus) => s === "COMPLETED" || s === "NOT_APPLICABLE";

export function summarizeRun(items: ReviewItem[], now = new Date()): RunSummary {
  const byStatus = {
    NOT_STARTED: 0, IN_PROGRESS: 0, PENDING_VERIFICATION: 0, COMPLETED: 0, NOT_APPLICABLE: 0, BLOCKED: 0,
  } as Record<ItemStatus, number>;
  for (const i of items) byStatus[i.status]++;

  const must = items.filter((i) => MUST_RESOLVE.includes(i.classification));
  const outstanding = must.filter((i) => !isResolved(i.status));
  const blockersOutstanding = items.filter((i) => i.blocksSafetySensitive && i.status !== "COMPLETED" && !(i.status === "NOT_APPLICABLE"));
  const overdue = items.filter((i) => i.dueAt && i.dueAt < now && !isResolved(i.status));
  const undetermined = items.filter((i) => i.classification === "UNABLE_TO_DETERMINE" && !isResolved(i.status));
  const unverifiedSources = items.filter((i) => i.verificationStatus === "REQUIRES_VERIFICATION" && i.status !== "NOT_APPLICABLE");
  const overrides = items.filter((i) => i.overrideFlag);
  const completedWithoutDocuments = items.filter((i) => i.status === "COMPLETED" && i.evidenceCount === 0);
  const resolved = must.length - outstanding.length;

  const issues: string[] = [];
  if (blockersOutstanding.length)
    issues.push(`${blockersOutstanding.length} item(s) must be verified complete before the driver may perform safety-sensitive functions.`);
  if (overdue.length) issues.push(`${overdue.length} item(s) are past their deadline.`);
  if (undetermined.length) issues.push(`${undetermined.length} item(s) could not be determined and need a human decision.`);
  if (overrides.length) issues.push(`${overrides.length} required item(s) were marked Not Applicable by user override.`);
  if (completedWithoutDocuments.length)
    issues.push(`${completedWithoutDocuments.length} completed item(s) have no attached document (completion note only).`);
  if (unverifiedSources.length)
    issues.push(`${unverifiedSources.length} item(s) rely on rule text marked "Requires Regulatory Verification".`);

  return {
    total: items.length,
    byStatus,
    mustResolve: must.length,
    resolved,
    progressPct: must.length ? Math.round((resolved / must.length) * 100) : 100,
    outstanding,
    pendingVerification: items.filter((i) => i.status === "PENDING_VERIFICATION"),
    blockersOutstanding,
    overdue,
    undetermined,
    unverifiedSources,
    overrides,
    completedWithoutDocuments,
    safetySensitiveCleared: blockersOutstanding.length === 0,
    readyForReview: outstanding.length === 0,
    issues,
  };
}

export class ApprovalError extends Error {}

export function assertCanApprove(summary: RunSummary, role: Role, note: string | undefined): void {
  if (!can(role, "run:approve")) throw new ApprovalError("Only an Owner, Admin or Safety Manager can approve a workflow.");
  if (!summary.readyForReview)
    throw new ApprovalError(`${summary.outstanding.length} required item(s) are not yet completed or resolved.`);
  if (!note?.trim()) throw new ApprovalError("Add a review note describing what you checked.");
}

export const APPROVAL_DISCLAIMER =
  "Approval records that an authorized person reviewed the evidence listed in this report. It is not a legal certification that the driver is qualified or that the company is in compliance.";

/**
 * Dashboard readiness score. Deliberately simple and explainable:
 *   resolved required items ÷ required items, across open workflows,
 *   minus 5 points per overdue item and 10 per outstanding safety-sensitive blocker (floor 0).
 */
export function readinessScore(items: ReviewItem[], now = new Date()) {
  const s = summarizeRun(items, now);
  const base = s.mustResolve ? (s.resolved / s.mustResolve) * 100 : 100;
  const penalty = s.overdue.length * 5 + s.blockersOutstanding.length * 10;
  const score = Math.max(0, Math.round(base - penalty));
  return {
    score,
    explanation: [
      `${s.resolved} of ${s.mustResolve} required items resolved (${Math.round(base)} pts)`,
      `−${s.overdue.length * 5} for ${s.overdue.length} overdue item(s)`,
      `−${s.blockersOutstanding.length * 10} for ${s.blockersOutstanding.length} outstanding safety-sensitive blocker(s)`,
    ],
    disclaimer: "This score measures progress on tracked workflow items only. It is not a measure or guarantee of legal compliance.",
  };
}
