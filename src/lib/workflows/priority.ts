import { evaluateRule } from "../rules/engine";
import { rulesFor } from "../rules/catalog";
import type { Classification, Facts, RegulatoryRule, WorkflowKey } from "../rules/types";

/**
 * How a checklist is prioritized for display.
 *
 * This module only decides the ORDER and LABEL of steps. It reads what the rule catalog already
 * says — a prohibition, a deadline — and never changes a rule, a citation, a deadline or whether
 * a step applies. The rules engine remains the only place applicability is decided.
 */

export type PriorityTier = 1 | 2 | 3 | 4 | 5;

/**
 * All interface wording for the prioritized checklist, in one place and keyed by stable ids, so
 * it can be translated without touching checklist logic. Tiers, progress and completion state
 * are stored and compared by id/number, never by this text.
 */
export const CHECKLIST_LABELS = {
  tier: {
    1: { name: "Immediate safety", short: "Safety first", blurb: "Protect people and prevent further harm. Do these now." },
    2: { name: "Operational restrictions", short: "Restriction", blurb: "What must not happen until these are resolved. They are in effect now." },
    3: { name: "Time-sensitive requirements", short: "Time-sensitive", blurb: "Testing, notices and deadlines — earliest deadline first." },
    4: { name: "Documentation", short: "Documentation", blurb: "Reports and records to complete and keep." },
    5: { name: "Follow-up", short: "Follow-up", blurb: "Corrective action, reviews and recommended practice." },
  } as Record<PriorityTier, { name: string; short: string; blurb: string }>,
  nextAction: "Next action",
  nextTogether: "Do these together",
  alsoUrgent: "Also urgent — do not wait",
  blocked: "Blocked",
  needsDecision: "Needs a decision",
  allDone: "All checklist actions completed",
  allDoneNote: "Completing a checklist records what was done. It is not a determination of legal compliance.",
  progress: (done: number, total: number, pct: number) => `${done} of ${total} actions completed — ${pct}%`,
  details: "Details, regulation and records",
  notApplicable: "Not applicable to your answers",
  doFirst: "Do these first — don’t wait for the questions",
} as const;

/**
 * Steps that are about protecting life at the scene. Listed by hand, deliberately: nothing in a
 * rule's data says "this is about immediate physical danger", and guessing it from wording would
 * be unsafe. A test fails if an id here is no longer in the catalog.
 */
export const IMMEDIATE_SAFETY_RULE_IDS: readonly string[] = [
  "BP-ACC-IMMEDIATE-RESPONSE", // scene safety, emergency care, first notifications
  "FED-392.22-STOPPED-VEHICLE-WARNINGS", // flashers at once, warning devices within 10 minutes
];

/** The deadline text of the rule itself says the step is immediate or has a stated time limit. */
const TIME_WORDING = /\b(immediately|at once|without delay|as soon as|promptly|no later than|within \d+)\b|\b\d+\s*(minutes?|hours?)\b/i;
const FOLLOW_UP_STAGE = /follow-up|after the/i;

export interface Prioritizable {
  ruleId: string;
  rule: RegulatoryRule;
  classification: Classification;
  dueAt: Date | null;
}

export interface Priority {
  tier: PriorityTier;
  /** Why the step is in this tier — shown in the step's details so the ordering is explainable. */
  basis: string;
}

export function priorityOf(item: Prioritizable): Priority {
  const r = item.rule;
  if (IMMEDIATE_SAFETY_RULE_IDS.includes(item.ruleId)) return { tier: 1, basis: "Listed as an immediate-safety step." };
  if (r.blocksSafetySensitive) return { tier: 2, basis: "The driver may not perform safety-sensitive work until this is done and verified." };
  if (r.prohibits) return { tier: 2, basis: `A prohibition is in effect: ${r.prohibits}.` };
  if (r.deadline.anchor) return { tier: 3, basis: "This step has a regulatory deadline counted from the event." };
  // Only for legal requirements: a recommended practice's "commonly within 30 days" is not a regulatory time limit.
  if (r.kind === "LEGAL" && TIME_WORDING.test(r.deadline.description)) return { tier: 3, basis: `The rule’s own deadline is time-limited: “${r.deadline.description}”` };
  if (r.kind !== "LEGAL" || FOLLOW_UP_STAGE.test(r.stage)) return { tier: 5, basis: r.kind === "LEGAL" ? "Follow-up step." : "Recommended practice or company policy, not a deadline-driven legal step." };
  return { tier: 4, basis: "Record or report with no time limit stated in the rule." };
}

/** Steps that are on the checklist to be done. Not-applicable rules are shown for reference only and get no checkbox. */
export function isActionable(item: { classification: Classification }): boolean {
  return item.classification !== "NOT_APPLICABLE";
}

/**
 * Situations shown with the emergency layout: grouped by urgency rather than by workflow stage.
 * Decided from the workflow and the user's own answers.
 */
