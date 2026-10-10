import type {
  Classification,
  Condition,
  Evaluation,
  FactValue,
  Facts,
  RegulatoryRule,
} from "./types";
import { stateRegistry, type StateRegistry } from "./state-registry";

export type Tri = true | false | "unknown";

export interface ConditionResult {
  value: Tri;
  /** Facts that were needed but not answered. */
  missing: string[];
  /** Human-readable explanation of the deciding facts. */
  trace: string[];
}

export interface EngineContext {
  /** Labels for facts, used to make traces readable ("Hazardous materials?" instead of "hazmat"). */
  labels?: Record<string, string>;
  states?: StateRegistry;
}

export function isUnknown(v: FactValue): boolean {
  return v === undefined || v === null || v === "" || v === "UNKNOWN";
}

function fmt(v: FactValue): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  return String(v);
}

function label(fact: string, ctx: EngineContext): string {
  return ctx.labels?.[fact] ?? fact;
}

/**
 * Three-valued (Kleene) evaluation. `all` is false if any child is false,
 * unknown if any child is unknown, otherwise true. `any` mirrors that.
 */
export function evaluateCondition(
  cond: Condition,
  facts: Facts,
  ctx: EngineContext = {},
): ConditionResult {
  if ("always" in cond) return { value: true, missing: [], trace: [] };

  if ("all" in cond) {
    const parts = cond.all.map((c) => evaluateCondition(c, facts, ctx));
    const falses = parts.filter((p) => p.value === false);
    if (falses.length) return { value: false, missing: [], trace: falses[0].trace };
    const unknowns = parts.filter((p) => p.value === "unknown");
    if (unknowns.length)
      return { value: "unknown", missing: unknowns.flatMap((p) => p.missing), trace: unknowns.flatMap((p) => p.trace) };
    return { value: true, missing: [], trace: parts.flatMap((p) => p.trace) };
  }

  if ("any" in cond) {
    const parts = cond.any.map((c) => evaluateCondition(c, facts, ctx));
    const trues = parts.filter((p) => p.value === true);
    if (trues.length) return { value: true, missing: [], trace: trues[0].trace };
    const unknowns = parts.filter((p) => p.value === "unknown");
    if (unknowns.length)
      return { value: "unknown", missing: unknowns.flatMap((p) => p.missing), trace: unknowns.flatMap((p) => p.trace) };
    return { value: false, missing: [], trace: parts.flatMap((p) => p.trace) };
  }

  if ("not" in cond) {
    const r = evaluateCondition(cond.not, facts, ctx);
    if (r.value === "unknown") return r;
    return { value: !r.value, missing: [], trace: r.trace.map((t) => `NOT (${t})`) };
  }

  const v = facts[cond.fact];
  const name = label(cond.fact, ctx);
  if (isUnknown(v)) {
    return { value: "unknown", missing: [cond.fact], trace: [`${name}: not answered / unknown`] };
  }
  let value: boolean;
  if ("eq" in cond) value = v === cond.eq;
  else if ("in" in cond) value = cond.in.includes(v);
  else if ("isTrue" in cond) value = v === true;
  else value = v === false;
  return { value, missing: [], trace: [`${name}: ${fmt(v)}`] };
}

export function computeDueAt(rule: RegulatoryRule, facts: Facts): Date | null {
  const { anchor, offsetDays, offsetHours, offsetBusinessDays } = rule.deadline;
  if (!anchor) return null;
  const raw = facts[anchor];
  if (isUnknown(raw) || typeof raw !== "string") return null;
  const base = new Date(raw);
  if (Number.isNaN(base.getTime())) return null;
  if (offsetBusinessDays) return addBusinessDaysEndOfDay(base, offsetBusinessDays);
  const ms = (offsetDays ?? 0) * 86_400_000 + (offsetHours ?? 0) * 3_600_000;
  return new Date(base.getTime() + ms);
}

/**
 * End (23:59:59.999 UTC) of the Nth business day after `base`, skipping
 * Saturdays and Sundays. Holidays are not modeled — the result can only be
 * earlier than the true deadline, never later.
 */
export function addBusinessDaysEndOfDay(base: Date, n: number): Date {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()));
  let added = 0;
  while (added < n) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  d.setUTCHours(23, 59, 59, 999);
  return d;
}

