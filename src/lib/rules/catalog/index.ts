import type { RegulatoryRule, WorkflowKey } from "../types";
import { federalHiringRules } from "./federal-hiring";
import { federalAccidentRules } from "./federal-accident";
import { federalDrugAlcoholViolationRules } from "./federal-drug-alcohol-violation";
import { federalRoadsideRules } from "./federal-roadside";
import { federalHosRules } from "./federal-hos";
import { federalMedicalRules, federalCdlStatusRules } from "./federal-driver-status";
import { federalSeparationRules } from "./federal-separation";
import { federalCoercionRules, federalShortHaulRules, federalEldRules } from "./federal-hos-records";
import { federalCitationRules } from "./federal-driver-citation";
import { federalVehicleRules } from "./federal-vehicle";
import { federalRandomTestingRules } from "./federal-random-testing";
import { federalLeasingRules } from "./federal-leasing";
import { federalStartupRules } from "./federal-startup";
import { federalAuditRules } from "./federal-audit";
import { federalRelocationRules } from "./federal-relocation";
import { federalExpansionRules } from "./federal-expansion";
export { CATALOG_VERSION, CATALOG_VERIFIED_ON } from "./util";

export const ALL_RULES: RegulatoryRule[] = [
  ...federalHiringRules,
  ...federalAccidentRules,
  ...federalDrugAlcoholViolationRules,
  ...federalRoadsideRules,
  ...federalHosRules,
  ...federalMedicalRules,
  ...federalCdlStatusRules,
  ...federalSeparationRules,
  ...federalCoercionRules,
  ...federalShortHaulRules,
  ...federalEldRules,
  ...federalCitationRules,
  ...federalVehicleRules,
  ...federalRandomTestingRules,
  ...federalLeasingRules,
  ...federalStartupRules,
  ...federalAuditRules,
  ...federalRelocationRules,
  ...federalExpansionRules,
];

export function rulesFor(workflow: WorkflowKey): RegulatoryRule[] {
  return ALL_RULES.filter((r) => r.workflows.includes(workflow));
}

export function getRule(id: string): RegulatoryRule | undefined {
  return ALL_RULES.find((r) => r.id === id);
}

/** Catalog integrity checks — run in tests and at startup. Returns a list of problems. */
export function validateCatalog(rules: RegulatoryRule[] = ALL_RULES): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  for (const r of rules) {
    if (ids.has(r.id)) problems.push(`${r.id}: duplicate id`);
    ids.add(r.id);
    if (!r.sources.length) problems.push(`${r.id}: no source citation`);
    for (const s of r.sources) {
      if (!s.citation) problems.push(`${r.id}: empty citation`);
      if (r.kind === "LEGAL" && r.jurisdiction === "FEDERAL" && !/^https:\/\//.test(s.url))
        problems.push(`${r.id}: federal legal rule must link an official https source`);
    }
    if (r.verificationStatus === "VERIFIED" && !r.lastVerified) problems.push(`${r.id}: VERIFIED without lastVerified date`);
    if (r.verificationStatus === "REQUIRES_VERIFICATION" && !r.verificationNote)
      problems.push(`${r.id}: REQUIRES_VERIFICATION must explain why`);
    if (!r.requiredAction.length) problems.push(`${r.id}: no required action`);
    if (!r.retention.length) problems.push(`${r.id}: no retention guidance`);
    if (!r.verification) problems.push(`${r.id}: no verification method`);
    if (r.changeLog.at(-1)?.version !== r.version) problems.push(`${r.id}: changeLog does not end at current version`);
  }
  return problems;
}
