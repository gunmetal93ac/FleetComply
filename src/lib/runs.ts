import "server-only";
import { prisma } from "./db";
import { TenantRepository, type TenantDb } from "./tenant/repository";
import { generateChecklist } from "./workflows/checklist";
import { WORKFLOWS, type Answers } from "./workflows/definitions";
import { checkboxRequests, transition, type ItemStatus, type TransitionRequest } from "./workflows/status";
import { assertCanApprove, summarizeRun, type ReviewItem } from "./workflows/review";
import { assertCan } from "./auth/rbac";
import type { CurrentUser } from "./auth/session";
import type { Classification, RegulatoryRule, WorkflowKey } from "./rules/types";
import { SCENARIOS, resolveScenario } from "./workflows/scenarios";
import { reviseRun, type RevisionPlan } from "./workflows/revise";
import { loadPublishedOverrides } from "./regulatory/verification-store";

/** `none` is accepted only for workflows whose definition marks the driver as optional. */
export type DriverRef = { driverId: string } | { firstName: string; lastName: string } | { none: true };

/** Generate the checklist and persist run + items + audit entry in one transaction. */
export async function createRun(user: CurrentUser, key: WorkflowKey, answers: Answers, driver: DriverRef, scenarioN?: number) {
  assertCan(user.role, "run:create");
  const def = WORKFLOWS[key];
  if ("none" in driver && def.driver !== "optional") throw new Error("This workflow needs a driver.");
  // The scenario the questionnaire was opened from (if any) names the checklist and is kept in the audit record.
  const requested = SCENARIOS.find((s) => s.n === scenarioN && s.workflow === key);
  const scenario = requested ? resolveScenario(requested) : undefined;
  // New checklists are built from the published version of each step, including reviewed corrections.
  const overrides = await loadPublishedOverrides(prisma);
  const checklist = generateChecklist(
    def,
    answers,
    { baseState: user.org.baseState, preEmploymentAlcoholTesting: user.org.preEmploymentAlcoholTesting },
    {},
    overrides,
  );

  return prisma.$transaction(async (tx) => {
    const r = new TenantRepository(user.orgId, tx as unknown as TenantDb);
    let driverId: string | null;
    let driverName: string | null;
    if ("none" in driver) {
      driverId = null;
      driverName = null;
    } else if ("driverId" in driver) {
      const d = await r.find("driver", driver.driverId); // throws if not in this org
      driverId = d.id;
      driverName = `${d.firstName} ${d.lastName}`;
    } else {
      const d = await r.create("driver", {
        firstName: driver.firstName,
        lastName: driver.lastName,
        status: "APPLICANT",
        cdlState: typeof answers.licenseState === "string" ? answers.licenseState : null,
        cdlClass: typeof answers.cdlClass === "string" ? answers.cdlClass : null,
      });
      driverId = d.id;
      driverName = `${d.firstName} ${d.lastName}`;
    }

    const run = await r.create("workflowRun", {
      workflowKey: key,
      title: `${scenario?.title ?? def.title}${driverName ? ` — ${driverName}` : ""}`,
      driverId,
      answers: answers as object,
      facts: checklist.facts as object,
      warnings: checklist.warnings,
      catalogVersion: checklist.catalogVersion,
      createdById: user.id,
    });

    for (const it of checklist.items) {
      await r.create("checklistItem", {
        runId: run.id,
        ruleId: it.ruleId,
        ruleVersion: it.ruleVersion,
        ruleSnapshot: it.ruleSnapshot as unknown as object,
        stage: it.stage,
        title: it.title,
        classification: it.classification,
        reasons: it.reasons,
        blocksSafetySensitive: it.blocksSafetySensitive,
        status: it.status,
        sortOrder: it.sortOrder,
        dueAt: it.dueAt,
      });
    }
    await r.create("auditLog", {
      actorId: user.id,
      action: "run.create",
      entityType: "WorkflowRun",
      entityId: run.id,
      meta: { workflowKey: key, scenario: scenario?.n ?? null, catalogVersion: checklist.catalogVersion, items: checklist.items.length },
    });
    return run.id as string;
  });
}

export interface ItemRow {
  id: string;
  ruleId: string;
  ruleVersion: number;
  ruleSnapshot: RegulatoryRule;
  stage: string;
  title: string;
  classification: Classification;
  reasons: string[];
  blocksSafetySensitive: boolean;
  status: ItemStatus;
  dueAt: Date | null;
  assigneeId: string | null;
  notes: string | null;
  completionDate: string | null;
  completedById: string | null;
  verifiedById: string | null;
  verifiedAt: Date | null;
  naReason: string | null;
  blockedReason: string | null;
  overrideFlag: boolean;
  documents: Array<{ id: string; filename: string; size: number; createdAt: Date; version: number; recordCategory: string }>;
  events: Array<{ id: string; kind: string; fromStatus: string | null; toStatus: string | null; note: string | null; actorId: string; at: Date }>;
}

export function toReviewItem(i: ItemRow): ReviewItem {
  return {
    id: i.id,
    title: i.title,
    classification: i.classification,
    status: i.status,
    blocksSafetySensitive: i.blocksSafetySensitive,
    dueAt: i.dueAt,
    verificationStatus: i.ruleSnapshot.verificationStatus,
    overrideFlag: i.overrideFlag,
    evidenceCount: i.documents.length,
  };
}

