import { ALL_RULES } from "../rules/catalog";
import type { RegulatoryRule, WorkflowKey } from "../rules/types";
import { VISIBLE_SCENARIOS, type Scenario } from "../workflows/scenarios";
import { compareSections, ecfrSectionUrl, parseCitation, type ParsedCitation } from "./citations";

/**
 * The regulatory dependency map: provision ⇄ rule (workflow step) ⇄ scenario.
 *
 * Built deterministically from the rule catalog. A rule depends on a provision when one
 * of its sources links to that eCFR section. A scenario depends on a provision when its
 * workflow contains such a rule. Scenario links are computed here rather than stored,
 * because scenarios already point at workflows and workflows at rules — a stored copy
 * could drift.
 *
 * A dependency means "review this step if the provision changes". It does not mean the
 * step is wrong: a change must go through an impact assessment and a human decision.
 */

export interface ProvisionDependency {
  title: number;
  part: string;
  section: string;
  sourceUrl: string;
}

export interface RuleDependency {
  ruleId: string;
  title: number;
  section: string;
  /** Union of the paragraphs named by every citation of this section on the rule. Empty = whole section. */
  paragraphs: string[];
  /** Citation text(s) as written in the catalog, joined with "; ". */
  citationText: string;
  sourceUrl: string;
}

export interface UnmonitoredSource {
  ruleId: string;
  citation: string;
  url: string;
  reason: string;
}

export interface DependencyMap {
  provisions: ProvisionDependency[];
  refs: RuleDependency[];
  /** Sources that are not an eCFR section link (state law, agency web pages, other titles). */
  unmonitored: UnmonitoredSource[];
  /** Citations whose text names a different section than their link. */
  mismatches: Array<{ ruleId: string; citation: string; linkSection: string; textSection: string }>;
  /** Rules with no monitorable source at all. */
  rulesWithoutProvision: string[];
}

export function buildDependencyMap(rules: RegulatoryRule[] = ALL_RULES): DependencyMap {
  const provisions = new Map<string, ProvisionDependency>();
  const refs = new Map<string, RuleDependency>();
  const unmonitored: UnmonitoredSource[] = [];
  const mismatches: DependencyMap["mismatches"] = [];
  const rulesWithoutProvision: string[] = [];

  for (const rule of rules) {
    let monitorable = 0;
    for (const source of rule.sources) {
      const parsed: ParsedCitation | null = parseCitation(source);
      if (!parsed) {
        unmonitored.push({
          ruleId: rule.id,
          citation: source.citation,
          url: source.url,
          reason: /ecfr\.gov/.test(source.url) ? "eCFR link is not to a single section" : rule.jurisdiction === "STATE" ? "State law — outside the monitored federal sources" : "Not an eCFR section link",
        });
        continue;
      }
      monitorable++;
      if (parsed.mismatch) mismatches.push({ ruleId: rule.id, citation: source.citation, linkSection: parsed.section, textSection: parsed.mismatch });

      const pKey = `${parsed.title}:${parsed.section}`;
      if (!provisions.has(pKey)) provisions.set(pKey, { title: parsed.title, part: parsed.part, section: parsed.section, sourceUrl: ecfrSectionUrl(parsed.title, parsed.section) });

      const rKey = `${rule.id}|${pKey}`;
      const existing = refs.get(rKey);
      if (existing) {
        // The same section cited twice on one rule: merge. A citation of the whole section widens the reference to the whole section.
        existing.paragraphs = existing.paragraphs.length === 0 || parsed.paragraphs.length === 0 ? [] : [...new Set([...existing.paragraphs, ...parsed.paragraphs])];
        if (!existing.citationText.split("; ").includes(parsed.citationText)) existing.citationText += `; ${parsed.citationText}`;
      } else {
        refs.set(rKey, { ruleId: rule.id, title: parsed.title, section: parsed.section, paragraphs: [...parsed.paragraphs], citationText: parsed.citationText, sourceUrl: parsed.sourceUrl });
      }
    }
    if (monitorable === 0) rulesWithoutProvision.push(rule.id);
  }

  return {
    provisions: [...provisions.values()].sort((a, b) => a.title - b.title || compareSections(a.section, b.section)),
    refs: [...refs.values()].sort((a, b) => compareSections(a.section, b.section) || a.ruleId.localeCompare(b.ruleId)),
    unmonitored,
    mismatches,
    rulesWithoutProvision,
  };
}