/** Decide how a single catalog rule applies to the facts of one workflow run. */
export function evaluateRule(rule: RegulatoryRule, facts: Facts, ctx: EngineContext = {}): Evaluation {
  const states = ctx.states ?? stateRegistry;
  const cond = evaluateCondition(rule.appliesWhen, facts, ctx);
  const reasons: string[] = [];
  const dueAt = computeDueAt(rule, facts);

  const done = (classification: Classification): Evaluation => {
    if (rule.verificationStatus === "REQUIRES_VERIFICATION") {
      reasons.push(
        `Requires Regulatory Verification: ${rule.verificationNote ?? "source text not re-verified for this catalog release."}`,
      );
    }
    return { rule, classification, reasons, dueAt: classification === "NOT_APPLICABLE" ? null : dueAt };
  };

  if (cond.value === "unknown") {
    reasons.push(`Cannot determine applicability — missing: ${[...new Set(cond.missing)].map((m) => label(m, ctx)).join(", ")}.`);
    return done("UNABLE_TO_DETERMINE");
  }
  if (cond.value === false) {
    reasons.push(`Not applicable because ${cond.trace.join("; ") || "conditions are not met"}.`);
    return done("NOT_APPLICABLE");
  }
  if (cond.trace.length) reasons.push(`Applies because ${cond.trace.join("; ")}.`);

  // Interstate-only federal rules: intrastate operations are governed by the state's adopted rules.
  if (rule.commerceScope === "INTERSTATE_ONLY") {
    const op = facts.operationType;
    if (isUnknown(op)) {
      reasons.push(`Depends on whether the operation is interstate or intrastate (${label("operationType", ctx)} not answered).`);
      return done("UNABLE_TO_DETERMINE");
    }
    if (op === "INTRASTATE") {
      const st = String(facts.operatingState ?? "");
      const adoption = states.lookupAdoption(st, rule.id);
      if (!adoption) {
        reasons.push(
          `This is a federal interstate requirement. For intrastate-only operations in ${st || "the operating state"}, the state's adopted rules govern, and that state's rule pack is not loaded yet. Confirm with the state enforcement agency.`,
        );
        return done("UNABLE_TO_DETERMINE");
      }
      reasons.push(`${st} adopts this requirement for intrastate carriers (${adoption.citation}).`);
    }
  }

  if (rule.stateDependent) {
    const st = facts[rule.stateDependent.stateFact];
    if (isUnknown(st)) {
      reasons.push(`State-specific requirement — ${label(rule.stateDependent.stateFact, ctx)} not answered.`);
      return done("UNABLE_TO_DETERMINE");
    }
    const pack = states.get(String(st));
    if (!pack || pack.status !== "LOADED" || !pack.topics.includes(rule.stateDependent.topic)) {
      reasons.push(
        `State-specific requirement (${rule.stateDependent.topic}). FleetComply has not loaded verified ${String(st)} rules for this topic yet, so the exact obligation, deadline and form cannot be stated. Confirm with the ${String(st)} agency named in the item.`,
      );
      return done("UNABLE_TO_DETERMINE");
    }
  }

  if (rule.kind === "BEST_PRACTICE") return done("BEST_PRACTICE");
  if (rule.kind === "COMPANY_POLICY") return done("COMPANY_POLICY");
  return done("always" in rule.appliesWhen ? "LEGALLY_REQUIRED" : "CONDITIONALLY_REQUIRED");
}

export function evaluateAll(rules: RegulatoryRule[], facts: Facts, ctx: EngineContext = {}): Evaluation[] {
  return rules.map((r) => evaluateRule(r, facts, ctx));
}

/** Classifications that put an item on the active checklist. */
export const ACTIONABLE: Classification[] = [
  "LEGALLY_REQUIRED",
  "CONDITIONALLY_REQUIRED",
  "COMPANY_POLICY",
  "UNABLE_TO_DETERMINE",
  "BEST_PRACTICE",
];

/** Classifications that must be resolved before a run can be approved. */
export const MUST_RESOLVE: Classification[] = [
  "LEGALLY_REQUIRED",
  "CONDITIONALLY_REQUIRED",
  "COMPANY_POLICY",
  "UNABLE_TO_DETERMINE",
];
