import { computeDueAt, evaluateAll } from "../rules/engine";
import { CATALOG_VERSION, rulesFor } from "../rules/catalog";
import type { Classification, Facts, RegulatoryRule } from "../rules/types";
import { assertCan, type Role } from "../auth/rbac";
import type { TenantRepository } from "../tenant/repository";
import { ValidationError } from "./checklist";
import { labelsFor, visibleQuestions, WORKFLOWS, type Answers, type OrgSettings, type WorkflowDefinition } from "./definitions";
import type { ItemStatus } from "./status";

/**
 * Changing the answers on a saved checklist.
 *
 * The same rules engine that built the checklist re-evaluates it — there is no second set of
 * decision logic. Each existing step is re-evaluated against the rule text it was created with
 * (its stored snapshot), so a later catalog change never rewrites a step that is already on the
 * checklist. Rules added to the catalog since are appended as new steps and labelled as such.
 *
 * Nothing is deleted: a step with work recorded on it keeps its status, notes, documents and
 * history even when the new answers say it no longer applies — it is flagged for review instead.
 */

export interface ExistingItem {
  id: string;
  ruleId: string;
  ruleSnapshot: RegulatoryRule;
  title: string;
  stage: string;
  classification: Classification;
  blocksSafetySensitive: boolean;
  status: ItemStatus;
  dueAt: Date | null;
  naReason: string | null;
  sortOrder: number;
}

export type RevisionEffect = "NOW_APPLIES" | "NO_LONGER_APPLIES" | "RECLASSIFIED" | "DEADLINE_CHANGED";

export interface ItemRevision {
  id: string;
  ruleId: string;
  title: string;
  effect: RevisionEffect;
  from: { classification: Classification; status: ItemStatus; dueAt: Date | null };
  to: { classification: Classification; status: ItemStatus; dueAt: Date | null };
  /** Work had been recorded on this step (in progress, submitted, completed or blocked). It is kept. */
  hadProgress: boolean;
  /** Plain-language description, stored in the step's history. */
  note: string;
  patch: { classification: Classification; reasons: string[]; blocksSafetySensitive: boolean; status: ItemStatus; dueAt: Date | null };
}

export interface ItemAddition {
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
  sortOrder: number;
}

export interface AnswerChange {
  questionId: string;
  label: string;
  from: string | boolean | null;
  to: string | boolean | null;
}

export interface RevisionPlan {
  answers: Answers;
  facts: Facts;
  warnings: string[];
  answerChanges: AnswerChange[];
  revisions: ItemRevision[];
  /** Steps for rules that were not in the catalog when the checklist was created. */
  additions: ItemAddition[];
  /** Revisions touching a step that had work recorded — the user is warned about these before saving. */
  affectsRecordedWork: ItemRevision[];
}

const HAS_PROGRESS: ItemStatus[] = ["IN_PROGRESS", "PENDING_VERIFICATION", "COMPLETED", "BLOCKED"];
const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
const CLASS_LABEL: Record<Classification, string> = {
  LEGALLY_REQUIRED: "legally required",
  CONDITIONALLY_REQUIRED: "required for your situation",
  BEST_PRACTICE: "recommended",
  COMPANY_POLICY: "company policy",
  NOT_APPLICABLE: "not applicable",
  UNABLE_TO_DETERMINE: "unable to determine",
};

/** Answers to currently visible questions only, validated by the workflow's own validator. */
function cleanAnswers(def: WorkflowDefinition, answers: Answers): Answers {
  const clean: Answers = Object.fromEntries(visibleQuestions(def, answers).map((q) => [q.id, answers[q.id]]));
  const errors = def.validate(clean);
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return clean;
}

/**
 * Work out what changing the answers would do. Pure — nothing is saved.
 * Throws ValidationError when the new answers are incomplete or invalid.
 */
