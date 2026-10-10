import type { WorkflowKey } from "../rules/types";

export const SLUG_TO_KEY: Record<string, WorkflowKey> = {
  "hire-cdl-driver": "HIRE_CDL_DRIVER",
  "accident": "DOT_ACCIDENT_RESPONSE",
  "drug-alcohol-violation": "DRUG_ALCOHOL_VIOLATION",
  "roadside-inspection": "ROADSIDE_INSPECTION",
  "hours-of-service": "HOS_VIOLATION",
  "medical-certificate": "MEDICAL_CERT_EXPIRED",
  "cdl-status": "CDL_DISQUALIFIED",
  "driver-separation": "DRIVER_SEPARATION",
  "short-haul": "SHORT_HAUL_STATUS",
  "eld-malfunction": "ELD_MALFUNCTION",
  "ticket-or-conviction": "DRIVER_CITATION",
  "vehicle-maintenance": "VEHICLE_MAINTENANCE",
  "random-test": "RANDOM_TEST_SELECTION",
  "lease-a-truck": "LEASED_EQUIPMENT",
  "start-a-trucking-company": "NEW_CARRIER_STARTUP",
  "dot-audit": "AUDIT_NOTICE",
  "driver-moves-state": "DRIVER_RELOCATION",
  "expand-to-another-state": "STATE_EXPANSION",
};
export const KEY_TO_SLUG = Object.fromEntries(Object.entries(SLUG_TO_KEY).map(([s, k]) => [k, s])) as Record<WorkflowKey, string>;

/** Live scenarios open the compliance guide; planned ones open an honest "not yet verified" page. */
export function scenarioHref(s: { n: number; status: string; workflow?: WorkflowKey; aliasOf?: number }): string {
  // A merged scenario links to the one it was merged into (same workflow and pre-filled answers).
  const n = s.aliasOf ?? s.n;
  return s.status === "LIVE" && s.workflow ? `/guide/${KEY_TO_SLUG[s.workflow]}?scenario=${n}` : `/scenarios/${n}`;
}
