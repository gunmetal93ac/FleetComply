import { evaluateAll, type EngineContext } from "../rules/engine";
import { CATALOG_VERSION, rulesFor } from "../rules/catalog";
import type { Classification, Facts, RegulatoryRule } from "../rules/types";
import { labelsFor, type Answers, type OrgSettings, type WorkflowDefinition } from "./definitions";
import type { ItemStatus } from "./status";

export interface GeneratedItem {
  ruleId: string;
  ruleVersion: number;
  /** Immutable copy of the rule as evaluated. Later catalog updates never rewrite it. */
  ruleSnapshot: RegulatoryRule;
  stage: string;
  title: string;
  classification: Classification;
  reasons: string[];
  blocksSafetySensitive: boolean;
  dueAt: Date | null;
  status: ItemStatus;
  sortOrder: number;
}

export interface GeneratedChecklist {
  workflowKey: string;
  catalogVersion: string;
  facts: Facts;
  warnings: string[];
  items: GeneratedItem[];
}

export class ValidationError extends Error {
  constructor(public readonly fieldErrors: Record<string, string>) {
    super("Questionnaire answers are invalid");
  }
}

const CLASS_ORDER: Classification[] = [
  "LEGALLY_REQUIRED",
  "CONDITIONALLY_REQUIRED",
  "UNABLE_TO_DETERMINE",
  "COMPANY_POLICY",
  "BEST_PRACTICE",
  "NOT_APPLICABLE",
];

/**
 * Validate answers, derive facts, evaluate every rule for the workflow, and
 * return a personalized checklist. Pure function — persistence is the caller's job.
 */
export function generateChecklist(
  def: WorkflowDefinition,
  answers: Answers,
  org: OrgSettings,
  ctx: Omit<EngineContext, "labels"> = {},
  /**
   * Published corrections to individual steps, keyed by rule id (see regulatory/verification.ts).
   * A correction replaces a step's wording and citations only when it is a newer version; the
   * applicability logic and the set of steps come from the catalog either way.
   */
  overrides?: Record<string, RegulatoryRule>,
): GeneratedChecklist {
  const errors = def.validate(answers);
  if (Object.keys(errors).length) throw new ValidationError(errors);

  const facts = def.derive(answers, org);
  const rules = rulesFor(def.key).map((r) => {
    const o = overrides?.[r.id];
    return o && (o.version > r.version || (o.version === r.version && o.reviewNotice)) ? o : r;
  });
  const evaluations = evaluateAll(rules, facts, { ...ctx, labels: labelsFor(def) });

  const stageOrder = [...new Set(rules.map((r) => r.stage))];
  const items = evaluations
    .map((e) => ({
      ruleId: e.rule.id,
      ruleVersion: e.rule.version,
      ruleSnapshot: structuredClone(e.rule),
      stage: e.rule.stage,
      title: e.rule.title,
      classification: e.classification,
      reasons: e.reasons,
      blocksSafetySensitive: e.rule.blocksSafetySensitive && e.classification !== "NOT_APPLICABLE",
      dueAt: e.dueAt,
      status: (e.classification === "NOT_APPLICABLE" ? "NOT_APPLICABLE" : "NOT_STARTED") as ItemStatus,
      sortOrder: 0,
    }))
    .sort(
      (a, b) =>
        stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage) ||
        CLASS_ORDER.indexOf(a.classification) - CLASS_ORDER.indexOf(b.classification) ||
        Number(b.blocksSafetySensitive) - Number(a.blocksSafetySensitive),
    )
    .map((it, i) => ({ ...it, sortOrder: i }));

  return { workflowKey: def.key, catalogVersion: CATALOG_VERSION, facts, warnings: def.warnings(answers, facts), items };
}
