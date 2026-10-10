"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireTenant, requireUser } from "@/lib/auth/session";
import { applyItemAction, approveRun, createRun, reopenRun, reviseRunAnswers, type DriverRef, type ItemAction } from "@/lib/runs";
import { RevisionError, type RevisionPlan } from "@/lib/workflows/revise";
import { ValidationError } from "@/lib/workflows/checklist";
import { WORKFLOWS, type Answers } from "@/lib/workflows/definitions";
import { TransitionError, type ItemStatus } from "@/lib/workflows/status";
import { ApprovalError } from "@/lib/workflows/review";
import { NotFoundError } from "@/lib/tenant/repository";
import { ForbiddenError } from "@/lib/auth/rbac";
import type { WorkflowKey } from "@/lib/rules/types";

export type ActionResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function toError(e: unknown): ActionResult {
  if (e instanceof ValidationError) return { ok: false, error: "Please fix the highlighted answers.", fieldErrors: e.fieldErrors };
  if (e instanceof TransitionError || e instanceof ApprovalError || e instanceof RevisionError) return { ok: false, error: e.message };
  if (e instanceof NotFoundError) return { ok: false, error: "Not found." };
  if (e instanceof ForbiddenError) return { ok: false, error: "You don't have permission to do that." };
  if (e instanceof Error && /^(This workflow|Assignee|Invalid date|Already|Give a reason)/.test(e.message)) return { ok: false, error: e.message };
  console.error(e);
  return { ok: false, error: "Something went wrong. The change was not saved." };
}

export async function createRunAction(key: WorkflowKey, answers: Answers, driver: DriverRef, scenarioN?: number): Promise<ActionResult> {
  const user = await requireUser("run:create");
  if (!(key in WORKFLOWS)) return { ok: false, error: "Unknown workflow." };
  if ("none" in driver) {
    if (WORKFLOWS[key].driver !== "optional") return { ok: false, error: "Choose a driver.", fieldErrors: { driverId: "Required" } };
  } else if ("firstName" in driver) {
    const fe: Record<string, string> = {};
    if (!driver.firstName?.trim()) fe.firstName = "Required";
    if (!driver.lastName?.trim()) fe.lastName = "Required";
    if (Object.keys(fe).length) return { ok: false, error: "Enter the driver's name.", fieldErrors: fe };
  } else if (!driver.driverId) {
    return { ok: false, error: "Choose a driver.", fieldErrors: { driverId: "Required" } };
  }
  let runId: string;
  try {
    runId = await createRun(user, key, answers, driver, typeof scenarioN === "number" ? scenarioN : undefined);
  } catch (e) {
    return toError(e);
  }
  redirect(`/runs/${runId}`);
}

export async function itemAction(runId: string, itemId: string, action: ItemAction): Promise<ActionResult> {
  const user = await requireUser("item:update");
  try {
    await applyItemAction(user, itemId, action);
  } catch (e) {
    return toError(e);
  }
  revalidatePath(`/runs/${runId}`);
  return { ok: true };
}

export async function statusAction(runId: string, itemId: string, to: ItemStatus, reason?: string, completionDate?: string) {
  return itemAction(runId, itemId, { kind: "status", req: { to, reason, completionDate } });
}

/** The checklist checkbox on a saved checklist. */
export async function checkAction(runId: string, itemId: string, checked: boolean) {
  return itemAction(runId, itemId, { kind: "check", checked });
}

export async function approveAction(runId: string, note: string): Promise<ActionResult> {
  const { user, r } = await requireTenant("run:approve");
  try {
    await approveRun(user, r, runId, note);
  } catch (e) {
    return toError(e);
  }
  revalidatePath(`/runs/${runId}`);
  return { ok: true };
}

export async function reopenAction(runId: string, reason: string): Promise<ActionResult> {
  const { user, r } = await requireTenant("run:approve");
  try {
    await reopenRun(user, r, runId, reason);
  } catch (e) {
    return toError(e);
  }
  revalidatePath(`/runs/${runId}`);
  return { ok: true };
}

/** What changing the answers would do to a saved checklist — serializable for the browser. */
export interface AnswerChangePreview {
  answerChanges: number;
  nowApplies: string[];
  noLongerApplies: string[];
  reclassified: string[];
  deadlinesChanged: string[];
  added: string[];
  /** Steps with work already recorded that the change affects. The work is kept. */
  affectsRecordedWork: Array<{ title: string; status: ItemStatus; effect: string }>;
}

function toPreview(plan: RevisionPlan): AnswerChangePreview {
  const titles = (effect: string) => plan.revisions.filter((x) => x.effect === effect).map((x) => x.title);
  return {
    answerChanges: plan.answerChanges.length,
    nowApplies: titles("NOW_APPLIES"),
    noLongerApplies: titles("NO_LONGER_APPLIES"),
    reclassified: titles("RECLASSIFIED"),
    deadlinesChanged: titles("DEADLINE_CHANGED"),
    added: plan.additions.filter((x) => x.classification !== "NOT_APPLICABLE").map((x) => x.title),
    affectsRecordedWork: plan.affectsRecordedWork.map((x) => ({ title: x.title, status: x.from.status, effect: x.effect })),
  };
}

export type AnswerChangeResult = { ok: true; preview: AnswerChangePreview } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/**
 * Preview (`apply: false`) or save (`apply: true`) edited answers for a saved checklist.
 * Answers are validated server-side by the workflow's own validator before anything is evaluated.
 */
export async function reviseAnswersAction(runId: string, answers: Answers, apply: boolean): Promise<AnswerChangeResult> {
  const user = await requireUser("run:create");
  try {
    const plan = await reviseRunAnswers(user, runId, answers, { dryRun: !apply });
    if (apply) revalidatePath(`/runs/${runId}`);
    return { ok: true, preview: toPreview(plan) };
  } catch (e) {
    const err = toError(e);
    return err.ok ? { ok: false, error: "Something went wrong. The change was not saved." } : err;
  }
}