export function isEmergency(workflowKey: WorkflowKey | string, facts: Facts): boolean {
  switch (workflowKey) {
    case "DOT_ACCIDENT_RESPONSE":
      return true;
    case "ROADSIDE_INSPECTION":
      return facts.vehicleOos === true || facts.driverOos === true;
    case "VEHICLE_MAINTENANCE":
      return facts.situation === "BREAKDOWN" || (facts.situation === "DEFECT_REPORTED" && facts.defectAffectsSafety !== "NO");
    default:
      return false;
  }
}

const time = (d: Date | null) => (d ? d.getTime() : Number.POSITIVE_INFINITY);

/**
 * Display order. Routine checklists keep the catalog's order (stage by stage — it encodes what
 * depends on what). Emergency checklists are grouped by tier; inside the time-sensitive tier the
 * earliest computed deadline comes first; everything else keeps its catalog order.
 * Never adds or drops a step.
 */
export function orderForDisplay<T extends Prioritizable>(items: T[], emergency: boolean): T[] {
  if (!emergency) return [...items];
  return items
    .map((item, index) => ({ item, index, tier: priorityOf(item).tier }))
    .sort((a, b) => a.tier - b.tier || (a.tier === 3 ? time(a.item.dueAt) - time(b.item.dueAt) : 0) || a.index - b.index)
    .map((x) => x.item);
}

export interface StepState {
  done: boolean;
  /** Set when the step cannot be worked on right now; the text explains why. */
  blockedReason?: string | null;
}

export interface NextActions<T> {
  allDone: boolean;
  /** The highest-priority step(s) that can be done now. More than one means "do these together". */
  primary: T[];
  /** Other open steps that must not wait for the primary ones: restrictions in effect and deadlines within 24 hours or already past. */
  alsoUrgent: T[];
  blocked: Array<{ item: T; reason: string }>;
}

const DAY = 86_400_000;

/**
 * What to do next. Immediate-safety steps are shown together, as are restrictions (they are all in
 * effect at once). In the time-sensitive tier the earliest deadline leads. A higher tier being
 * unfinished never hides a restriction or a deadline that is close: those are returned in
 * `alsoUrgent` so they are shown at the same time.
 */
export function nextActions<T extends Prioritizable>(items: T[], state: (item: T) => StepState, now = new Date()): NextActions<T> {
  const open = items.filter((i) => isActionable(i) && !state(i).done);
  if (open.length === 0) return { allDone: items.some(isActionable), primary: [], alsoUrgent: [], blocked: [] };

  const blocked = open.filter((i) => state(i).blockedReason).map((i) => ({ item: i, reason: String(state(i).blockedReason) }));
  const ready = open.filter((i) => !state(i).blockedReason);
  if (ready.length === 0) return { allDone: false, primary: [], alsoUrgent: [], blocked };

  const tierOf = new Map(ready.map((i) => [i, priorityOf(i).tier] as const));
  const top = Math.min(...tierOf.values()) as PriorityTier;
  const inTop = ready.filter((i) => tierOf.get(i) === top);

  let primary: T[];
  if (top <= 2) primary = inTop;
  else if (top === 3) {
    const sorted = [...inTop].sort((a, b) => time(a.dueAt) - time(b.dueAt));
    primary = sorted[0].dueAt ? sorted.filter((i) => time(i.dueAt) === time(sorted[0].dueAt)) : [inTop[0]];
  } else primary = [inTop[0]];

  const alsoUrgent = ready.filter((i) => !primary.includes(i) && (tierOf.get(i)! <= 2 || (i.dueAt !== null && i.dueAt.getTime() - now.getTime() <= DAY)));
  return { allDone: false, primary, alsoUrgent: alsoUrgent.sort((a, b) => tierOf.get(a)! - tierOf.get(b)! || time(a.dueAt) - time(b.dueAt)), blocked };
}

export interface ChecklistProgress {
  done: number;
  total: number;
  pct: number;
  allDone: boolean;
}

/** Applicable action steps only. A not-applicable step is never counted, as done or otherwise. */
export function checklistProgress<T extends { classification: Classification }>(items: T[], isDone: (item: T) => boolean): ChecklistProgress {
  const actions = items.filter(isActionable);
  const done = actions.filter(isDone).length;
  const total = actions.length;
  return { done, total, pct: total ? Math.round((done / total) * 100) : 0, allDone: total > 0 && done === total };
}

/**
 * Immediate-safety steps that can be shown before any question is answered: those the rules
 * engine does not rule out given what is already known (the scenario's preset answers).
 * The text shown is the catalog's own required-action text.
 */
export function safetyStepsBeforeQuestions(workflowKey: WorkflowKey, knownFacts: Facts): RegulatoryRule[] {
  return rulesFor(workflowKey).filter((r) => IMMEDIATE_SAFETY_RULE_IDS.includes(r.id) && evaluateRule(r, knownFacts).classification !== "NOT_APPLICABLE");
}