// ───────────────────────── Lookups (provision → rules → scenarios) ─────────────────────────

export interface ProvisionImpact {
  section: string;
  rules: Array<{ id: string; title: string; workflows: WorkflowKey[]; paragraphs: string[]; kind: RegulatoryRule["kind"] }>;
  workflows: WorkflowKey[];
  /** Published (live, visible) scenarios whose workflow contains at least one dependent rule. */
  scenarios: Scenario[];
}

/** Everything that would need review if `section` changed. Deterministic; no interpretation. */
export function impactOfProvision(section: string, rules: RegulatoryRule[] = ALL_RULES, map: DependencyMap = buildDependencyMap(rules)): ProvisionImpact {
  const byId = new Map(rules.map((r) => [r.id, r]));
  const dependent = map.refs.filter((r) => r.section === section);
  const impacted = dependent.map((d) => {
    const r = byId.get(d.ruleId)!;
    return { id: r.id, title: r.title, workflows: r.workflows, paragraphs: d.paragraphs, kind: r.kind };
  });
  const workflows = [...new Set(impacted.flatMap((r) => r.workflows))];
  const scenarios = VISIBLE_SCENARIOS.filter((s) => s.status === "LIVE" && s.workflow && workflows.includes(s.workflow));
  return { section, rules: impacted, workflows, scenarios };
}

/**
 * Everything that cites any section of the given CFR parts. Used for Federal Register documents,
 * whose references stop at the part — so this is deliberately broad: it lists what to look at,
 * not what is affected.
 */
export function impactOfParts(parts: string[], rules: RegulatoryRule[] = ALL_RULES, map: DependencyMap = buildDependencyMap(rules)): ProvisionImpact & { sections: string[] } {
  const wanted = new Set(parts);
  const sections = map.provisions.filter((p) => wanted.has(p.part)).map((p) => p.section);
  const byId = new Map(rules.map((r) => [r.id, r]));
  const seen = new Map<string, ProvisionImpact["rules"][number]>();
  for (const ref of map.refs.filter((r) => sections.includes(r.section))) {
    const r = byId.get(ref.ruleId)!;
    const cur = seen.get(r.id);
    if (cur) cur.paragraphs = [...new Set([...cur.paragraphs, `§ ${ref.section}`])];
    else seen.set(r.id, { id: r.id, title: r.title, workflows: r.workflows, paragraphs: [`§ ${ref.section}`], kind: r.kind });
  }
  const impacted = [...seen.values()];
  const workflows = [...new Set(impacted.flatMap((r) => r.workflows))];
  const scenarios = VISIBLE_SCENARIOS.filter((s) => s.status === "LIVE" && s.workflow && workflows.includes(s.workflow));
  return { section: parts.map((p) => `Part ${p}`).join(", "), sections, rules: impacted, workflows, scenarios };
}

/** Provisions a scenario depends on, through its workflow's rules. */
export function provisionsForScenario(scenario: Scenario, rules: RegulatoryRule[] = ALL_RULES, map: DependencyMap = buildDependencyMap(rules)): string[] {
  if (!scenario.workflow) return [];
  const ids = new Set(rules.filter((r) => r.workflows.includes(scenario.workflow!)).map((r) => r.id));
  return [...new Set(map.refs.filter((r) => ids.has(r.ruleId)).map((r) => r.section))].sort(compareSections);
}

/** Published scenarios that depend on at least one monitored provision. */
export function monitoredScenarios(rules: RegulatoryRule[] = ALL_RULES, map: DependencyMap = buildDependencyMap(rules)): Scenario[] {
  return VISIBLE_SCENARIOS.filter((s) => s.status === "LIVE" && provisionsForScenario(s, rules, map).length > 0);
}