export async function loadRun(r: TenantRepository, runId: string) {
  const run = await r.find("workflowRun", runId, { driver: true });
  const items = (await r.list<ItemRow>("checklistItem", { runId }, {
    orderBy: { sortOrder: "asc" },
    include: {
      documents: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      events: { orderBy: { at: "desc" } },
    },
  })) as ItemRow[];
  const summary = summarizeRun(items.map(toReviewItem));
  return { run, items, summary };
}

export type ItemAction =
  | { kind: "status"; req: TransitionRequest }
  /** The checklist checkbox: a shortcut through the same status steps (see checkboxRequests). */
  | { kind: "check"; checked: boolean }
  | { kind: "assign"; assigneeId: string | null }
  | { kind: "deadline"; dueAt: string | null }
  | { kind: "notes"; notes: string };

export async function applyItemAction(user: CurrentUser, itemId: string, action: ItemAction) {
  assertCan(user.role, "item:update");
  return prisma.$transaction(async (tx) => {
    const r = new TenantRepository(user.orgId, tx as unknown as TenantDb);
    const item = await r.find("checklistItem", itemId);
    const run = await r.find("workflowRun", item.runId);
    if (run.status !== "ACTIVE") throw new Error("This workflow has been approved or closed; reopen it to make changes.");

    if (action.kind === "status" || action.kind === "check") {
      const evidenceCount = (await r.list("document", { itemId, deletedAt: null })).length;
      const orgUsers = await tx.user.count({ where: { orgId: user.orgId, disabled: false } });
      const requests = action.kind === "status" ? [action.req] : checkboxRequests(item.status, action.checked, new Date().toISOString().slice(0, 10));
      // Each request goes through the one set of status rules and is written to the history.
      const state = { status: item.status as ItemStatus, completedById: item.completedById as string | null, completionDate: item.completionDate as string | null };
      for (const req of requests) {
        const res = transition(
          { ...state, classification: item.classification, evidenceCount, notes: item.notes },
          req,
          { id: user.id, role: user.role },
          { soleOwnerOrg: orgUsers === 1 && user.role === "OWNER" },
        );
        await r.update("checklistItem", itemId, { ...res.patch, ...(res.flags.length ? { overrideFlag: true } : {}) });
        await r.create("itemEvent", { itemId, actorId: user.id, kind: "STATUS", fromStatus: res.event.fromStatus, toStatus: res.event.toStatus, note: res.event.note });
        Object.assign(state, res.patch);
      }
      return;
    }
    if (action.kind === "assign") {
      if (action.assigneeId) {
        const u = await tx.user.findFirst({ where: { id: action.assigneeId, orgId: user.orgId } });
        if (!u) throw new Error("Assignee not found in your organization.");
      }
      await r.update("checklistItem", itemId, { assigneeId: action.assigneeId });
      await r.create("itemEvent", { itemId, actorId: user.id, kind: "ASSIGN", data: { assigneeId: action.assigneeId } });
      return;
    }
    if (action.kind === "deadline") {
      const due = action.dueAt ? new Date(action.dueAt) : null;
      if (due && Number.isNaN(due.getTime())) throw new Error("Invalid date.");
      await r.update("checklistItem", itemId, { dueAt: due });
      await r.create("itemEvent", { itemId, actorId: user.id, kind: "DEADLINE", note: `Deadline set to ${due ? due.toISOString().slice(0, 10) : "none"}`, data: { previous: item.dueAt } });
      return;
    }
    await r.update("checklistItem", itemId, { notes: action.notes.slice(0, 5000) });
    await r.create("itemEvent", { itemId, actorId: user.id, kind: "NOTE", note: action.notes.slice(0, 500) });
  });
}

export async function approveRun(user: CurrentUser, r: TenantRepository, runId: string, note: string) {
  const { run, summary } = await loadRun(r, runId);
  if (run.status !== "ACTIVE") throw new Error("Already approved or closed.");
  assertCanApprove(summary, user.role, note);
  await r.update("workflowRun", runId, { status: "APPROVED", approvedById: user.id, approvedAt: new Date(), approvalNote: note.trim() });
  await r.create("auditLog", { actorId: user.id, action: "run.approve", entityType: "WorkflowRun", entityId: runId, meta: { issues: summary.issues } });
}

export async function reopenRun(user: CurrentUser, r: TenantRepository, runId: string, reason: string) {
  assertCan(user.role, "run:approve");
  if (!reason.trim()) throw new Error("Give a reason for reopening.");
  await r.update("workflowRun", runId, { status: "ACTIVE", approvedById: null, approvedAt: null });
  await r.create("auditLog", { actorId: user.id, action: "run.reopen", entityType: "WorkflowRun", entityId: runId, meta: { reason } });
}

/**
 * Preview (`dryRun`) or save a change to the answers behind a saved checklist. The run is loaded
 * through the caller's tenant repository, so a run belonging to another organization is "not found".
 */
export async function reviseRunAnswers(user: CurrentUser, runId: string, answers: Answers, opts: { dryRun?: boolean } = {}): Promise<RevisionPlan> {
  const org = { baseState: user.org.baseState, preEmploymentAlcoholTesting: user.org.preEmploymentAlcoholTesting };
  const actor = { id: user.id, role: user.role };
  if (opts.dryRun) return reviseRun(new TenantRepository(user.orgId, prisma as unknown as TenantDb), actor, runId, answers, org, { dryRun: true });
  return prisma.$transaction((tx) => reviseRun(new TenantRepository(user.orgId, tx as unknown as TenantDb), actor, runId, answers, org));
}