export function planRevision(
  def: WorkflowDefinition,
  previousAnswers: Answers,
  previousFacts: Facts,
  nextAnswers: Answers,
  org: OrgSettings,
  existing: ExistingItem[],
  opts: { now?: Date; catalog?: RegulatoryRule[]; catalogVersion?: string } = {},
): RevisionPlan {
  const now = opts.now ?? new Date();
  const answers = cleanAnswers(def, nextAnswers);
  const facts = def.derive(answers, org);
  const labels = labelsFor(def);

  const answerChanges: AnswerChange[] = [];
  for (const id of new Set([...Object.keys(previousAnswers), ...Object.keys(answers)])) {
    const from = previousAnswers[id] ?? null;
    const to = answers[id] ?? null;
    if (from !== to && !((from === null || from === "") && (to === null || to === ""))) answerChanges.push({ questionId: id, label: labels[id] ?? id, from, to });
  }

  // Existing steps: evaluate the rule text each step was created with.
  const evaluations = evaluateAll(existing.map((e) => e.ruleSnapshot), facts, { labels });
  const revisions: ItemRevision[] = [];
  existing.forEach((e, idx) => {
    const ev = evaluations[idx];
    const classification = ev.classification;
    const hadProgress = HAS_PROGRESS.includes(e.status);

    let status = e.status;
    if (classification === "NOT_APPLICABLE" && e.status === "NOT_STARTED") status = "NOT_APPLICABLE";
    // Only undo a "not applicable" the engine set; one a person set with a reason stays theirs.
    if (classification !== "NOT_APPLICABLE" && e.status === "NOT_APPLICABLE" && e.classification === "NOT_APPLICABLE" && !e.naReason) status = "NOT_STARTED";

    // Recalculate the date only when the regulatory date itself moved; an internal deadline someone set is left alone.
    const oldComputed = e.classification === "NOT_APPLICABLE" ? null : computeDueAt(e.ruleSnapshot, previousFacts);
    const dueAt = sameTime(oldComputed, ev.dueAt) ? e.dueAt : ev.dueAt;

    const classChanged = classification !== e.classification;
    if (!classChanged && status === e.status && sameTime(dueAt, e.dueAt)) return;

    let effect: RevisionEffect;
    let note: string;
    if (classChanged && classification === "NOT_APPLICABLE") {
      effect = "NO_LONGER_APPLIES";
      note = hadProgress
        ? "Scenario answers changed: this step no longer applies. The work already recorded on it has been kept — review it."
        : "Scenario answers changed: this step no longer applies.";
    } else if (classChanged && e.classification === "NOT_APPLICABLE") {
      effect = "NOW_APPLIES";
      note = `Scenario answers changed: this step now applies (${CLASS_LABEL[classification]}).`;
    } else if (classChanged) {
      effect = "RECLASSIFIED";
      note = `Scenario answers changed: this step is now ${CLASS_LABEL[classification]} (was ${CLASS_LABEL[e.classification]}).${hadProgress ? " The work already recorded on it has been kept — review it." : ""}`;
    } else {
      effect = "DEADLINE_CHANGED";
      note = `Scenario answers changed: deadline recalculated${dueAt ? ` to ${dueAt.toISOString()}` : " — no date can be calculated from the current answers"}.`;
    }

    revisions.push({
      id: e.id,
      ruleId: e.ruleId,
      title: e.title,
      effect,
      from: { classification: e.classification, status: e.status, dueAt: e.dueAt },
      to: { classification, status, dueAt },
      hadProgress,
      note,
      patch: { classification, reasons: ev.reasons, blocksSafetySensitive: e.ruleSnapshot.blocksSafetySensitive && classification !== "NOT_APPLICABLE", status, dueAt },
    });
  });

  // Rules published since the checklist was created: add them, never swap them in for existing steps.
  const have = new Set(existing.map((e) => e.ruleId));
  const fresh = (opts.catalog ?? rulesFor(def.key)).filter((r) => !have.has(r.id));
  let order = existing.reduce((m, e) => Math.max(m, e.sortOrder), -1);
  const version = opts.catalogVersion ?? CATALOG_VERSION;
  const additions: ItemAddition[] = evaluateAll(fresh, facts, { labels }).map((ev) => ({
    ruleId: ev.rule.id,
    ruleVersion: ev.rule.version,
    ruleSnapshot: structuredClone(ev.rule),
    stage: ev.rule.stage,
    title: ev.rule.title,
    classification: ev.classification,
    reasons: [`Added ${now.toISOString().slice(0, 10)} from rule catalog ${version}: this requirement was not in the catalog when the checklist was created. Review it.`, ...ev.reasons],
    blocksSafetySensitive: ev.rule.blocksSafetySensitive && ev.classification !== "NOT_APPLICABLE",
    status: ev.classification === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "NOT_STARTED",
    dueAt: ev.dueAt,
    sortOrder: ++order,
  }));

  return {
    answers,
    facts,
    warnings: def.warnings(answers, facts),
    answerChanges,
    revisions,
    additions,
    affectsRecordedWork: revisions.filter((r) => r.hadProgress && r.effect !== "DEADLINE_CHANGED"),
  };
}

export class RevisionError extends Error {}

export interface RevisionActor {
  id: string;
  role: Role;
}

/**
 * Load a saved checklist through the tenant repository (so another organization's run is simply
 * "not found"), plan the change and — unless `dryRun` — save it with a history entry on every
 * step it touches and an audit record of the answers before and after.
 */
export async function reviseRun(
  r: TenantRepository,
  actor: RevisionActor,
  runId: string,
  nextAnswers: Answers,
  org: OrgSettings,
  opts: { dryRun?: boolean; now?: Date } = {},
): Promise<RevisionPlan> {
  assertCan(actor.role, "run:create");
  const run = await r.find("workflowRun", runId);
  const def = WORKFLOWS[run.workflowKey as keyof typeof WORKFLOWS];
  if (!def) throw new RevisionError("This workflow is no longer available, so its answers cannot be edited.");
  if (run.status !== "ACTIVE") throw new RevisionError("This workflow has been approved or closed; reopen it to make changes.");

  const rows = await r.list<any>("checklistItem", { runId });
  const existing: ExistingItem[] = rows.map((i) => ({
    id: i.id,
    ruleId: i.ruleId,
    ruleSnapshot: i.ruleSnapshot as RegulatoryRule,
    title: i.title,
    stage: i.stage,
    classification: i.classification,
    blocksSafetySensitive: i.blocksSafetySensitive,
    status: i.status,
    dueAt: i.dueAt ? new Date(i.dueAt) : null,
    naReason: i.naReason ?? null,
    sortOrder: i.sortOrder ?? 0,
  }));

  const plan = planRevision(def, (run.answers ?? {}) as Answers, (run.facts ?? {}) as Facts, nextAnswers, org, existing, { now: opts.now });
  if (opts.dryRun) return plan;
  if (!plan.answerChanges.length && !plan.revisions.length && !plan.additions.length) return plan;
  // Captured before the run row is updated, for the audit record.
  const previousAnswers = run.answers;
  const originalCatalogVersion = run.catalogVersion;

  for (const rev of plan.revisions) {
    await r.update("checklistItem", rev.id, rev.patch);
    await r.create("itemEvent", {
      itemId: rev.id,
      actorId: actor.id,
      kind: "ANSWERS",
      fromStatus: rev.from.status !== rev.to.status ? rev.from.status : null,
      toStatus: rev.from.status !== rev.to.status ? rev.to.status : null,
      note: rev.note,
      data: { effect: rev.effect, fromClassification: rev.from.classification, toClassification: rev.to.classification },
    });
  }
  for (const add of plan.additions) {
    await r.create("checklistItem", { runId, ...add, ruleSnapshot: add.ruleSnapshot as unknown as object });
  }
  await r.update("workflowRun", runId, { answers: plan.answers as object, facts: plan.facts as object, warnings: plan.warnings });
  await r.create("auditLog", {
    actorId: actor.id,
    action: "run.answers.update",
    entityType: "WorkflowRun",
    entityId: runId,
    meta: {
      at: (opts.now ?? new Date()).toISOString(),
      changes: plan.answerChanges,
      previousAnswers,
      itemsChanged: plan.revisions.map((x) => ({ ruleId: x.ruleId, effect: x.effect, from: x.from.classification, to: x.to.classification, hadProgress: x.hadProgress })),
      itemsAdded: plan.additions.map((x) => x.ruleId),
      originalCatalogVersion,
      evaluatedWithCatalogVersion: CATALOG_VERSION,
    },
  });
  return plan;
}
